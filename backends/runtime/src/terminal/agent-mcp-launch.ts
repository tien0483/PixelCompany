// Auto-wires card MCP allowlists into agent-specific project config (Cursor `.cursor/mcp.json`,
// Antigravity/Gemini `.gemini/settings.json`) and shared allowlist resolution for Claude.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { createFlowiseClient } from "../flowise/flowise-client";
import type { FlowiseClient } from "../flowise/flowise-client";
import { isFlowiseMcpServerId, resolveFlowiseMcpAllowlistEntries } from "../flowise/flowise-mcp";

export type ProjectMcpFormat = "cursor" | "gemini";

export interface ResolveMcpAllowlistServersInput {
	mcpServerIds: string[];
	globalConfigPath: string;
	flowiseClient?: FlowiseClient | null;
	warn?: (message: string) => void;
}

/** Resolves stdio MCP entries for selected ids from global config plus synthetic Flowise flows. */
export async function resolveMcpAllowlistServers(
	input: ResolveMcpAllowlistServersInput,
): Promise<Record<string, unknown>> {
	const allow = new Set(input.mcpServerIds.map((id) => id.trim()).filter(Boolean));
	if (allow.size === 0) {
		return {};
	}

	const filtered: Record<string, unknown> = {};
	try {
		const parsed: unknown = JSON.parse(await readFile(input.globalConfigPath, "utf8"));
		if (parsed && typeof parsed === "object") {
			const mcpServers = (parsed as { mcpServers?: unknown }).mcpServers;
			if (mcpServers && typeof mcpServers === "object" && !Array.isArray(mcpServers)) {
				for (const [key, value] of Object.entries(mcpServers as Record<string, unknown>)) {
					if (allow.has(key)) {
						filtered[key] = value;
					}
				}
			}
		}
	} catch {
		// Missing global config is fine when the allowlist is entirely synthetic Flowise ids.
	}

	if ([...allow].some(isFlowiseMcpServerId)) {
		const client =
			input.flowiseClient ??
			createFlowiseClient({
				warn: (message) => {
					input.warn?.(message);
				},
			});
		const flowiseEntries = await resolveFlowiseMcpAllowlistEntries({
			allowedIds: allow,
			client,
			warn: input.warn,
		});
		Object.assign(filtered, flowiseEntries);
	}

	return filtered;
}

function globalConfigPathForFormat(format: ProjectMcpFormat): string {
	if (format === "cursor") {
		return join(homedir(), ".cursor", "mcp.json");
	}
	return join(homedir(), ".gemini", "settings.json");
}

function projectConfigPaths(cwd: string, format: ProjectMcpFormat): { dir: string; file: string } {
	if (format === "cursor") {
		const dir = join(cwd, ".cursor");
		return { dir, file: join(dir, "mcp.json") };
	}
	const dir = join(cwd, ".gemini");
	return { dir, file: join(dir, "settings.json") };
}

function mergeProjectMcpPayload(
	existingContent: string | null,
	format: ProjectMcpFormat,
	servers: Record<string, unknown>,
): Record<string, unknown> {
	if (format === "cursor") {
		return { mcpServers: servers };
	}
	if (existingContent === null) {
		return { mcpServers: servers };
	}
	try {
		const existing = JSON.parse(existingContent) as Record<string, unknown>;
		return { ...existing, mcpServers: servers };
	} catch {
		return { mcpServers: servers };
	}
}

export interface PrepareProjectMcpConfigInput {
	cwd: string;
	mcpServerIds: string[];
	format: ProjectMcpFormat;
	flowiseClient?: FlowiseClient | null;
	warn?: (message: string) => void;
}

/**
 * Writes task-scoped MCP config under the worktree so Cursor Agent and Antigravity pick up
 * card-selected servers (including Flowise shims) without hand-editing ~/.cursor/mcp.json.
 */
export async function prepareProjectMcpConfig(
	input: PrepareProjectMcpConfigInput,
): Promise<{ cleanup: () => Promise<void> } | null> {
	const allow = new Set(input.mcpServerIds.map((id) => id.trim()).filter(Boolean));
	if (allow.size === 0) {
		return null;
	}

	const resolved = await resolveMcpAllowlistServers({
		mcpServerIds: input.mcpServerIds,
		globalConfigPath: globalConfigPathForFormat(input.format),
		flowiseClient: input.flowiseClient,
		warn: input.warn,
	});

	const { dir, file } = projectConfigPaths(input.cwd, input.format);
	let existedBefore = false;
	let beforeContent: string | null = null;
	try {
		beforeContent = await readFile(file, "utf8");
		existedBefore = true;
	} catch {
		existedBefore = false;
	}

	let mergedServers = { ...resolved };
	if (existedBefore && beforeContent !== null) {
		try {
			const existing = JSON.parse(beforeContent) as { mcpServers?: Record<string, unknown> };
			const existingServers =
				existing.mcpServers && typeof existing.mcpServers === "object" && !Array.isArray(existing.mcpServers)
					? existing.mcpServers
					: {};
			mergedServers = { ...existingServers, ...resolved };
		} catch {
			// Corrupt project file — overwrite mcpServers only.
		}
	}

	const payload = mergeProjectMcpPayload(beforeContent, input.format, mergedServers);
	await mkdir(dir, { recursive: true });
	await writeFile(file, JSON.stringify(payload, null, 2), "utf8");

	return {
		cleanup: async () => {
			if (!existedBefore) {
				await rm(file, { force: true }).catch(() => {});
				return;
			}
			if (beforeContent !== null) {
				await writeFile(file, beforeContent, "utf8").catch(() => {});
			}
		},
	};
}
