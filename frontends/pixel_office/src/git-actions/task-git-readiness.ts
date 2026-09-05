import type { ReviewTaskWorkspaceSnapshot } from "@/types/board";

/**
 * What a task worktree still needs before its branch can land on the base ref.
 *
 * - `unknown`: no snapshot yet, or the git probe failed (`changedFiles === null`).
 * - `empty`: clean tree, nothing committed on top of the base ref.
 * - `dirty`: uncommitted work in the tree, so a commit is still owed. This wins over
 *   `ready` even when earlier commits exist — and note the runtime probes with
 *   `--untracked-files=all`, so agent scratch files count as dirt.
 * - `ready`: clean tree with commits the base ref does not have; only a merge is left.
 */
export type TaskGitReadiness = "unknown" | "empty" | "dirty" | "ready";

/** Commits on the task branch not reachable from its pinned base ref; 0 when unknown. */
export function getTaskCommitsAhead(snapshot: ReviewTaskWorkspaceSnapshot | null | undefined): number {
	return snapshot?.aheadOfBaseCount ?? 0;
}

export function resolveTaskGitReadiness(
	snapshot: ReviewTaskWorkspaceSnapshot | null | undefined,
): TaskGitReadiness {
	if (!snapshot || snapshot.changedFiles == null) {
		return "unknown";
	}
	if (snapshot.changedFiles > 0) {
		return "dirty";
	}
	return getTaskCommitsAhead(snapshot) > 0 ? "ready" : "empty";
}
