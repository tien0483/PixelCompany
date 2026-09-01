import type { Dirent } from "node:fs";
import { lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { measureDirectorySize } from "./worktree-disk-usage";

const NODE_MODULES_DIR_NAME = "node_modules";
const MAX_SCAN_DEPTH = 5;
const WALK_SKIP_DIRS = new Set([".git", ".next", "dist", "build", "coverage"]);

export interface OrphanNodeModuleDir {
	path: string;
	sizeBytes: number;
}

async function isRealNodeModulesDirectory(path: string): Promise<boolean> {
	try {
		const stats = await lstat(path);
		return stats.isDirectory() && !stats.isSymbolicLink();
	} catch {
		return false;
	}
}

/**
 * Finds real (non-symlink) node_modules directories under a task worktree.
 * Symlinked copies from the home repo are tiny and intentional; agents that run
 * install locally leave fat real trees behind.
 */
export async function findOrphanNodeModuleDirs(worktreePath: string): Promise<OrphanNodeModuleDir[]> {
	const found: OrphanNodeModuleDir[] = [];

	async function walk(dir: string, depth: number): Promise<void> {
		if (depth > MAX_SCAN_DEPTH) {
			return;
		}
		let entries: Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const fullPath = join(dir, entry.name);
			if (entry.name === NODE_MODULES_DIR_NAME) {
				if (!entry.isSymbolicLink() && entry.isDirectory()) {
					found.push({
						path: fullPath,
						sizeBytes: await measureDirectorySize(fullPath),
					});
				}
				continue;
			}
			if (!entry.isDirectory() || entry.isSymbolicLink() || WALK_SKIP_DIRS.has(entry.name)) {
				continue;
			}
			await walk(fullPath, depth + 1);
		}
	}

	await walk(worktreePath, 0);
	return found;
}

export async function removeOrphanNodeModuleDirs(
	worktreePath: string,
	dryRun: boolean,
): Promise<{ cleaned: OrphanNodeModuleDir[]; skipped: { path: string; reason: string }[] }> {
	const targets = await findOrphanNodeModuleDirs(worktreePath);
	const cleaned: OrphanNodeModuleDir[] = [];
	const skipped: { path: string; reason: string }[] = [];

	for (const target of targets) {
		if (!(await isRealNodeModulesDirectory(target.path))) {
			continue;
		}
		if (dryRun) {
			cleaned.push(target);
			continue;
		}
		try {
			await rm(target.path, { recursive: true, force: true });
			cleaned.push(target);
		} catch (error) {
			skipped.push({
				path: target.path,
				reason: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return { cleaned, skipped };
}
