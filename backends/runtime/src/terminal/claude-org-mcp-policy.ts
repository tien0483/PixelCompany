// Reads Claude Code org-managed MCP policy cached in remote-settings.json. Used to warn on
// task cards when flowise-* or other card MCP selections will be rejected at launch.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { isFlowiseMcpServerId } from "../flowise/flowise-mcp";

export interface ClaudeOrgMcpPolicy {
	detected: boolean;
	allowManagedMcpServersOnly: boolean;
	organizationName: string | null;
	allowedServerNames: string[];
	allowedServerUrls: string[];
}

const EMPTY_POLICY: ClaudeOrgMcpPolicy = {
	detected: false,
	allowManagedMcpServersOnly: false,
	organizationName: null,
	allowedServerNames: [],
	allowedServerUrls: [],
};

function parseAllowedMcpServers(raw: unknown): { names: string[]; urls: string[] } {
	if (!Array.isArray(raw)) {
		return { names: [], urls: [] };
	}
	const names: string[] = [];
	const urls: string[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") {
			continue;
		}
		const record = entry as Record<string, unknown>;
		const serverName = typeof record.serverName === "string" ? record.serverName.trim() : "";
		if (serverName) {
			names.push(serverName);
		}
		const serverUrl = typeof record.serverUrl === "string" ? record.serverUrl.trim() : "";
		if (serverUrl) {
			urls.push(serverUrl);
		}
	}
	return { names, urls };
}

async function readPolicyFile(path: string): Promise<ClaudeOrgMcpPolicy | null> {
	try {
		const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
		if (!parsed || typeof parsed !== "object") {
			return null;
		}
		const record = parsed as Record<string, unknown>;
		const allowManagedMcpServersOnly = record.allowManagedMcpServersOnly === true;
		const organizationName =
			typeof record.organizationName === "string" && record.organizationName.trim().length > 0
				? record.organizationName.trim()
				: null;
		const allowed = parseAllowedMcpServers(record.allowedMcpServers);
		if (
			!allowManagedMcpServersOnly &&
			allowed.names.length === 0 &&
			allowed.urls.length === 0 &&
			organizationName === null
		) {
			return null;
		}
		return {
			detected: true,
			allowManagedMcpServersOnly,
			organizationName,
			allowedServerNames: allowed.names,
			allowedServerUrls: allowed.urls,
		};
	} catch {
		return null;
	}
}

/** Reads org MCP policy from Claude's cached remote settings (and system managed-settings). */
export async function readClaudeOrgMcpPolicy(claudeConfigDir?: string | null): Promise<ClaudeOrgMcpPolicy> {
	const baseDir = claudeConfigDir?.trim() || join(homedir(), ".claude");
	const candidates = [join(baseDir, "remote-settings.json"), "/etc/claude-code/managed-settings.json"];
	for (const candidate of candidates) {
		const policy = await readPolicyFile(candidate);
		if (policy !== null) {
			return policy;
		}
	}
	return EMPTY_POLICY;
}

/** Returns MCP inventory ids that org policy will reject on Claude Code launch. */
export function listBlockedClaudeMcpServerIds(mcpServerIds: string[], policy: ClaudeOrgMcpPolicy): string[] {
	if (!policy.detected || !policy.allowManagedMcpServersOnly) {
		return [];
	}
	const allowedNames = new Set(policy.allowedServerNames.map((name) => name.toLowerCase()));
	const blocked: string[] = [];
	for (const rawId of mcpServerIds) {
		const id = rawId.trim();
		if (!id) {
			continue;
		}
		if (isFlowiseMcpServerId(id)) {
			blocked.push(id);
			continue;
		}
		if (!allowedNames.has(id.toLowerCase())) {
			blocked.push(id);
		}
	}
	return blocked;
}

export function buildClaudeOrgMcpPolicyHints(policy: ClaudeOrgMcpPolicy, blockedIds: string[]): string[] {
	if (!policy.detected || !policy.allowManagedMcpServersOnly || blockedIds.length === 0) {
		return [];
	}
	const hints = [
		"Org MCP allowlist is active — Claude Code will reject servers not on the IT allowlist.",
		"Flowise (flowise-*) shims are never pre-approved; use Cursor Agent, Orchestrator + cursor_agent, or ask IT to allowlist the shim.",
	];
	if (policy.organizationName) {
		hints.unshift(`${policy.organizationName} org policy blocks ${blockedIds.length} selected MCP server(s).`);
	}
	return hints;
}
