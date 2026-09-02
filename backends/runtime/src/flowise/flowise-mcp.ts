// Phase 2: deployed Flowise flows appear as synthetic `flowise-<id>` MCP servers in the
// task card picker. A zero-dependency stdio shim calls the studio's prediction API so
// Claude Code can invoke a canvas agent as a tool — no hand-edited ~/.claude/settings.json.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { RuntimeFlowiseFlow, RuntimeMcpInventory, RuntimeMcpInventoryItem } from "../core/api-contract";
import { readBrandEnv } from "../brand";
import type { FlowiseClient } from "./flowise-client";
import { resolveFlowiseBaseUrl } from "./flowise-endpoint";
import { buildFlowiseMcpServerId, parseFlowiseMcpServerId, sanitizeFlowiseToolName } from "./flowise-mcp-id";

// Re-exported so existing runtime importers keep one entry point; the browser imports the
// filesystem-free `flowise-mcp-id` module directly.
export {
	buildFlowiseMcpServerId,
	FLOWISE_MCP_SERVER_ID_PREFIX,
	isFlowiseMcpServerId,
	parseFlowiseMcpServerId,
	sanitizeFlowiseToolName,
} from "./flowise-mcp-id";

/**
 * Locates `scripts/flowise-mcp-shim.mjs` from monorepo source, tsc output, or bundled
 * `dist/cli.js` layouts — the same candidate walk as `findFlowiseRoot()`.
 */
export function resolveFlowiseMcpShimPath(): string | null {
	const override = readBrandEnv("FLOWISE_MCP_SHIM")?.trim();
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

/** How to spawn the stdio shim for one deployed flow — shared by every MCP host we target. */
export interface FlowiseShimSpec {
	command: string;
	args: string[];
	env: Record<string, string>;
	toolName: string;
	description: string;
}

export function describeFlowiseFlow(flow: RuntimeFlowiseFlow): string {
	return flow.type?.toUpperCase() === "AGENTFLOW"
		? `Run the "${flow.name}" AgentFlow canvas`
		: `Run the "${flow.name}" Flowise chatflow`;
}

export function buildFlowiseShimSpec(input: BuildFlowiseMcpServerEntryInput): FlowiseShimSpec {
	const toolName = sanitizeFlowiseToolName(input.flow.name);
	const description = describeFlowiseFlow(input.flow);
	return {
		command: process.execPath,
		args: [input.shimPath],
		env: {
			PIXTIEL_FLOWISE_URL: input.baseUrl.replace(/\/$/, ""),
			PIXELOFFICE_FLOWISE_URL: input.baseUrl.replace(/\/$/, ""),
			PIXTIEL_FLOWISE_FLOW_ID: input.flow.id,
			PIXELOFFICE_FLOWISE_FLOW_ID: input.flow.id,
			PIXTIEL_FLOWISE_TOOL_NAME: toolName,
			PIXELOFFICE_FLOWISE_TOOL_NAME: toolName,
			PIXTIEL_FLOWISE_TOOL_DESCRIPTION: description,
			PIXELOFFICE_FLOWISE_TOOL_DESCRIPTION: description,
		},
		toolName,
		description,
	};
}

/** Stdio MCP entry Claude Code launches for one deployed flow. */
export function buildFlowiseMcpServerEntry(input: BuildFlowiseMcpServerEntryInput): Record<string, unknown> {
	const spec = buildFlowiseShimSpec(input);
	return { command: spec.command, args: spec.args, env: spec.env };
}

export interface ResolveFlowiseMcpAllowlistEntriesInput {
	allowedIds: Set<string>;
	client: FlowiseClient;
	warn?: (message: string) => void;
}

/** A selected `flowise-*` id resolved to a live, deployed flow plus the shim that runs it. */
export interface ResolvedFlowiseMcpSelection {
	flows: RuntimeFlowiseFlow[];
	baseUrl: string;
	shimPath: string;
}

/**
 * Shared resolution for every consumer of card-selected `flowise-*` ids — Claude's
 * `--mcp-config`, the Cursor/Antigravity project config, and the orchestrator's dsh patch
 * overlay. Returns null (never throws) when nothing is usable, so a launch degrades to
 * "no Flowise tools" rather than failing.
 */
export async function resolveFlowiseMcpSelection(
	input: ResolveFlowiseMcpAllowlistEntriesInput,
): Promise<ResolvedFlowiseMcpSelection | null> {
	const flowiseIds = [...input.allowedIds].map(parseFlowiseMcpServerId).filter((id): id is string => id !== null);
	if (flowiseIds.length === 0) {
		return null;
	}
	const shimPath = resolveFlowiseMcpShimPath();
	if (shimPath === null) {
		input.warn?.("Flowise MCP shim missing (scripts/flowise-mcp-shim.mjs) — flowise-* servers were skipped.");
		return null;
	}
	const live = await input.client.status();
	if (!live.online) {
		input.warn?.("Flowise studio is offline — flowise-* MCP servers were skipped.");
		return null;
	}
	const allFlows = await input.client.listFlows();
	if (allFlows === null) {
		input.warn?.("Could not read Flowise flows — flowise-* MCP servers were skipped.");
		return null;
	}
	const byId = new Map(allFlows.filter((flow) => flow.deployed).map((flow) => [flow.id, flow]));
	const flows: RuntimeFlowiseFlow[] = [];
	for (const flowId of flowiseIds) {
		const flow = byId.get(flowId);
		if (flow === undefined) {
			input.warn?.(`Flowise flow ${flowId} is not deployed or missing — skipped for this launch.`);
			continue;
		}
		flows.push(flow);
	}
	if (flows.length === 0) {
		return null;
	}
	return { flows, baseUrl: live.baseUrl || resolveFlowiseBaseUrl(undefined), shimPath };
}

/** Materializes stdio MCP configs for selected `flowise-*` ids. Skips offline/missing flows. */
export async function resolveFlowiseMcpAllowlistEntries(
	input: ResolveFlowiseMcpAllowlistEntriesInput,
): Promise<Record<string, unknown>> {
	const selection = await resolveFlowiseMcpSelection(input);
	if (selection === null) {
		return {};
	}
	const entries: Record<string, unknown> = {};
	for (const flow of selection.flows) {
		entries[buildFlowiseMcpServerId(flow.id)] = buildFlowiseMcpServerEntry({
			flow,
			baseUrl: selection.baseUrl,
			shimPath: selection.shimPath,
		});
	}
	return entries;
}
