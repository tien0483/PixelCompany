import type { Dirent } from "node:fs";
import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { readBrandEnv } from "../brand";
import type { RuntimeCleanupDisposeMode } from "../core/api-contract";
import { RUNTIME_HOME_PARENT_DIR_NAME } from "./task-worktree-path";
import { measureDirectorySize } from "./worktree-disk-usage";

const DEFAULT_RECYCLE_BIN_DIR = join(homedir(), RUNTIME_HOME_PARENT_DIR_NAME, "recycle-bin");

export interface RecycleBinEntry {
	path: string;
	sizeBytes: number;
}

export interface RecycleBinScanResult {
	path: string;
	itemCount: number;
	sizeBytes: number;
	entries: RecycleBinEntry[];
}

export function resolveRecycleBinPath(): string {
	const override = readBrandEnv("RECYCLE_BIN")?.trim();
	return override && override.length > 0 ? override : DEFAULT_RECYCLE_BIN_DIR;
}

export async function ensureRecycleBinDir(): Promise<string> {
	const path = resolveRecycleBinPath();
	await mkdir(path, { recursive: true });
	return path;
}

function sanitizeBasename(name: string): string {
	const trimmed = name.trim();
	if (trimmed.length === 0) {
		return "item";
	}
	return trimmed.replaceAll(/[^\w.-]+/g, "_").slice(0, 120);
}

async function resolveUniqueDestPath(recycleBinDir: string, sourcePath: string): Promise<string> {
	const stamp = new Date().toISOString().replaceAll(":", "-");
	const baseName = sanitizeBasename(basename(sourcePath));
	let candidate = join(recycleBinDir, `${stamp}-${baseName}`);
	let suffix = 1;
	while (true) {
		try {
			await stat(candidate);
			candidate = join(recycleBinDir, `${stamp}-${baseName}-${suffix}`);
			suffix += 1;
		} catch {
			return candidate;
		}
	}
}

async function measurePathSize(path: string): Promise<number> {
	try {
		const entryStat = await stat(path);
		if (entryStat.isDirectory()) {
			return await measureDirectorySize(path);
		}
		return entryStat.size;
	} catch {
		return 0;
	}
}

/**
 * Moves `sourcePath` into the recycle bin. Uses rename when possible; falls back
 * to copy+unlink when crossing filesystem boundaries.
 */
export async function moveToRecycleBin(sourcePath: string): Promise<{ destPath: string; sizeBytes: number }> {
	const recycleBinDir = await ensureRecycleBinDir();
	const sizeBytes = await measurePathSize(sourcePath);
	const destPath = await resolveUniqueDestPath(recycleBinDir, sourcePath);
	try {
		await rename(sourcePath, destPath);
	} catch {
		await cp(sourcePath, destPath, { recursive: true, force: true });
		await rm(sourcePath, { recursive: true, force: true });
	}
	return { destPath, sizeBytes };
}

export async function scanRecycleBin(): Promise<RecycleBinScanResult> {
	const path = resolveRecycleBinPath();
	let entries: Dirent[];
	try {
		entries = await readdir(path, { withFileTypes: true });
	} catch {
		return { path, itemCount: 0, sizeBytes: 0, entries: [] };
	}
	const scanned: RecycleBinEntry[] = [];
	for (const entry of entries) {
		const fullPath = join(path, entry.name);
		scanned.push({ path: fullPath, sizeBytes: await measurePathSize(fullPath) });
	}
	return {
		path,
		itemCount: scanned.length,
		sizeBytes: scanned.reduce((sum, item) => sum + item.sizeBytes, 0),
		entries: scanned,
	};
}

export async function emptyRecycleBin(options?: {
	dryRun?: boolean;
}): Promise<{ cleaned: RecycleBinEntry[]; skipped: { path: string; reason: string }[] }> {
	const scan = await scanRecycleBin();
	const cleaned: RecycleBinEntry[] = [];
	const skipped: { path: string; reason: string }[] = [];
	for (const entry of scan.entries) {
		if (options?.dryRun) {
			cleaned.push(entry);
			continue;
		}
		try {
			await rm(entry.path, { recursive: true, force: true });
			cleaned.push(entry);
		} catch (error) {
			skipped.push({
				path: entry.path,
				reason: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return { cleaned, skipped };
}

export async function disposePath(
	path: string,
	mode: RuntimeCleanupDisposeMode | undefined,
	options?: { dryRun?: boolean; sizeBytes?: number },
): Promise<{ destPath: string; sizeBytes: number }> {
	const sizeBytes = options?.sizeBytes ?? (await measurePathSize(path));
	if (options?.dryRun) {
		return { destPath: path, sizeBytes };
	}
	if (mode === "recycle-bin") {
		const moved = await moveToRecycleBin(path);
		return moved;
	}
	await rm(path, { recursive: true, force: true });
	return { destPath: path, sizeBytes };
}
