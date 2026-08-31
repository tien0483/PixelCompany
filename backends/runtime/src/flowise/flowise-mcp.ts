// Phase 2: deployed Flowise flows appear as synthetic `flowise-<id>` MCP servers in the
// task card picker. A zero-dependency stdio shim calls the studio's prediction API so
// Claude Code can invoke a canvas agent as a tool — no hand-edited ~/.claude/settings.json.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { RuntimeFlowiseFlow, RuntimeMcpInventory, RuntimeMcpInventoryItem } from "../core/api-contract";
import type { FlowiseClient } from "./flowise-client";
import { resolveFlowiseBaseUrl } from "./flowise-endpoint";

/** Prefix for auto-generated MCP inventory ids — must stay in sync with the UI picker. */
export const FLOWISE_MCP_SERVER_ID_PREFIX = "flowise-";

const DEFAULT_TOOL_NAME = "run_agent";

export function isFlowiseMcpServerId(serverId: string): boolean {
	return serverId.startsWith(FLOWISE_MCP_SERVER_ID_PREFIX);
}

/** Returns the chatflow id embedded in a synthetic inventory id, or null when malformed. */
export function parseFlowiseMcpServerId(serverId: string): string | null {
	if (!isFlowiseMcpServerId(serverId)) {
		return null;
	}
	const flowId = serverId.slice(FLOWISE_MCP_SERVER_ID_PREFIX.length).trim();
	return flowId.length > 0 ? flowId : null;
}

export function buildFlowiseMcpServerId(flowId: string): string {
	return `${FLOWISE_MCP_SERVER_ID_PREFIX}${flowId}`;
}

/** MCP tool names: alphanumeric, underscore, hyphen, max 64 — same rule Flowise uses. */
export function sanitizeFlowiseToolName(raw: string): string {
	const sanitized = raw
		.toLowerCase()
		.replace(/[^a-z0-9_-]/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_|_$/g, "")
		.slice(0, 64);
	return sanitized.length > 0 ? sanitized : DEFAULT_TOOL_NAME;
}

/**
 * Locates `scripts/flowise-mcp-shim.mjs` from monorepo source, tsc output, or bundled
 * `dist/cli.js` layouts — the same candidate walk as `findFlowiseRoot()`.
 */
export function resolveFlowiseMcpShimPath(): string | null {
	const override = process.env.PIXELOFFICE_FLOWISE_MCP_SHIM?.trim();
	if (override && existsSync(override)) {
		return override;
	}
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		resolve(here, "../../scripts/flowise-mcp-shim.mjs"),
		resolve(here, "../../../scripts/flowise-mcp-shim.mjs"),
		resolve(here, "../../../../scripts/flowise-mcp-shim.mjs"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return null;
}

export function flowToMcpInventoryItem(flow: RuntimeFlowiseFlow, baseUrl: string): RuntimeMcpInventoryItem {
	return {
		id: buildFlowiseMcpServerId(flow.id),
		displayName: flow.name,
		description: `Flowise agent → ${baseUrl.replace(/\/$/, "")}/api/v1/prediction/${flow.id}`,
		provider: "claude",
	};
}

/** Lists only deployed flows — undeployed canvases cannot answer the prediction API. */
export async function listFlowiseMcpInventoryItems(client: FlowiseClient): Promise<RuntimeMcpInventoryItem[]> {
	const live = await client.status();
	if (!live.online) {
		return [];
	}
	const flows = await client.listFlows();
	if (flows === null) {
		return [];
	}
	return flows.filter((flow) => flow.deployed).map((flow) => flowToMcpInventoryItem(flow, live.baseUrl));
}

export async function mergeFlowiseMcpInventory(
	base: RuntimeMcpInventory,
	client: FlowiseClient | null | undefined,
): Promise<RuntimeMcpInventory> {
	if (client === null || client === undefined) {
		return base;
	}
	const flowiseItems = await listFlowiseMcpInventoryItems(client);
	if (flowiseItems.length === 0) {
		return base;
	}
	const seen = new Set(base.servers.map((item) => item.id));
	const merged = [...base.servers];
	for (const item of flowiseItems) {
		if (!seen.has(item.id)) {
			merged.push(item);
			seen.add(item.id);
		}
	}
	merged.sort((left, right) => left.displayName.localeCompare(right.displayName));
	return { servers: merged };
}

export interface BuildFlowiseMcpServerEntryInput {
	flow: RuntimeFlowiseFlow;
	baseUrl: string;
	shimPath: string;
}

/** Stdio MCP entry Claude Code launches for one deployed flow. */
export function buildFlowiseMcpServerEntry(input: BuildFlowiseMcpServerEntryInput): Record<string, unknown> {
	const toolName = sanitizeFlowiseToolName(input.flow.name);
	const description =
		input.flow.type?.toUpperCase() === "AGENTFLOW"
			? `Run the "${input.flow.name}" AgentFlow canvas`
			: `Run the "${input.flow.name}" Flowise chatflow`;
	return {
		command: process.execPath,
		args: [input.shimPath],
		env: {
			PIXELOFFICE_FLOWISE_URL: input.baseUrl.replace(/\/$/, ""),
			PIXELOFFICE_FLOWISE_FLOW_ID: input.flow.id,
			PIXELOFFICE_FLOWISE_TOOL_NAME: toolName,
			PIXELOFFICE_FLOWISE_TOOL_DESCRIPTION: description,
		},
	};
}

export interface ResolveFlowiseMcpAllowlistEntriesInput {
	allowedIds: Set<string>;
	client: FlowiseClient;
	warn?: (message: string) => void;
}

/** Materializes stdio MCP configs for selected `flowise-*` ids. Skips offline/missing flows. */
export async function resolveFlowiseMcpAllowlistEntries(
	input: ResolveFlowiseMcpAllowlistEntriesInput,
): Promise<Record<string, unknown>> {
	const flowiseIds = [...input.allowedIds].map(parseFlowiseMcpServerId).filter((id): id is string => id !== null);
	if (flowiseIds.length === 0) {
		return {};
	}
	const shimPath = resolveFlowiseMcpShimPath();
	if (shimPath === null) {
		input.warn?.("Flowise MCP shim missing (scripts/flowise-mcp-shim.mjs) — flowise-* servers were skipped.");
		return {};
	}
	const live = await input.client.status();
	if (!live.online) {
		input.warn?.("Flowise studio is offline — flowise-* MCP servers were skipped.");
		return {};
	}
	const flows = await input.client.listFlows();
	if (flows === null) {
		input.warn?.("Could not read Flowise flows — flowise-* MCP servers were skipped.");
		return {};
	}
	const byId = new Map(flows.filter((flow) => flow.deployed).map((flow) => [flow.id, flow]));
	const entries: Record<string, unknown> = {};
	for (const flowId of flowiseIds) {
		const flow = byId.get(flowId);
		if (flow === undefined) {
			input.warn?.(`Flowise flow ${flowId} is not deployed or missing — skipped for this launch.`);
			continue;
		}
		entries[buildFlowiseMcpServerId(flowId)] = buildFlowiseMcpServerEntry({
			flow,
			baseUrl: live.baseUrl || resolveFlowiseBaseUrl(undefined),
			shimPath,
		});
	}
	return entries;
}
