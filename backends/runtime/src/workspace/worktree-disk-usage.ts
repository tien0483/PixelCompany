import type { Dirent } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Measures how much disk a task worktree actually occupies.
 *
 * Symlinks are counted as their own (tiny) link size and never followed. That is
 * not a defensive nicety here, it is the whole point: `syncIgnoredPathsIntoWorktree`
 * symlinks `node_modules`, `backends/jacked/.venv` and `frontends/pixel_office/dist`
 * from the main checkout into every worktree, so a following walker would report
 * the shared store's size once per worktree — turning a 30 MB worktree into a
 * "1 GB" one — and could walk clean out of the worktree entirely.
 *
 * Sizes are apparent byte totals, not on-disk block usage, so they will differ
 * slightly from `du`. That is fine for the "how much would this free" estimate
 * this feeds; it costs a stat per file either way and avoids platform-specific
 * block-size handling.
 */
export async function measureDirectorySize(rootPath: string): Promise<number> {
	let total = 0;

	async function walk(dir: string): Promise<void> {
		let entries: Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			// Unreadable or vanished mid-walk: contributes nothing rather than
			// failing the whole scan. A cleanup preview that errors out because one
			// directory was busy is worse than one that under-reports slightly.
			return;
		}
		for (const entry of entries) {
			const fullPath = join(dir, entry.name);
			if (entry.isSymbolicLink()) {
				try {
					total += (await lstat(fullPath)).size;
				} catch {
					// Dangling symlink; nothing to add.
				}
				continue;
			}
			if (entry.isDirectory()) {
				await walk(fullPath);
				continue;
			}
			if (entry.isFile()) {
				try {
					total += (await lstat(fullPath)).size;
				} catch {
					// Disappeared between readdir and lstat.
				}
			}
		}
	}

	await walk(rootPath);
	return total;
}
