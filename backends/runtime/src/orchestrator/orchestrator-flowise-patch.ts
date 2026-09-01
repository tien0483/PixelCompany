// Per-launch dsh patch overlay that mounts card-selected Flowise flows as native harness
// tools. dsh speaks MCP through `@deepseek-ai/dsh-mcp-client` (one plugin row per server), so
// the orchestrator itself holds the flow — it no longer has to delegate to a `cursor_agent`
// child just to reach the canvas. Tools arrive as `mcp__<serverName>__<rawName>`.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FlowiseClient } from "../flowise/flowise-client";
import { buildFlowiseShimSpec, resolveFlowiseMcpSelection } from "../flowise/flowise-mcp";

const MCP_CLIENT_PLUGIN = "@deepseek-ai/dsh-mcp-client";
/** dsh-mcp-client contract: `[A-Za-z0-9_-]{1,32}`, unique across live instances. */
const MAX_SERVER_NAME_LENGTH = 32;

export interface PrepareOrchestratorFlowisePatchInput {
	/** `flowise-<id>` inventory ids selected on the card. */
	flowiseServerIds: string[];
	client: FlowiseClient;
	warn?: (message: string) => void;
	log?: (message: string) => void;
}

export interface PreparedOrchestratorFlowisePatch {
	patchPath: string;
	/** Model-facing tool names, so the launch preface can name them instead of guessing. */
	toolNames: string[];
	cleanup: () => Promise<void>;
}

/** Trims a sanitized tool name into a unique dsh `serverName`. */
function toServerName(candidate: string, taken: Set<string>): string {
	const base = candidate.slice(0, MAX_SERVER_NAME_LENGTH) || "flowise";
	if (!taken.has(base)) {
		taken.add(base);
		return base;
	}
	for (let suffix = 2; suffix < 1000; suffix += 1) {
		const marker = `_${suffix}`;
		const next = `${base.slice(0, MAX_SERVER_NAME_LENGTH - marker.length)}${marker}`;
		if (!taken.has(next)) {
			taken.add(next);
			return next;
		}
	}
	taken.add(base);
	return base;
}

/**
 * Writes an overlay for `dsh --patch`, or returns null when nothing is wireable (studio
 * offline, flow undeployed, shim missing). Never throws — a Custom Agent card without a
 * reachable flow still launches, it just has no flow tool.
 */
export async function prepareOrchestratorFlowisePatch(
	input: PrepareOrchestratorFlowisePatchInput,
): Promise<PreparedOrchestratorFlowisePatch | null> {
	const selection = await resolveFlowiseMcpSelection({
		allowedIds: new Set(input.flowiseServerIds.map((id) => id.trim()).filter(Boolean)),
		client: input.client,
		warn: input.warn,
	});
	if (selection === null) {
		return null;
	}

	const takenServerNames = new Set<string>();
	const toolNames: string[] = [];
	const rows = selection.flows.map((flow) => {
		const spec = buildFlowiseShimSpec({ flow, baseUrl: selection.baseUrl, shimPath: selection.shimPath });
		const serverName = toServerName(spec.toolName, takenServerNames);
		toolNames.push(`mcp__${serverName}__${spec.toolName}`);
		return {
			id: `mcp-flowise-${flow.id}`,
			name: MCP_CLIENT_PLUGIN,
			config: {
				serverName,
				transport: "stdio",
				command: spec.command,
				args: spec.args,
				env: spec.env,
				// A canvas hop is slower than a plain tool call; the shim's own request has no cap.
				toolCallTimeoutMs: 300_000,
				// A studio that dies mid-session must not take the whole task down with it.
				failOnStartupError: false,
			},
		};
	});

	// YAML is a superset of JSON, and the loader parses YAML — no serializer dependency needed.
	const payload = JSON.stringify([{ insert: rows }], null, 2);
	const dir = await mkdtemp(join(tmpdir(), "pixeloffice-dsh-flowise-"));
	const patchPath = join(dir, "flowise-mcp.patch.yml");
	await writeFile(patchPath, payload, "utf8");
	input.log?.(`Custom Agent: wired ${rows.length} Flowise flow(s) into dsh — ${toolNames.join(", ")}.`);

	return {
		patchPath,
		toolNames,
		cleanup: async () => {
			await rm(dir, { recursive: true, force: true }).catch(() => {});
		},
	};
}
