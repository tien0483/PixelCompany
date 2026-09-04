import type { RuntimeGitPendingOperation } from "../core/api-contract";
import { gitPathExists, resolveGitRepoRoot, runGit } from "./git-utils";

/**
 * A conflicting merge, rebase or cherry-pick is deliberately *left in place* so the
 * user can resolve it from the Resolve-merge-conflicts dialog. Every one of those
 * operations used to run its `--abort` in the failure branch, which meant
 * `MERGE_HEAD` never survived a request and the dialog could never see a conflict.
 *
 * Continuing an operation must not open an editor: a spawned git with no tty either
 * blocks forever or fails, depending on what `core.editor` resolves to. `-c
 * core.editor=true` is passed per invocation rather than teaching `runGit` an env
 * option, so nothing else gains a way to push environment into a git child.
 */
const NO_EDITOR_CONFIG = ["-c", "core.editor=true"];

export interface GitConflictState {
	operation: RuntimeGitPendingOperation | null;
	/** Paths with unmerged index entries. Empty while an operation is stopped for another reason. */
	paths: string[];
	/**
	 * `--autostash` is holding uncommitted work out of the working tree. Worth
	 * reporting because the user *sees* those edits missing while resolving, and
	 * nothing in the working tree says where they went — see
	 * {@link isAutostashHeld}.
	 */
	autostashHeld: boolean;
}

export async function isMergeInProgress(repoRoot: string): Promise<boolean> {
	const mergeHead = await runGit(repoRoot, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
	return mergeHead.ok;
}

export async function isRebaseInProgress(repoRoot: string): Promise<boolean> {
	const rebaseMerge = await gitPathExists(repoRoot, "rebase-merge");
	if (rebaseMerge) {
		return true;
	}
	return await gitPathExists(repoRoot, "rebase-apply");
}

export async function isCherryPickInProgress(repoRoot: string): Promise<boolean> {
	const cherryPickHead = await runGit(repoRoot, ["rev-parse", "-q", "--verify", "CHERRY_PICK_HEAD"]);
	return cherryPickHead.ok;
}

/**
 * Whether `--autostash` is currently holding the user's uncommitted work.
 *
 * A merge records it in the `MERGE_AUTOSTASH` ref — *not* in `git stash list`, so
 * looking there finds nothing and reads as lost work. A rebase keeps it as a file
 * in the sequencer directory instead. Measured on git 2.34.1: the entry is applied
 * back by `git commit --no-edit`, by `merge --continue` and by `merge --abort`
 * alike, so no finishing path drops it.
 */
export async function isAutostashHeld(repoRoot: string): Promise<boolean> {
	const mergeAutostash = await runGit(repoRoot, ["rev-parse", "-q", "--verify", "MERGE_AUTOSTASH"]);
	if (mergeAutostash.ok) {
		return true;
	}
	return await gitPathExists(repoRoot, "rebase-merge/autostash");
}

export async function listUnmergedPaths(repoRoot: string): Promise<string[]> {
	const unmergedResult = await runGit(repoRoot, ["diff", "--name-only", "--diff-filter=U", "-z"]);
	if (!unmergedResult.ok) {
		return [];
	}
	return unmergedResult.stdout.split("\0").filter(Boolean);
}

/**
 * Which operation, if any, this worktree is stopped in the middle of.
 *
 * Measured on git 2.34.1, the three markers are mutually exclusive: a conflicted
 * rebase has only `REBASE_HEAD` + `rebase-merge/`, a conflicted cherry-pick only
 * `CHERRY_PICK_HEAD`, a conflicted merge only `MERGE_HEAD`. Rebase is still tested
 * first so that a future git which sets the sequencer's `CHERRY_PICK_HEAD` during a
 * rebase step cannot make us offer `git commit`, which does not advance a rebase.
 */
export async function probeGitConflictState(repoRoot: string): Promise<GitConflictState> {
	const [rebase, cherryPick, merge] = await Promise.all([
		isRebaseInProgress(repoRoot),
		isCherryPickInProgress(repoRoot),
		isMergeInProgress(repoRoot),
	]);
	const operation: RuntimeGitPendingOperation | null = rebase
		? "rebase"
		: cherryPick
			? "cherry-pick"
			: merge
				? "merge"
				: null;
	if (!operation) {
		return { operation: null, paths: [], autostashHeld: false };
	}
	const [paths, autostashHeld] = await Promise.all([listUnmergedPaths(repoRoot), isAutostashHeld(repoRoot)]);
	return { operation, paths, autostashHeld };
}

export async function probeGitConflictStateForCwd(cwd: string): Promise<GitConflictState & { repoRoot: string }> {
	const repoRoot = await resolveGitRepoRoot(cwd);
	return { repoRoot, ...(await probeGitConflictState(repoRoot)) };
}

export async function continueGitOperation(
	repoRoot: string,
	operation: RuntimeGitPendingOperation,
): Promise<Awaited<ReturnType<typeof runGit>>> {
	if (operation === "merge") {
		// `merge --continue` and a plain `commit --no-edit` were measured equivalent
		// here, including restoring a held `MERGE_AUTOSTASH`. The commit form is used
		// because it is also what finishes a merge git no longer considers "in
		// progress" (`merge --continue` errors with "There is no merge in progress").
		return await runGit(repoRoot, [...NO_EDITOR_CONFIG, "commit", "--no-edit"]);
	}
	if (operation === "rebase") {
		return await runGit(repoRoot, [...NO_EDITOR_CONFIG, "rebase", "--continue"]);
	}
	return await runGit(repoRoot, [...NO_EDITOR_CONFIG, "cherry-pick", "--continue"]);
}

export async function abortGitOperation(
	repoRoot: string,
	operation: RuntimeGitPendingOperation,
): Promise<Awaited<ReturnType<typeof runGit>>> {
	if (operation === "merge") {
		return await runGit(repoRoot, ["merge", "--abort"]);
	}
	if (operation === "rebase") {
		return await runGit(repoRoot, ["rebase", "--abort"]);
	}
	return await runGit(repoRoot, ["cherry-pick", "--abort"]);
}

export async function skipRebaseCommit(repoRoot: string): Promise<Awaited<ReturnType<typeof runGit>>> {
	return await runGit(repoRoot, [...NO_EDITOR_CONFIG, "rebase", "--skip"]);
}

/**
 * Whether a failed merge/rebase/cherry-pick stopped on a conflict the user can
 * resolve, as opposed to failing for a reason that leaves nothing to resolve (an
 * unknown ref, a refused fast-forward). Only the first case may be left in place;
 * the second must still be aborted, or the worktree is stranded half-way.
 */
export async function stoppedOnResolvableConflict(repoRoot: string): Promise<GitConflictState | null> {
	const state = await probeGitConflictState(repoRoot);
	if (!state.operation || state.paths.length === 0) {
		return null;
	}
	return state;
}
