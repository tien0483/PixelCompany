import type { Dirent } from "node:fs";
import { lstat, readdir, realpath, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";

import type {
	RuntimeClaudeCacheCleanRequest,
	RuntimeClaudeCacheCleanResponse,
	RuntimeClaudeCacheStatusResponse,
} from "../core/api-contract";
import { getLegacyRuntimeHomePath, getRuntimeHomePath, getTaskWorktreesHomePath } from "../state/workspace-state";
import { measureDirectorySize } from "./worktree-disk-usage";

const SAFE_TIER_SUBDIRS = ["cache", "paste-cache", "shell-snapshots", "file-history"] as const;
const DEFAULT_SAFE_AGE_DAYS = 7;
const CLAUDE_CLI_CACHE_DIR_NAME = "claude-cli-nodejs";

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

/**
 * A whole directory that is dead by identity rather than by age.
 */
interface LegacyLeftover {
	path: string;
	sizeBytes: number;
	reason: string;
}

/**
 * Claude Code names each cache directory after the cwd it was launched in, with
 * `/` and `.` both flattened to `-`. That mapping is lossy — `akselos-dev`
 * contains a real dash — so decoding a name back to a path is not reliable.
 *
 * Instead of decoding, this only considers directories that start with the
 * encoded worktrees root and reads the single segment after it as a task id. A
 * task id never contains a dash (`normalizeTaskIdForWorktreePath` rejects path
 * separators and these are short hex ids), so that one segment is unambiguous,
 * and the directory is only proposed for deletion when `<worktreesRoot>/<taskId>`
 * is genuinely gone. Anything outside the worktrees root is left alone.
 */
function findStaleWorktreeCacheTaskId(dirName: string, encodedWorktreesRootPrefix: string): string | null {
	if (!dirName.startsWith(`${encodedWorktreesRootPrefix}-`)) {
		return null;
	}
	const remainder = dirName.slice(encodedWorktreesRootPrefix.length + 1);
	const taskId = remainder.split("-")[0];
	return taskId && taskId.length > 0 ? taskId : null;
}

function encodePathForClaudeCacheDirName(path: string): string {
	return path.replaceAll("/", "-").replaceAll(".", "-");
}

async function scanLegacyTier(): Promise<LegacyLeftover[]> {
	const leftovers: LegacyLeftover[] = [];

	// The pre-rename runtime home. `migrateRuntimeHome` copies boards forward once
	// and nothing reads the old tree afterwards, so it is only kept alive by never
	// having been deleted. Guard on the migration actually having happened.
	const legacyHome = getLegacyRuntimeHomePath();
	const currentHome = getRuntimeHomePath();
	if ((await directoryExists(legacyHome)) && (await directoryExists(currentHome))) {
		leftovers.push({
			path: legacyHome,
			sizeBytes: await measureDirectorySize(legacyHome),
			reason: "Superseded by the current runtime home; kept only because nothing deleted it.",
		});
	}

	const worktreesRoot = getTaskWorktreesHomePath();
	const encodedPrefix = encodePathForClaudeCacheDirName(worktreesRoot);
	const cacheRoot = join(homedir(), ".cache", CLAUDE_CLI_CACHE_DIR_NAME);
	let cacheDirs: string[];
	try {
		cacheDirs = await readdir(cacheRoot);
	} catch {
		cacheDirs = [];
	}
	for (const dirName of cacheDirs) {
		const taskId = findStaleWorktreeCacheTaskId(dirName, encodedPrefix);
		if (!taskId) {
			continue;
		}
		if (await directoryExists(join(worktreesRoot, taskId))) {
			continue;
		}
		const path = join(cacheRoot, dirName);
		leftovers.push({
			path,
			sizeBytes: await measureDirectorySize(path),
			reason: `Task worktree ${taskId} no longer exists.`,
		});
	}

	return leftovers;
}

async function directoryExists(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
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
		const legacyLeftovers = await scanLegacyTier();
		return {
			ok: true,
			safeItemCount: safeFiles.length,
			safeSizeBytes: safeFiles.reduce((sum, file) => sum + file.sizeBytes, 0),
			transcriptItemCount: transcriptFiles.length,
			transcriptSizeBytes: transcriptFiles.reduce((sum, file) => sum + file.sizeBytes, 0),
			legacyItemCount: legacyLeftovers.length,
			legacySizeBytes: legacyLeftovers.reduce((sum, item) => sum + item.sizeBytes, 0),
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
		if (options.includeSafe !== false) {
			for (const file of await scanSafeTier(claudeHomeDir)) {
				if (file.ageMs > ageCutoffMs) {
					candidates.push({ file, tier: "safe" });
				}
			}
		}
		if (options.includeTranscripts) {
			for (const file of await scanTranscriptTier(claudeHomeDir)) {
				if (file.ageMs > ageCutoffMs) {
					candidates.push({ file, tier: "transcript" });
				}
			}
		}

		const cleaned: { path: string; sizeBytes: number; tier: "safe" | "transcript" | "legacy" }[] = [];
		const skipped: { path: string; reason: string }[] = [];

		// Legacy leftovers are whole directories outside the age-gated allowlist, so
		// they are handled separately from the per-file candidates below rather than
		// being forced through a walker that assumes files.
		if (options.includeLegacy) {
			for (const leftover of await scanLegacyTier()) {
				if (options.dryRun) {
					cleaned.push({ path: leftover.path, sizeBytes: leftover.sizeBytes, tier: "legacy" });
					continue;
				}
				try {
					await rm(leftover.path, { recursive: true, force: true });
					cleaned.push({ path: leftover.path, sizeBytes: leftover.sizeBytes, tier: "legacy" });
				} catch (error) {
					skipped.push({
						path: leftover.path,
						reason: error instanceof Error ? error.message : String(error),
					});
				}
			}
		}

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
