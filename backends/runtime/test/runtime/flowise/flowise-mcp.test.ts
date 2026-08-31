import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeFlowiseFlow } from "../../../src/core/api-contract";
import type { FlowiseClient } from "../../../src/flowise/flowise-client";
import {
	buildFlowiseMcpServerId,
	buildFlowiseMcpServerEntry,
	isFlowiseMcpServerId,
	listFlowiseMcpInventoryItems,
	mergeFlowiseMcpInventory,
	parseFlowiseMcpServerId,
	resolveFlowiseMcpAllowlistEntries,
	resolveFlowiseMcpShimPath,
	sanitizeFlowiseToolName,
} from "../../../src/flowise/flowise-mcp";

const sampleFlow: RuntimeFlowiseFlow = {
	id: "abc-123",
	name: "Product QA",
	deployed: true,
	type: "AGENTFLOW",
};

function mockClient(input: {
	online?: boolean;
	flows?: RuntimeFlowiseFlow[] | null;
	baseUrl?: string;
}): FlowiseClient {
	return {
		baseUrl: input.baseUrl ?? "http://127.0.0.1:3010",
		status: vi.fn(async () => ({
			online: input.online ?? true,
			baseUrl: input.baseUrl ?? "http://127.0.0.1:3010",
		})),
		listFlows: vi.fn(async () => input.flows ?? []),
	};
}

describe("flowise MCP ids", () => {
	it("round-trips flow ids through the synthetic prefix", () => {
		expect(buildFlowiseMcpServerId("abc-123")).toBe("flowise-abc-123");
		expect(isFlowiseMcpServerId("flowise-abc-123")).toBe(true);
		expect(parseFlowiseMcpServerId("flowise-abc-123")).toBe("abc-123");
		expect(parseFlowiseMcpServerId("filesystem")).toBeNull();
	});

	it("sanitizes tool names for MCP", () => {
		expect(sanitizeFlowiseToolName("Product QA!")).toBe("product_qa");
		expect(sanitizeFlowiseToolName("!!!")).toBe("run_agent");
	});
});

describe("listFlowiseMcpInventoryItems", () => {
	it("lists only deployed flows when the studio is online", async () => {
		const items = await listFlowiseMcpInventoryItems(
			mockClient({
				flows: [
					sampleFlow,
					{ id: "draft", name: "Draft", deployed: false },
				],
			}),
		);
		expect(items).toHaveLength(1);
		expect(items[0]?.id).toBe("flowise-abc-123");
		expect(items[0]?.displayName).toBe("Product QA");
	});

	it("returns nothing when the studio is offline", async () => {
		const items = await listFlowiseMcpInventoryItems(mockClient({ online: false }));
		expect(items).toEqual([]);
	});
});

describe("mergeFlowiseMcpInventory", () => {
	it("appends synthetic servers without clobbering ~/.claude entries", async () => {
		const merged = await mergeFlowiseMcpInventory(
			{
				servers: [{ id: "filesystem", displayName: "filesystem", provider: "claude" }],
			},
			mockClient({ flows: [sampleFlow] }),
		);
		expect(merged.servers.map((s) => s.id).sort()).toEqual(["filesystem", "flowise-abc-123"].sort());
	});
});

describe("resolveFlowiseMcpAllowlistEntries", () => {
	const savedShimEnv = process.env.PIXELOFFICE_FLOWISE_MCP_SHIM;

	afterEach(() => {
		if (savedShimEnv === undefined) {
			delete process.env.PIXELOFFICE_FLOWISE_MCP_SHIM;
		} else {
			process.env.PIXELOFFICE_FLOWISE_MCP_SHIM = savedShimEnv;
		}
	});

	it("builds stdio MCP entries for selected deployed flows", async () => {
		const shim = join(mkdtempSync(join(tmpdir(), "flowise-shim-")), "flowise-mcp-shim.mjs");
		writeFileSync(shim, "// stub\n", "utf8");
		process.env.PIXELOFFICE_FLOWISE_MCP_SHIM = shim;

		const entries = await resolveFlowiseMcpAllowlistEntries({
			allowedIds: new Set(["flowise-abc-123", "filesystem"]),
			client: mockClient({ flows: [sampleFlow] }),
		});
		expect(Object.keys(entries)).toEqual(["flowise-abc-123"]);
		const config = entries["flowise-abc-123"] as {
			command?: string;
			args?: string[];
			env?: Record<string, string>;
		};
		expect(config.args).toEqual([shim]);
		expect(config.env?.PIXELOFFICE_FLOWISE_FLOW_ID).toBe("abc-123");
		expect(config.env?.PIXELOFFICE_FLOWISE_URL).toBe("http://127.0.0.1:3010");
	});

	it("resolves the bundled shim path in this checkout", () => {
		expect(resolveFlowiseMcpShimPath()).toMatch(/flowise-mcp-shim\.mjs$/);
	});
});

describe("buildFlowiseMcpServerEntry", () => {
	it("uses the runtime node binary and shim args", () => {
		const entry = buildFlowiseMcpServerEntry({
			flow: sampleFlow,
			baseUrl: "http://127.0.0.1:3010",
			shimPath: "/tmp/shim.mjs",
		}) as { command?: string; args?: string[]; env?: Record<string, string> };
		expect(entry.command).toBe(process.execPath);
		expect(entry.args).toEqual(["/tmp/shim.mjs"]);
		expect(entry.env?.PIXELOFFICE_FLOWISE_TOOL_NAME).toBe("product_qa");
	});
});
