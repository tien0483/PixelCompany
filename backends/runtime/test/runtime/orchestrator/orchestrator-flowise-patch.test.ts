import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeFlowiseFlow } from "../../../src/core/api-contract";
import type { FlowiseClient } from "../../../src/flowise/flowise-client";
import { prepareOrchestratorFlowisePatch } from "../../../src/orchestrator/orchestrator-flowise-patch";

const sampleFlow: RuntimeFlowiseFlow = {
	id: "abc-123",
	name: "Product QA",
	deployed: true,
	type: "AGENTFLOW",
};

function mockClient(input: { online?: boolean; flows?: RuntimeFlowiseFlow[] | null }): FlowiseClient {
	return {
		baseUrl: "http://127.0.0.1:3010",
		status: vi.fn(async () => ({ online: input.online ?? true, baseUrl: "http://127.0.0.1:3010" })),
		listFlows: vi.fn(async () => input.flows ?? []),
	};
}

function stubShim(): string {
	const shim = join(mkdtempSync(join(tmpdir(), "flowise-shim-")), "flowise-mcp-shim.mjs");
	writeFileSync(shim, "// stub\n", "utf8");
	process.env.PIXELOFFICE_FLOWISE_MCP_SHIM = shim;
	return shim;
}

interface McpClientRow {
	id: string;
	name: string;
	config: {
		serverName: string;
		transport: string;
		command: string;
		args: string[];
		env: Record<string, string>;
		failOnStartupError: boolean;
	};
}

function readRows(patchPath: string): McpClientRow[] {
	const parsed = JSON.parse(readFileSync(patchPath, "utf8")) as Array<{ insert?: McpClientRow[] }>;
	return parsed[0]?.insert ?? [];
}

describe("prepareOrchestratorFlowisePatch", () => {
	const savedShimEnv = process.env.PIXELOFFICE_FLOWISE_MCP_SHIM;

	afterEach(() => {
		if (savedShimEnv === undefined) {
			delete process.env.PIXELOFFICE_FLOWISE_MCP_SHIM;
		} else {
			process.env.PIXELOFFICE_FLOWISE_MCP_SHIM = savedShimEnv;
		}
	});

	it("writes one dsh-mcp-client insert row per deployed flow", async () => {
		const shim = stubShim();
		const prepared = await prepareOrchestratorFlowisePatch({
			flowiseServerIds: ["flowise-abc-123"],
			client: mockClient({ flows: [sampleFlow] }),
		});
		expect(prepared).not.toBeNull();
		expect(prepared?.toolNames).toEqual(["mcp__product_qa__product_qa"]);

		const rows = readRows(prepared?.patchPath ?? "");
		expect(rows).toHaveLength(1);
		expect(rows[0]?.id).toBe("mcp-flowise-abc-123");
		expect(rows[0]?.name).toBe("@deepseek-ai/dsh-mcp-client");
		expect(rows[0]?.config.transport).toBe("stdio");
		expect(rows[0]?.config.args).toEqual([shim]);
		expect(rows[0]?.config.env.PIXELOFFICE_FLOWISE_FLOW_ID).toBe("abc-123");
		// A dead studio must not take the whole task down at activation.
		expect(rows[0]?.config.failOnStartupError).toBe(false);

		await prepared?.cleanup();
	});

	it("keeps serverName unique and within the 32-char contract", async () => {
		stubShim();
		const longName = "A".repeat(40);
		const prepared = await prepareOrchestratorFlowisePatch({
			flowiseServerIds: ["flowise-one", "flowise-two"],
			client: mockClient({
				flows: [
					{ id: "one", name: longName, deployed: true },
					{ id: "two", name: longName, deployed: true },
				],
			}),
		});
		const names = readRows(prepared?.patchPath ?? "").map((row) => row.config.serverName);
		expect(names).toHaveLength(2);
		expect(new Set(names).size).toBe(2);
		for (const name of names) {
			expect(name).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
		}

		await prepared?.cleanup();
	});

	it("returns null when the studio is offline or the flow is undeployed", async () => {
		stubShim();
		expect(
			await prepareOrchestratorFlowisePatch({
				flowiseServerIds: ["flowise-abc-123"],
				client: mockClient({ online: false }),
			}),
		).toBeNull();
		expect(
			await prepareOrchestratorFlowisePatch({
				flowiseServerIds: ["flowise-abc-123"],
				client: mockClient({ flows: [{ ...sampleFlow, deployed: false }] }),
			}),
		).toBeNull();
	});
});
