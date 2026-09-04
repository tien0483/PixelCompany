import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { probeGitConflictState } from "./git-conflict-state";
import { runGit } from "./git-utils";
import { listGitWorktrees } from "./git-worktree-inventory";
import { getWorkspaceFolderLabelForWorktreePath, KANBAN_MERGE_WORKTREES_HOME_DIR_NAME } from "./task-worktree-path";

/**
 * Merging into a base ref that no worktree has checked out needs a checkout of its
 * own — git 2.34 ships here, so `merge-tree --write-tree` (2.38+) is not an option.
 *
 * That checkout used to be an `mkdtemp` removed in a `finally`, which meant a
 * conflicting merge had nowhere to *stay*: the conflict state was deleted along
 * with the directory before the response was even sent. These worktrees therefore
 * live at a stable, derivable path and are released only when the operation they
 * hold is finished or aborted, so the next attempt reuses the one already stopped
 * on a conflict instead of starting a second.
 */
export function getMergeWorktreesRootPath(): string {
	return join(homedir(), ...KANBAN_MERGE_WORKTREES_HOME_DIR_NAME.split("/"));
}

/** A path segment safe on every platform, derived from an arbitrary git ref. */
function slugifyRef(ref: string): string {
	const cleaned = ref
		.trim()
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	// A ref differing from another only in stripped characters must not collide.
	const digest = createHash("sha1").update(ref.trim()).digest("hex").slice(0, 8);
	return `${cleaned.slice(0, 48) || "ref"}-${digest}`;
}

/**
 * The repo folder name is not unique across a machine (two checkouts of the same
 * project), so it carries a digest of the absolute path alongside it.
 */
function slugifyRepoPath(repoPath: string): string {
	const label = getWorkspaceFolderLabelForWorktreePath(repoPath).replace(/[^A-Za-z0-9._-]+/g, "-");
	const digest = createHash("sha1").update(repoPath).digest("hex").slice(0, 8);
	return `${label.slice(0, 48) || "workspace"}-${digest}`;
}

export function getMergeWorktreePath(repoPath: string, baseRef: string): string {
	return join(getMergeWorktreesRootPath(), slugifyRepoPath(repoPath), slugifyRef(baseRef));
}

export function isMergeWorktreePath(candidate: string): boolean {
	const root = getMergeWorktreesRootPath();
	return candidate === root || candidate.startsWith(`${root}/`) || candidate.startsWith(`${root}\\`);
}

export interface BorrowedWorktree {
	path: string;
	/** False when an existing checkout at this path was reused. */
	created: boolean;
}

export type BorrowWorktreeResult =
	| { ok: true; worktree: BorrowedWorktree }
	| { ok: false; output: string; error: string };

/**
 * Gives `baseRef` a checkout of its own at a stable path, reusing one already
 * registered there.
 *
 * `git worktree add` performs a checkout, which fires the repo's `post-checkout`
 * hook *before* the runtime has linked any dependencies into the new directory —
 * see `worktree-hooks-fire-before-symlinks` in AGENTS.md. A hook that hard-fails on
 * absent deps makes this return an error rather than a worktree.
 */
export async function borrowBaseWorktree(repoPath: string, baseRef: string): Promise<BorrowWorktreeResult> {
	const worktreePath = getMergeWorktreePath(repoPath, baseRef);

	const inventory = await listGitWorktrees(repoPath);
	if (inventory.ok && inventory.worktrees.some((entry) => entry.path === worktreePath)) {
		return { ok: true, worktree: { path: worktreePath, created: false } };
	}

	// A directory left behind by a killed process would make `worktree add` fail
	// with "already exists"; git no longer knows about it, so it is safe to drop.
	await rm(worktreePath, { force: true, recursive: true });
	await runGit(repoPath, ["worktree", "prune"]);
	await mkdir(join(worktreePath, ".."), { recursive: true });

	const addResult = await runGit(repoPath, ["worktree", "add", worktreePath, baseRef]);
	if (!addResult.ok) {
		await rm(worktreePath, { force: true, recursive: true });
		return {
			ok: false,
			output: addResult.output,
			error: addResult.error ?? `Could not check out '${baseRef}' to merge into.`,
		};
	}
	return { ok: true, worktree: { path: worktreePath, created: true } };
}

export async function releaseBaseWorktree(repoPath: string, worktreePath: string): Promise<void> {
	await runGit(repoPath, ["worktree", "remove", "--force", worktreePath]);
	await rm(worktreePath, { force: true, recursive: true });
	await runGit(repoPath, ["worktree", "prune"]);
}

/**
 * Releases every borrowed base worktree that is no longer holding an unfinished
 * operation. Called from "Clean merged worktrees" so the existing button reaps
 * them; a conflict the user has not dealt with yet is left alone.
 */
export async function sweepIdleMergeWorktrees(repoPath: string): Promise<string[]> {
	const inventory = await listGitWorktrees(repoPath);
	if (!inventory.ok) {
		return [];
	}
	const released: string[] = [];
	for (const entry of inventory.worktrees) {
		if (entry.isMain || !isMergeWorktreePath(entry.path)) {
			continue;
		}
		const state = await probeGitConflictState(entry.path).catch(() => null);
		if (state?.operation) {
			continue;
		}
		await releaseBaseWorktree(repoPath, entry.path);
		released.push(entry.path);
	}
	return released;
}
