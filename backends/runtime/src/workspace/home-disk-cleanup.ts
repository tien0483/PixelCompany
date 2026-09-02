import type { Dirent } from "node:fs";
import { lstat, readdir, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { RuntimeCleanupDisposeMode } from "../core/api-contract";
import { listNvmNodeVersionDirs, resolveInUseNvmNodeVersion } from "./nvm-versions";
import { disposePath, resolveRecycleBinPath } from "./recycle-bin";
import { measureDirectorySize } from "./worktree-disk-usage";

export interface HomeDiskLeftover {
	path: string;
	sizeBytes: number;
	reason: string;
	tier: "tmp" | "npm-cache" | "nvm-cache" | "nvm-version";
}

export interface NvmVersionScanEntry {
	version: string;
	path: string;
	sizeBytes: number;
	inUse: boolean;
}

const NPM_CACHE_TARGETS = ["_cacache", "_npx", "_logs"] as const;

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

function resolveTmpRoots(): string[] {
	const roots = new Set<string>();
	roots.add("/tmp");
	roots.add(tmpdir());
	const tmpdirEnv = process.env.TMPDIR?.trim();
	if (tmpdirEnv) {
		roots.add(resolve(tmpdirEnv));
	}
	return [...roots];
}

async function scanTmpTier(options?: { days?: number }): Promise<HomeDiskLeftover[]> {
	const ageCutoffMs = (options?.days ?? 1) * 24 * 60 * 60 * 1000;
	const recycleBinPath = resolve(resolveRecycleBinPath());
	const leftovers: HomeDiskLeftover[] = [];
	const now = Date.now();

	for (const root of resolveTmpRoots()) {
		let entries: Dirent[];
		try {
			entries = await readdir(root, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isFile() && !entry.isDirectory()) {
				continue;
			}
			if (entry.isSymbolicLink()) {
				continue;
			}
			const fullPath = join(root, entry.name);
			if (resolve(fullPath) === recycleBinPath) {
				continue;
			}
			let entryStat;
			try {
				entryStat = await lstat(fullPath);
			} catch {
				continue;
			}
			const ageMs = now - entryStat.mtimeMs;
			if (!isOlderThanCutoff(ageMs, ageCutoffMs, options?.days)) {
				continue;
			}
			const sizeBytes = entryStat.isDirectory() ? await measureDirectorySize(fullPath) : entryStat.size;
			leftovers.push({
				path: fullPath,
				sizeBytes,
				reason: `Tmp entry older than cutoff under ${root}.`,
				tier: "tmp",
			});
		}
	}
	return leftovers;
}

async function scanNpmCacheTier(): Promise<HomeDiskLeftover[]> {
	const npmHome = join(homedir(), ".npm");
	const leftovers: HomeDiskLeftover[] = [];
	for (const relativePath of NPM_CACHE_TARGETS) {
		const path = join(npmHome, relativePath);
		if (!(await directoryExists(path))) {
			continue;
		}
		leftovers.push({
			path,
			sizeBytes: await measureDirectorySize(path),
			reason: `npm ${relativePath} download cache — rebuilt on next install.`,
			tier: "npm-cache",
		});
	}
	return leftovers;
}

async function scanNvmCacheTier(): Promise<HomeDiskLeftover[]> {
	const path = join(homedir(), ".nvm", ".cache");
	if (!(await directoryExists(path))) {
		return [];
	}
	return [
		{
			path,
			sizeBytes: await measureDirectorySize(path),
			reason: "nvm download cache — re-fetched when installing Node versions.",
			tier: "nvm-cache",
		},
	];
}

export async function scanNvmVersions(home: string = homedir()): Promise<NvmVersionScanEntry[]> {
	const inUseVersion = await resolveInUseNvmNodeVersion(home);
	const entries: NvmVersionScanEntry[] = [];
	for (const versionEntry of listNvmNodeVersionDirs(home)) {
		entries.push({
			version: versionEntry.version,
			path: versionEntry.path,
			sizeBytes: await measureDirectorySize(versionEntry.path),
			inUse: versionEntry.version === inUseVersion,
		});
	}
	return entries;
}

export async function scanHomeDiskCleanup(options?: { days?: number }): Promise<{
	tmp: HomeDiskLeftover[];
	npmCache: HomeDiskLeftover[];
	nvmCache: HomeDiskLeftover[];
	nvmVersions: NvmVersionScanEntry[];
}> {
	const [tmp, npmCache, nvmCache, nvmVersions] = await Promise.all([
		scanTmpTier(options),
		scanNpmCacheTier(),
		scanNvmCacheTier(),
		scanNvmVersions(),
	]);
	return { tmp, npmCache, nvmCache, nvmVersions };
}

export function summarizeHomeDiskCleanup(scan: {
	tmp: HomeDiskLeftover[];
	npmCache: HomeDiskLeftover[];
	nvmCache: HomeDiskLeftover[];
	nvmVersions: NvmVersionScanEntry[];
}): {
	tmpItemCount: number;
	tmpSizeBytes: number;
	npmCacheItemCount: number;
	npmCacheSizeBytes: number;
	nvmCacheItemCount: number;
	nvmCacheSizeBytes: number;
	nvmVersions: NvmVersionScanEntry[];
} {
	const sum = (items: HomeDiskLeftover[]) => items.reduce((total, item) => total + item.sizeBytes, 0);
	return {
		tmpItemCount: scan.tmp.length,
		tmpSizeBytes: sum(scan.tmp),
		npmCacheItemCount: scan.npmCache.length,
		npmCacheSizeBytes: sum(scan.npmCache),
		nvmCacheItemCount: scan.nvmCache.length,
		nvmCacheSizeBytes: sum(scan.nvmCache),
		nvmVersions: scan.nvmVersions,
	};
}

export async function cleanHomeDiskCleanup(options: {
	days?: number;
	dryRun: boolean;
	disposeMode?: RuntimeCleanupDisposeMode;
	includeTmp?: boolean;
	includeNpmCache?: boolean;
	includeNvmCache?: boolean;
	nvmVersions?: string[];
}): Promise<{
	cleaned: HomeDiskLeftover[];
	skipped: { path: string; reason: string }[];
}> {
	const scan = await scanHomeDiskCleanup({ days: options.days });
	const cleaned: HomeDiskLeftover[] = [];
	const skipped: { path: string; reason: string }[] = [];
	const inUseVersion = await resolveInUseNvmNodeVersion();

	const targets: HomeDiskLeftover[] = [];
	if (options.includeTmp) {
		targets.push(...scan.tmp);
	}
	if (options.includeNpmCache) {
		targets.push(...scan.npmCache);
	}
	if (options.includeNvmCache) {
		targets.push(...scan.nvmCache);
	}
	if (options.nvmVersions && options.nvmVersions.length > 0) {
		const selected = new Set(options.nvmVersions);
		for (const versionEntry of scan.nvmVersions) {
			if (!selected.has(versionEntry.version)) {
				continue;
			}
			if (versionEntry.inUse || versionEntry.version === inUseVersion) {
				skipped.push({
					path: versionEntry.path,
					reason: "Node version is currently in use by the runtime.",
				});
				continue;
			}
			targets.push({
				path: versionEntry.path,
				sizeBytes: versionEntry.sizeBytes,
				reason: `nvm Node ${versionEntry.version} install.`,
				tier: "nvm-version",
			});
		}
	}

	for (const target of targets) {
		try {
			const result = await disposePath(target.path, options.disposeMode, {
				dryRun: options.dryRun,
				sizeBytes: target.sizeBytes,
			});
			cleaned.push({ ...target, path: result.destPath, sizeBytes: result.sizeBytes });
		} catch (error) {
			skipped.push({
				path: target.path,
				reason: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return { cleaned, skipped };
}
