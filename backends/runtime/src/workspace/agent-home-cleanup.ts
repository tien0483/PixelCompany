import type { Dirent } from "node:fs";
import { lstat, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { measureDirectorySize } from "./worktree-disk-usage";

export type AgentHomeCleanupTier = "cursor" | "gemini" | "antigravity";

export interface AgentHomeLeftover {
	path: string;
	sizeBytes: number;
	reason: string;
	tier: AgentHomeCleanupTier;
}

interface ScannedFile {
	path: string;
	sizeBytes: number;
	ageMs: number;
}

const CURSOR_HOME = ".cursor";
const GEMINI_HOME = ".gemini";
const ANTIGRAVITY_HOME = ".antigravity";

/** Whole subtrees under the Cursor home that are safe to remove wholesale. */
const CURSOR_WHOLE_DIR_TARGETS = ["chats", "ai-tracking"] as const;

/** Age-gated files under Cursor projects agent-transcripts directories. */
const CURSOR_TRANSCRIPT_SUFFIX = ".jsonl";

/**
 * Cache and scratch paths under the Gemini home directory. OAuth, accounts,
 * config, skills, and antigravity-cli/bin are deliberately excluded.
 */
const GEMINI_WHOLE_DIR_TARGETS = [
	"tmp",
	"antigravity-cli/conversations",
	"antigravity-cli/brain",
	"antigravity-cli/log",
	"antigravity-cli/cache",
	"antigravity-cli/scratch",
] as const;

/** Optional standalone Antigravity home on some installs. */
const ANTIGRAVITY_HOME_WHOLE_DIR_TARGETS = [
	"cache",
	"tmp",
	"logs",
	"conversations",
	"brain",
	"scratch",
	"log",
] as const;

function resolveHome(...segments: string[]): string {
	return join(homedir(), ...segments);
}

function isOlderThanCutoff(ageMs: number, ageCutoffMs: number, days: number | undefined): boolean {
	if (days === 0) {
		return true;
	}
	return ageMs > ageCutoffMs;
}

async function directoryExists(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

async function walkFiles(rootDir: string): Promise<ScannedFile[]> {
	const results: ScannedFile[] = [];
	const now = Date.now();

	async function walkDir(dir: string): Promise<void> {
		let entries: Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const fullPath = join(dir, entry.name);
			if (entry.isDirectory() && !entry.isSymbolicLink()) {
				await walkDir(fullPath);
				continue;
			}
			if (entry.isFile() && !entry.isSymbolicLink()) {
				try {
					const fileStat = await lstat(fullPath);
					results.push({ path: fullPath, sizeBytes: fileStat.size, ageMs: now - fileStat.mtimeMs });
				} catch {
					// File disappeared between readdir and lstat.
				}
			}
		}
	}

	await walkDir(rootDir);
	return results;
}

async function scanWholeDirTargets(
	homeRoot: string,
	relativeTargets: readonly string[],
	tier: AgentHomeCleanupTier,
	reason: string,
): Promise<AgentHomeLeftover[]> {
	const leftovers: AgentHomeLeftover[] = [];
	for (const relativePath of relativeTargets) {
		const path = join(homeRoot, relativePath);
		if (!(await directoryExists(path))) {
			continue;
		}
		leftovers.push({
			path,
			sizeBytes: await measureDirectorySize(path),
			reason,
			tier,
		});
	}
	return leftovers;
}

async function scanCursorTranscripts(days: number | undefined, ageCutoffMs: number): Promise<AgentHomeLeftover[]> {
	const projectsDir = join(resolveHome(CURSOR_HOME), "projects");
	const files = (await walkFiles(projectsDir)).filter(
		(file) => file.path.includes("/agent-transcripts/") && file.path.endsWith(CURSOR_TRANSCRIPT_SUFFIX),
	);
	const matching = files.filter((file) => isOlderThanCutoff(file.ageMs, ageCutoffMs, days));
	if (matching.length === 0) {
		return [];
	}
	return [
		{
			path: join(projectsDir, "agent-transcripts"),
			sizeBytes: matching.reduce((sum, file) => sum + file.sizeBytes, 0),
			reason: `${matching.length} Cursor agent transcript file(s) under ~/.cursor/projects.`,
			tier: "cursor",
		},
	];
}

export async function scanAgentHomes(options?: { days?: number }): Promise<AgentHomeLeftover[]> {
	const ageCutoffMs = (options?.days ?? 1) * 24 * 60 * 60 * 1000;
	const leftovers: AgentHomeLeftover[] = [];

	leftovers.push(
		...(await scanWholeDirTargets(
			resolveHome(CURSOR_HOME),
			CURSOR_WHOLE_DIR_TARGETS,
			"cursor",
			"Cursor chat and telemetry cache — rebuilt on next IDE session.",
		)),
	);

	const cursorTranscripts = await scanCursorTranscripts(options?.days, ageCutoffMs);
	leftovers.push(...cursorTranscripts);

	leftovers.push(
		...(await scanWholeDirTargets(
			resolveHome(GEMINI_HOME),
			GEMINI_WHOLE_DIR_TARGETS,
			"gemini",
			"Gemini / Antigravity CLI cache — conversations and scratch data; OAuth is untouched.",
		)),
	);

	leftovers.push(
		...(await scanWholeDirTargets(
			resolveHome(ANTIGRAVITY_HOME),
			ANTIGRAVITY_HOME_WHOLE_DIR_TARGETS,
			"antigravity",
			"Standalone Antigravity home cache — credentials elsewhere are untouched.",
		)),
	);

	return leftovers;
}

export function summarizeAgentHomes(leftovers: AgentHomeLeftover[]): {
	cursorCacheItemCount: number;
	cursorCacheSizeBytes: number;
	geminiCacheItemCount: number;
	geminiCacheSizeBytes: number;
	antigravityHomeItemCount: number;
	antigravityHomeSizeBytes: number;
} {
	const byTier = (tier: AgentHomeCleanupTier) => leftovers.filter((item) => item.tier === tier);
	const sum = (items: AgentHomeLeftover[]) => items.reduce((total, item) => total + item.sizeBytes, 0);
	const cursor = byTier("cursor");
	const gemini = byTier("gemini");
	const antigravity = byTier("antigravity");
	return {
		cursorCacheItemCount: cursor.length,
		cursorCacheSizeBytes: sum(cursor),
		geminiCacheItemCount: gemini.length,
		geminiCacheSizeBytes: sum(gemini),
		antigravityHomeItemCount: antigravity.length,
		antigravityHomeSizeBytes: sum(antigravity),
	};
}

export async function cleanAgentHomes(options: {
	days?: number;
	dryRun: boolean;
	includeCursor?: boolean;
	includeGemini?: boolean;
	includeAntigravityHome?: boolean;
}): Promise<{ cleaned: AgentHomeLeftover[]; skipped: { path: string; reason: string }[] }> {
	const leftovers = await scanAgentHomes({ days: options.days });
	const cleaned: AgentHomeLeftover[] = [];
	const skipped: { path: string; reason: string }[] = [];

	const tierEnabled = (tier: AgentHomeCleanupTier): boolean => {
		if (tier === "cursor") {
			return options.includeCursor === true;
		}
		if (tier === "gemini") {
			return options.includeGemini === true;
		}
		return options.includeAntigravityHome === true;
	};

	// Cursor transcripts are individual files, not the summary directory path.
	if (options.includeCursor) {
		const ageCutoffMs = (options.days ?? 1) * 24 * 60 * 60 * 1000;
		const projectsDir = join(resolveHome(CURSOR_HOME), "projects");
		const transcriptFiles = (await walkFiles(projectsDir)).filter(
			(file) => file.path.includes("/agent-transcripts/") && file.path.endsWith(CURSOR_TRANSCRIPT_SUFFIX),
		);
		for (const file of transcriptFiles) {
			if (!isOlderThanCutoff(file.ageMs, ageCutoffMs, options.days)) {
				continue;
			}
			if (options.dryRun) {
				cleaned.push({
					path: file.path,
					sizeBytes: file.sizeBytes,
					reason: "Cursor agent transcript",
					tier: "cursor",
				});
				continue;
			}
			try {
				await rm(file.path, { force: true });
				cleaned.push({
					path: file.path,
					sizeBytes: file.sizeBytes,
					reason: "Cursor agent transcript",
					tier: "cursor",
				});
			} catch (error) {
				skipped.push({
					path: file.path,
					reason: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}

	for (const leftover of leftovers) {
		if (!tierEnabled(leftover.tier)) {
			continue;
		}
		// Summary-only cursor transcript row from scan — real deletes happen above.
		if (leftover.path.endsWith("agent-transcripts") && leftover.tier === "cursor") {
			continue;
		}
		if (options.dryRun) {
			cleaned.push(leftover);
			continue;
		}
		try {
			await rm(leftover.path, { recursive: true, force: true });
			cleaned.push(leftover);
		} catch (error) {
			skipped.push({
				path: leftover.path,
				reason: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return { cleaned, skipped };
}
