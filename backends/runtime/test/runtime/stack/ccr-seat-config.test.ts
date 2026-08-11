import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	buildCcrSeatConfig,
	ensureCcrSeatConfig,
	resolveCcrEndpoint,
	resolveCcrSeatConfigPath,
} from "../../../src/stack/ccr-config";

const SEAT = {
	providerId: "openrouter",
	baseUrl: "https://openrouter.ai/api/v1",
	apiKey: "sk-seat-key",
};

interface CcrProviderEntry {
	endpoint: string;
	authentication: { credentials: { apiKey: string } };
	settings: { categoryMappings: Record<string, boolean> };
}

function providersOf(config: unknown): Record<string, CcrProviderEntry> {
	return (config as { routing: { providers: Record<string, CcrProviderEntry> } }).routing.providers;
}

describe("resolveCcrEndpoint", () => {
	// CCR POSTs to `endpoint` verbatim, so a seat stored as a bare base 404s without this.
	it("completes a base URL to the chat-completions path", () => {
		expect(resolveCcrEndpoint("https://openrouter.ai/api/v1")).toBe("https://openrouter.ai/api/v1/chat/completions");
	});

	it("leaves an already-complete endpoint alone", () => {
		expect(resolveCcrEndpoint("https://openrouter.ai/api/v1/chat/completions")).toBe(
			"https://openrouter.ai/api/v1/chat/completions",
		);
	});

	it("ignores trailing slashes", () => {
		expect(resolveCcrEndpoint("https://host/v1/")).toBe("https://host/v1/chat/completions");
	});
});

describe("buildCcrSeatConfig", () => {
	it("gives the seat every routing category", () => {
		const providers = providersOf(buildCcrSeatConfig(SEAT, 3460, "/tmp/logs"));
		expect(providers.openrouter?.endpoint).toBe("https://openrouter.ai/api/v1/chat/completions");
		expect(providers.openrouter?.authentication.credentials.apiKey).toBe("sk-seat-key");
		expect(Object.values(providers.openrouter?.settings.categoryMappings ?? {}).every(Boolean)).toBe(true);
	});

	// CCR merges its shipped providers ahead of ours, so an un-neutralized default wins
	// `default` and the task's traffic silently goes to CodeWhisperer instead of the seat.
	it("neutralizes the providers CCR ships by default", () => {
		const providers = providersOf(buildCcrSeatConfig(SEAT, 3460, "/tmp/logs"));
		for (const shipped of ["codewhisperer-primary", "shuaihong-openai"]) {
			expect(Object.values(providers[shipped]?.settings.categoryMappings ?? {}).some(Boolean)).toBe(false);
		}
	});

	it("does not neutralize a seat that shares a shipped provider's name", () => {
		const providers = providersOf(buildCcrSeatConfig({ ...SEAT, providerId: "shuaihong-openai" }, 3460, "/tmp/logs"));
		expect(Object.values(providers["shuaihong-openai"]?.settings.categoryMappings ?? {}).every(Boolean)).toBe(true);
	});

	it("binds the router to the port it was allocated", () => {
		const config = buildCcrSeatConfig(SEAT, 3477, "/tmp/logs") as { server: { port: number; host: string } };
		expect(config.server).toEqual({ port: 3477, host: "127.0.0.1" });
	});
});

describe("ensureCcrSeatConfig", () => {
	it("reports no change when the file already holds the same config", async () => {
		const stackRoot = await mkdtemp(join(tmpdir(), "ccr-seat-"));
		const first = await ensureCcrSeatConfig({ seat: SEAT, port: 3460, stackRoot });
		expect(first).toEqual({ configPath: resolveCcrSeatConfigPath(stackRoot, "openrouter"), changed: true });

		const second = await ensureCcrSeatConfig({ seat: SEAT, port: 3460, stackRoot });
		expect(second?.changed).toBe(false);
	});

	// A rotated key must reach the router, which only re-reads its config on restart.
	it("reports a change when the seat's credentials move", async () => {
		const stackRoot = await mkdtemp(join(tmpdir(), "ccr-seat-"));
		await ensureCcrSeatConfig({ seat: SEAT, port: 3460, stackRoot });
		const rotated = await ensureCcrSeatConfig({
			seat: { ...SEAT, apiKey: "sk-rotated" },
			port: 3460,
			stackRoot,
		});
		expect(rotated?.changed).toBe(true);
		const written = await readFile(rotated?.configPath ?? "", "utf8");
		expect(written).toContain("sk-rotated");
	});

	it("rewrites a hand-edited config back to the expected shape", async () => {
		const stackRoot = await mkdtemp(join(tmpdir(), "ccr-seat-"));
		const first = await ensureCcrSeatConfig({ seat: SEAT, port: 3460, stackRoot });
		await writeFile(first?.configPath ?? "", "{}", "utf8");
		expect((await ensureCcrSeatConfig({ seat: SEAT, port: 3460, stackRoot }))?.changed).toBe(true);
	});

	it("no-ops when no stack is installed", async () => {
		expect(await ensureCcrSeatConfig({ seat: SEAT, port: 3460, stackRoot: null })).toBeNull();
	});
});
