import type { Dirent } from "node:fs";
import { lstat, readdir, realpath, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";

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
	/** The top-level allowlisted directory this file was discovered under (used for escape checks). */
	rootDir: string;
}

function resolveClaudeHomeDir(claudeHomeDir?: string): string {
	return claudeHomeDir ?? join(homedir(), ".claude");
}

/**
 * Recursively walks `rootDir`, collecting real (non-symlink) files reachable
 * only through real (non-symlink) directories. Symlinked directories and
 * symlinked files are never followed/collected, so a symlink placed inside an
 * allowlisted directory cannot be used to smuggle files from outside the
 * allowlist into scan results.
 */
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
					results.push({ path: fullPath, sizeBytes: fileStat.size, ageMs: now - fileStat.mtimeMs, rootDir });
				} catch {
					// File disappeared between readdir and lstat; nothing to record.
				}
			}
		}
	}

	await walkDir(rootDir);
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

async function claudeHomeDirExists(claudeHomeDir: string): Promise<boolean> {
	try {
		return (await stat(claudeHomeDir)).isDirectory();
	} catch {
		return false;
	}
}

export async function getClaudeCacheStatus(options?: {
	claudeHomeDir?: string;
	days?: number;
}): Promise<RuntimeClaudeCacheStatusResponse> {
	try {
		const claudeHomeDir = resolveClaudeHomeDir(options?.claudeHomeDir);
		if (!(await claudeHomeDirExists(claudeHomeDir))) {
			return {
				ok: false,
				safeItemCount: 0,
				safeSizeBytes: 0,
				transcriptItemCount: 0,
				transcriptSizeBytes: 0,
				error: "~/.claude not found",
			};
		}
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
		if (!(await claudeHomeDirExists(claudeHomeDir))) {
			return { ok: false, cleaned: [], skipped: [], error: "~/.claude not found" };
		}
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
				// Belt-and-braces: even though the walker never follows symlinks,
				// re-resolve the real path right before deleting and confirm it is
				// still rooted under the allowlisted directory it was discovered in.
				const [resolvedRoot, resolvedPath] = await Promise.all([
					realpath(candidate.file.rootDir),
					realpath(candidate.file.path),
				]);
				const escapesAllowlist = resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + sep);
				if (escapesAllowlist) {
					skipped.push({ path: candidate.file.path, reason: "Path escapes allowlisted directory" });
					continue;
				}
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
