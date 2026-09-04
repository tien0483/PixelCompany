const WORKTREE_TASK_ID_INVALID_MESSAGE = "Invalid task id for worktree path.";

/**
 * Runtime state lives under a vendor-neutral home directory.
 *
 * `.cline` was the original parent, and it still shows up in the places a user
 * actually reads — an agent's cwd, the worktree path on a task card. The legacy
 * constants below stay exported because state written before the rename is still
 * read from there: boards are copied forward once (`runtime-home-migration.ts`)
 * and pre-existing worktrees keep resolving in place, since git records absolute
 * paths that a plain directory move would break.
 */
export const RUNTIME_HOME_PARENT_DIR_NAME = ".agent";
export const LEGACY_RUNTIME_HOME_PARENT_DIR_NAME = ".cline";

export const KANBAN_RUNTIME_HOME_DIR_NAME = `${RUNTIME_HOME_PARENT_DIR_NAME}/kanban`;
export const KANBAN_TASK_WORKTREES_HOME_DIR_NAME = `${RUNTIME_HOME_PARENT_DIR_NAME}/worktrees`;
export const LEGACY_KANBAN_RUNTIME_HOME_DIR_NAME = `${LEGACY_RUNTIME_HOME_PARENT_DIR_NAME}/kanban`;
export const LEGACY_KANBAN_TASK_WORKTREES_HOME_DIR_NAME = `${LEGACY_RUNTIME_HOME_PARENT_DIR_NAME}/worktrees`;
export const KANBAN_TASK_WORKTREES_DIR_NAME = "worktrees";
export const KANBAN_TASK_WORKTREES_DISPLAY_ROOT = `~/${KANBAN_TASK_WORKTREES_HOME_DIR_NAME}`;

/**
 * Checkouts borrowed to merge into a base ref no existing worktree has checked out.
 * Kept apart from task worktrees because they are per-base-ref, not per-task, and
 * because a conflicted one is reused by the next attempt instead of recreated.
 */
export const KANBAN_MERGE_WORKTREES_HOME_DIR_NAME = `${RUNTIME_HOME_PARENT_DIR_NAME}/merge-worktrees`;
export const KANBAN_MERGE_WORKTREES_DISPLAY_ROOT = `~/${KANBAN_MERGE_WORKTREES_HOME_DIR_NAME}`;

export function normalizeTaskIdForWorktreePath(taskId: string): string {
	const normalized = taskId.trim();
	if (!normalized || normalized.includes("/") || normalized.includes("\\") || normalized.includes("..")) {
		throw new Error(WORKTREE_TASK_ID_INVALID_MESSAGE);
	}
	return normalized;
}

export function getWorkspaceFolderLabelForWorktreePath(repoPath: string): string {
	const trimmed = repoPath.trim().replace(/[\\/]+$/g, "");
	const folder =
		trimmed
			.split(/[\\/]/g)
			.filter((segment) => segment.length > 0)
			.at(-1) ?? "workspace";
	const cleaned = [...folder]
		.filter((char) => {
			const code = char.charCodeAt(0);
			return code >= 32 && code !== 127;
		})
		.join("")
		.trim();
	return cleaned || "workspace";
}

export function buildTaskWorktreeDisplayPath(taskId: string, repoPath: string): string {
	const normalizedTaskId = normalizeTaskIdForWorktreePath(taskId);
	const workspaceLabel = getWorkspaceFolderLabelForWorktreePath(repoPath);
	return `${KANBAN_TASK_WORKTREES_DISPLAY_ROOT}/${normalizedTaskId}/${workspaceLabel}`;
}
