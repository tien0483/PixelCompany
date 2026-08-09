import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildSubagentModelMarker, resolveSubagentSeatEnv } from "../../../src/terminal/subagent-seat-launch";

const ensureCcrSeatRouter = vi.hoisted(() => vi.fn());
vi.mock("../../../src/stack/ccr-process", () => ({ ensureCcrSeatRouter }));

const SEAT = {
	providerId: "openrouter",
	name: "OpenRouter",
	baseUrl: "https://openrouter.ai/api/v1",
	modelId: "cohere/north-mini-code:free",
	apiKey: "sk-seat-key",
};

const openServers: Server[] = [];

/** Stands in for the switchboard: the resolver only probes that the port answers. */
async function listenOnStackPort(): Promise<number> {
	const server = createServer();
	openServers.push(server);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const port = typeof address === "object" && address !== null ? address.port : 0;
	process.env.STACK_UI_PORT = String(port);
	return port;
}

afterEach(async () => {
	await Promise.all(openServers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
	delete process.env.STACK_UI_PORT;
	ensureCcrSeatRouter.mockReset();
});

function collectWarnings() {
	const warnings: string[] = [];
	return { warnings, deps: { warn: (message: string) => warnings.push(message) } };
}

describe("buildSubagentModelMarker", () => {
	it("puts the port first so the switchboard needs no shared state", () => {
		expect(buildSubagentModelMarker(3460, "gpt-5")).toBe("ccr-3460,gpt-5");
	});

	// Model ids routinely contain slashes and colons; only the first comma may split.
	it("survives a model id that itself contains punctuation", () => {
		expect(buildSubagentModelMarker(3461, "cohere/north-mini-code:free")).toBe(
			"ccr-3461,cohere/north-mini-code:free",
		);
	});
});

describe("resolveSubagentSeatEnv", () => {
	it("returns null when no seat is pinned, without touching the router", async () => {
		const { deps } = collectWarnings();
		expect(await resolveSubagentSeatEnv(undefined, deps)).toBeNull();
		expect(await resolveSubagentSeatEnv({ agentIds: ["reviewer"] }, deps)).toBeNull();
		expect(ensureCcrSeatRouter).not.toHaveBeenCalled();
	});

	it("builds the base URL and marker for a pinned seat", async () => {
		const port = await listenOnStackPort();
		ensureCcrSeatRouter.mockResolvedValue({ providerId: "openrouter", port: 3460 });
		const { deps } = collectWarnings();

		const env = await resolveSubagentSeatEnv(
			{ subagentSeatProviderId: "openrouter" },
			{ ...deps, resolveSeatCredentials: async () => SEAT },
		);

		expect(env).toEqual({
			ANTHROPIC_BASE_URL: `http://127.0.0.1:${String(port)}`,
			CLAUDE_CODE_SUBAGENT_MODEL: "ccr-3460,cohere/north-mini-code:free",
		});
	});

	it("passes the card's model override through to the seat resolver", async () => {
		await listenOnStackPort();
		ensureCcrSeatRouter.mockResolvedValue({ providerId: "openrouter", port: 3460 });
		const { deps } = collectWarnings();
		const seen: unknown[] = [];

		await resolveSubagentSeatEnv(
			{ subagentSeatProviderId: "openrouter", subagentSeatModelId: "gpt-5" },
			{
				...deps,
				resolveSeatCredentials: async (input) => {
					seen.push(input);
					return { ...SEAT, modelId: "gpt-5" };
				},
			},
		);

		expect(seen).toEqual([{ providerId: "openrouter", modelId: "gpt-5" }]);
	});

	// Every failure below must degrade to "subagents share the task's seat" rather than
	// throw: losing the split costs tokens, refusing to launch costs the user their task.
	it("degrades when the seat has no usable credentials", async () => {
		await listenOnStackPort();
		const { warnings, deps } = collectWarnings();

		const env = await resolveSubagentSeatEnv(
			{ subagentSeatProviderId: "openrouter" },
			{ ...deps, resolveSeatCredentials: async () => null },
		);

		expect(env).toBeNull();
		expect(warnings.join(" ")).toContain("no usable key");
		expect(ensureCcrSeatRouter).not.toHaveBeenCalled();
	});

	it("degrades when the seat resolver throws", async () => {
		await listenOnStackPort();
		const { warnings, deps } = collectWarnings();

		const env = await resolveSubagentSeatEnv(
			{ subagentSeatProviderId: "openrouter" },
			{
				...deps,
				resolveSeatCredentials: async () => {
					throw new Error("settings store unreadable");
				},
			},
		);

		expect(env).toBeNull();
		expect(warnings.join(" ")).toContain("settings store unreadable");
	});

	// Without the switchboard the marker would reach api.anthropic.com as a bogus model id
	// and every subagent turn would fail, so this must not set the env at all.
	it("degrades when the switchboard is not listening", async () => {
		process.env.STACK_UI_PORT = "1";
		const { warnings, deps } = collectWarnings();

		const env = await resolveSubagentSeatEnv(
			{ subagentSeatProviderId: "openrouter" },
			{ ...deps, resolveSeatCredentials: async () => SEAT },
		);

		expect(env).toBeNull();
		expect(warnings.join(" ")).toContain("switchboard is not listening");
		expect(ensureCcrSeatRouter).not.toHaveBeenCalled();
	});

	it("degrades when the seat router cannot be started", async () => {
		await listenOnStackPort();
		ensureCcrSeatRouter.mockResolvedValue(null);
		const { deps } = collectWarnings();

		expect(
			await resolveSubagentSeatEnv(
				{ subagentSeatProviderId: "openrouter" },
				{ ...deps, resolveSeatCredentials: async () => SEAT },
			),
		).toBeNull();
	});
});
