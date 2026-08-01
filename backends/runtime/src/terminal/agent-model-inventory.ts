/**
 * Live model inventories for Claude Code and Cursor Agent launch tags.
 *
 * Cursor: `agent --list-models` (or cursor-agent). Claude has no list CLI, so we
 * return documented aliases plus full ids, optionally enriched from settings.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { getRuntimeAgentBinaryCandidates } from "../core/agent-catalog";
import type { RuntimeAgentId, RuntimeAgentModelInventory } from "../core/api-contract";
import { isBinaryAvailableOnPath } from "./command-discovery";

const execFileAsync = promisify(execFile);

const LIST_MODELS_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 60_000;

const CLAUDE_MODEL_CATALOG: Array<{ id: string; label: string }> = [
	{ id: "sonnet", label: "Sonnet (latest alias)" },
	{ id: "opus", label: "Opus (latest alias)" },
	{ id: "haiku", label: "Haiku (latest alias)" },
	{ id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
	{ id: "claude-opus-4-6", label: "Claude Opus 4.6" },
	{ id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
	{ id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
	{ id: "claude-opus-4-5-20251101", label: "Claude Opus 4.5" },
];

const CURSOR_MODEL_FALLBACK: Array<{ id: string; label: string }> = [
	{ id: "auto", label: "Auto" },
	{ id: "composer-2.5", label: "Composer 2.5" },
	{ id: "composer-2", label: "Composer 2" },
	{ id: "gpt-5.2", label: "GPT-5.2" },
	{ id: "claude-4.5-sonnet", label: "Claude 4.5 Sonnet" },
	{ id: "claude-4.6-opus", label: "Claude 4.6 Opus" },
];

type CacheEntry = { expiresAt: number; inventory: RuntimeAgentModelInventory };

const modelCache = new Map<RuntimeAgentId, CacheEntry>();

export function parseCursorListModelsOutput(stdout: string): Array<{ id: string; label: string }> {
	const models: Array<{ id: string; label: string }> = [];
	const seen = new Set<string>();
	for (const rawLine of stdout.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.toLowerCase().startsWith("available models")) {
			continue;
		}
		const match = /^([^\s]+)\s+-\s+(.+)$/.exec(line);
		if (!match) {
			continue;
		}
		const id = (match[1] ?? "").trim();
		const label = (match[2] ?? "").trim();
		if (!id || seen.has(id)) {
			continue;
		}
		seen.add(id);
		models.push({ id, label: label || id });
	}
	return models;
}

async function resolveAgentBinary(agentId: RuntimeAgentId): Promise<string | null> {
	for (const candidate of getRuntimeAgentBinaryCandidates(agentId)) {
		if (isBinaryAvailableOnPath(candidate)) {
			return candidate;
		}
	}
	return null;
}

async function listCursorModelsFromCli(): Promise<Array<{ id: string; label: string }> | null> {
	const binary = await resolveAgentBinary("cursor");
	if (!binary) {
		return null;
	}
	try {
		const { stdout, stderr } = await execFileAsync(binary, ["--list-models"], {
			timeout: LIST_MODELS_TIMEOUT_MS,
			windowsHide: true,
			maxBuffer: 2 * 1024 * 1024,
			env: process.env,
		});
		const parsed = parseCursorListModelsOutput(`${stdout}\n${stderr}`);
		return parsed.length > 0 ? parsed : null;
	} catch {
		return null;
	}
}

async function enrichClaudeModelsFromSettings(
	catalog: Array<{ id: string; label: string }>,
): Promise<Array<{ id: string; label: string }>> {
	const byId = new Map(catalog.map((model) => [model.id, model]));
	const settingsPath = join(homedir(), ".claude", "settings.json");
	try {
		const parsed: unknown = JSON.parse(await readFile(settingsPath, "utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return [...byId.values()];
		}
		const record = parsed as Record<string, unknown>;
		const candidates = [record.model, record.defaultModel, record.preferredModel];
		for (const candidate of candidates) {
			if (typeof candidate !== "string") {
				continue;
			}
			const id = candidate.trim();
			if (!id || byId.has(id)) {
				continue;
			}
			byId.set(id, { id, label: id });
		}
	} catch {
		// Missing settings is fine.
	}
	return [...byId.values()];
}

export async function listAgentModelInventory(agentId: RuntimeAgentId): Promise<RuntimeAgentModelInventory> {
	if (agentId !== "claude" && agentId !== "cursor") {
		return { agentId, models: [], source: "fallback" };
	}

	const cached = modelCache.get(agentId);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.inventory;
	}

	let inventory: RuntimeAgentModelInventory;
	if (agentId === "cursor") {
		const live = await listCursorModelsFromCli();
		if (live) {
			inventory = { agentId, models: live, source: "cli" };
		} else {
			inventory = { agentId, models: CURSOR_MODEL_FALLBACK, source: "fallback" };
		}
	} else {
		const models = await enrichClaudeModelsFromSettings(CLAUDE_MODEL_CATALOG);
		inventory = { agentId, models, source: "catalog" };
	}

	modelCache.set(agentId, { expiresAt: Date.now() + CACHE_TTL_MS, inventory });
	return inventory;
}

/** Test helper — clears the in-process TTL cache. */
export function clearAgentModelInventoryCache(): void {
	modelCache.clear();
}
