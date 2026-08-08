import { readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type {
	RuntimeClaudeCacheCleanRequest,
	RuntimeClaudeCacheCleanResponse,
	RuntimeClaudeCacheStatusResponse,
} from "../core/api-contract";

const SAFE_TIER_SUBDIRS = ["cache", "paste-cache", "shell-snapshots", "file-history"] as const;
const DEFAULT_SAFE_AGE_DAYS = 7;

interface ScannedFile {
	path: string;
	sizeBytes: number;
	ageMs: number;
}

function resolveClaudeHomeDir(claudeHomeDir?: string): string {
	return claudeHomeDir ?? join(homedir(), ".claude");
}

async function walkFiles(rootDir: string): Promise<ScannedFile[]> {
	const results: ScannedFile[] = [];
	let entries: string[];
	try {
		entries = await readdir(rootDir, { recursive: true } as never);
	} catch {
		return results;
	}
	const now = Date.now();
	for (const entry of entries) {
		const fullPath = join(rootDir, entry);
		let fileStat: { isDirectory: () => boolean; size: number; mtimeMs: number };
		try {
			fileStat = await stat(fullPath);
		} catch {
			continue;
		}
		if (fileStat.isDirectory()) {
			continue;
		}
		results.push({ path: fullPath, sizeBytes: fileStat.size, ageMs: now - fileStat.mtimeMs });
	}
	return results;
}

async function scanSafeTier(claudeHomeDir: string): Promise<ScannedFile[]> {
	const all: ScannedFile[] = [];
	for (const subdir of SAFE_TIER_SUBDIRS) {
		all.push(...(await walkFiles(join(claudeHomeDir, subdir))));
	}
	return all;
}

async function scanTranscriptTier(claudeHomeDir: string): Promise<ScannedFile[]> {
	const projectsDir = join(claudeHomeDir, "projects");
	const files = await walkFiles(projectsDir);
	return files.filter((file) => file.path.endsWith(".jsonl"));
}

export async function getClaudeCacheStatus(options?: {
	claudeHomeDir?: string;
	days?: number;
}): Promise<RuntimeClaudeCacheStatusResponse> {
	try {
		const claudeHomeDir = resolveClaudeHomeDir(options?.claudeHomeDir);
		const ageCutoffMs = (options?.days ?? DEFAULT_SAFE_AGE_DAYS) * 24 * 60 * 60 * 1000;
		const safeFiles = (await scanSafeTier(claudeHomeDir)).filter((file) => file.ageMs > ageCutoffMs);
		const transcriptFiles = (await scanTranscriptTier(claudeHomeDir)).filter((file) => file.ageMs > ageCutoffMs);
		return {
			ok: true,
			safeItemCount: safeFiles.length,
			safeSizeBytes: safeFiles.reduce((sum, file) => sum + file.sizeBytes, 0),
			transcriptItemCount: transcriptFiles.length,
			transcriptSizeBytes: transcriptFiles.reduce((sum, file) => sum + file.sizeBytes, 0),
		};
	} catch (error) {
		return {
			ok: false,
			safeItemCount: 0,
			safeSizeBytes: 0,
			transcriptItemCount: 0,
			transcriptSizeBytes: 0,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function cleanClaudeCache(
	options: RuntimeClaudeCacheCleanRequest & { claudeHomeDir?: string },
): Promise<RuntimeClaudeCacheCleanResponse> {
	try {
		const claudeHomeDir = resolveClaudeHomeDir(options.claudeHomeDir);
		const ageCutoffMs = (options.days ?? DEFAULT_SAFE_AGE_DAYS) * 24 * 60 * 60 * 1000;

		const candidates: { file: ScannedFile; tier: "safe" | "transcript" }[] = [];
		for (const file of await scanSafeTier(claudeHomeDir)) {
			if (file.ageMs > ageCutoffMs) {
				candidates.push({ file, tier: "safe" });
			}
		}
		if (options.includeTranscripts) {
			for (const file of await scanTranscriptTier(claudeHomeDir)) {
				if (file.ageMs > ageCutoffMs) {
					candidates.push({ file, tier: "transcript" });
				}
			}
		}

		const cleaned: { path: string; sizeBytes: number; tier: "safe" | "transcript" }[] = [];
		const skipped: { path: string; reason: string }[] = [];

		for (const candidate of candidates) {
			if (options.dryRun) {
				cleaned.push({ path: candidate.file.path, sizeBytes: candidate.file.sizeBytes, tier: candidate.tier });
				continue;
			}
			try {
				await rm(candidate.file.path, { force: true });
				cleaned.push({ path: candidate.file.path, sizeBytes: candidate.file.sizeBytes, tier: candidate.tier });
			} catch (error) {
				skipped.push({
					path: candidate.file.path,
					reason: error instanceof Error ? error.message : String(error),
				});
			}
		}

		return { ok: true, cleaned, skipped };
	} catch (error) {
		return { ok: false, cleaned: [], skipped: [], error: error instanceof Error ? error.message : String(error) };
	}
}
