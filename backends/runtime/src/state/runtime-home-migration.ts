// One-time carry-forward of runtime state from the legacy `~/.cline` home to the
// vendor-neutral `~/.agent` home.
//
// What lives there is not just preferences: `kanban/workspaces/<id>/board.json`
// holds the boards themselves, plus sessions and the workspace index. So this
// copies rather than moves — the legacy tree is left untouched as a backup, and a
// half-finished copy can simply be deleted and retried.
//
// Worktrees are deliberately NOT migrated: git records absolute paths inside
// `.git/worktrees/*/gitdir`, so relocating a worktree directory behind git's back
// breaks it. Existing worktrees keep resolving from the legacy root instead
// (see `getWorktreesRootPath` in workspace/task-worktree.ts).
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import { getLegacyRuntimeHomePath, getRuntimeHomePath } from "./workspace-state";

export interface MigrateRuntimeHomeResult {
	/** True when this call copied the legacy tree. */
	migrated: boolean;
	/** Why the migration was skipped, for logging. */
	reason: "already-present" | "no-legacy-state" | "copied" | "failed";
	source: string;
	target: string;
	error?: string;
}

async function directoryHasEntries(path: string): Promise<boolean> {
	try {
		const info = await stat(path);
		if (!info.isDirectory()) {
			return false;
		}
		const entries = await readdir(path);
		return entries.length > 0;
	} catch {
		return false;
	}
}

/**
 * Copies `~/.cline/kanban` to `~/.agent/kanban` when the new home has no state yet.
 *
 * Idempotent: a non-empty target is left alone, so a user who has already run the
 * new layout never has newer boards overwritten by stale ones. Never throws — a
 * failed migration degrades to "start fresh", which is recoverable by hand, while
 * a thrown error would stop the runtime from booting at all.
 */
export async function migrateRuntimeHome(): Promise<MigrateRuntimeHomeResult> {
	const source = getLegacyRuntimeHomePath();
	const target = getRuntimeHomePath();

	if (await directoryHasEntries(target)) {
		return { migrated: false, reason: "already-present", source, target };
	}
	if (!(await directoryHasEntries(source))) {
		return { migrated: false, reason: "no-legacy-state", source, target };
	}

	try {
		await mkdir(dirname(target), { recursive: true });
		await cp(source, target, { recursive: true, errorOnExist: false, force: true });
		return { migrated: true, reason: "copied", source, target };
	} catch (error) {
		// Remove the partial copy so the next start retries cleanly instead of
		// loading half a workspace index.
		await rm(target, { recursive: true, force: true }).catch(() => {});
		return {
			migrated: false,
			reason: "failed",
			source,
			target,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/** Human-readable one-liner for the startup log; null when nothing worth saying. */
export function describeRuntimeHomeMigration(result: MigrateRuntimeHomeResult): string | null {
	if (result.reason === "copied") {
		return `Migrated runtime state ${result.source} → ${result.target} (the original is kept as a backup).`;
	}
	if (result.reason === "failed") {
		return `Could not migrate runtime state from ${result.source}: ${result.error ?? "unknown error"}. Starting with empty state; the original is untouched.`;
	}
	return null;
}

/** Exported for tests: where per-workspace boards land under a runtime home. */
export function getWorkspacesDirectoryForHome(home: string): string {
	return join(home, "workspaces");
}
