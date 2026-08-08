import type { RuntimeBoardData, RuntimeCleanMergedWorktreesResponse } from "../core/api-contract";
import { hasLiveChainMemberSharingWorktree } from "../core/task-board-mutations";
import { listActiveBranchEntries } from "./branch-registry";
import { runGitDeleteBranchAction } from "./git-sync";
import { runGit } from "./git-utils";
import { deleteTaskWorktree } from "./task-worktree";

/**
 * Removes task worktrees whose branch is fully merged into its recorded base
 * ref. Safety mirrors `git branch -d`: a branch only qualifies once every one
 * of its commits is an ancestor of the base ref, so nothing in-flight is lost.
 * With `dryRun: true`, every eligibility check still runs but no worktree or
 * branch is actually deleted — the same response shape doubles as a preview.
 */
export async function cleanMergedWorktrees(options: {
	repoPath: string;
	workspaceId: string;
	board: RuntimeBoardData;
	dryRun?: boolean;
}): Promise<RuntimeCleanMergedWorktreesResponse> {
	const entries = await listActiveBranchEntries(options.workspaceId);
	const cleanedTaskIds: string[] = [];
	const skipped: { taskId: string; branch: string; reason: string }[] = [];

	for (const entry of entries) {
		if (hasLiveChainMemberSharingWorktree(options.board, entry.taskId, entry.taskId)) {
			skipped.push({ taskId: entry.taskId, branch: entry.branch, reason: "Shared with a live chain member." });
			continue;
		}
		if (!entry.baseRef) {
			skipped.push({ taskId: entry.taskId, branch: entry.branch, reason: "No base ref recorded." });
			continue;
		}

		const ancestorCheck = await runGit(options.repoPath, [
			"merge-base",
			"--is-ancestor",
			entry.branch,
			entry.baseRef,
		]);
		if (!ancestorCheck.ok) {
			skipped.push({ taskId: entry.taskId, branch: entry.branch, reason: "Not merged into its base ref." });
			continue;
		}

		if (options.dryRun) {
			cleanedTaskIds.push(entry.taskId);
			continue;
		}

		const deleteResult = await deleteTaskWorktree({ repoPath: options.repoPath, taskId: entry.taskId });
		if (!deleteResult.ok) {
			skipped.push({
				taskId: entry.taskId,
				branch: entry.branch,
				reason: deleteResult.error ?? "Failed to remove worktree.",
			});
			continue;
		}

		// Best-effort: the worktree is gone either way, so a branch-delete failure
		// (e.g. already removed) shouldn't be reported as a skip.
		await runGitDeleteBranchAction({ cwd: options.repoPath, branch: entry.branch });
		cleanedTaskIds.push(entry.taskId);
	}

	return { ok: true, cleanedTaskIds, skipped };
}
