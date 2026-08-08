import { describe, expect, it, vi } from "vitest";

const branchRegistryMocks = vi.hoisted(() => ({
	listActiveBranchEntries: vi.fn(),
}));
const taskBoardMutationsMocks = vi.hoisted(() => ({
	hasLiveChainMemberSharingWorktree: vi.fn(),
}));
const gitSyncMocks = vi.hoisted(() => ({
	runGitDeleteBranchAction: vi.fn(),
}));
const gitUtilsMocks = vi.hoisted(() => ({
	runGit: vi.fn(),
}));
const taskWorktreeMocks = vi.hoisted(() => ({
	deleteTaskWorktree: vi.fn(),
}));

vi.mock("../../../src/workspace/branch-registry.js", () => ({
	listActiveBranchEntries: branchRegistryMocks.listActiveBranchEntries,
}));
vi.mock("../../../src/core/task-board-mutations.js", () => ({
	hasLiveChainMemberSharingWorktree: taskBoardMutationsMocks.hasLiveChainMemberSharingWorktree,
}));
vi.mock("../../../src/workspace/git-sync.js", () => ({
	runGitDeleteBranchAction: gitSyncMocks.runGitDeleteBranchAction,
}));
vi.mock("../../../src/workspace/git-utils.js", () => ({
	runGit: gitUtilsMocks.runGit,
}));
vi.mock("../../../src/workspace/task-worktree.js", () => ({
	deleteTaskWorktree: taskWorktreeMocks.deleteTaskWorktree,
}));

import { cleanMergedWorktrees } from "../../../src/workspace/git-worktree-cleanup";

function resetMocks() {
	branchRegistryMocks.listActiveBranchEntries.mockReset();
	taskBoardMutationsMocks.hasLiveChainMemberSharingWorktree.mockReset();
	gitSyncMocks.runGitDeleteBranchAction.mockReset();
	gitUtilsMocks.runGit.mockReset();
	taskWorktreeMocks.deleteTaskWorktree.mockReset();
}

describe("cleanMergedWorktrees dryRun", () => {
	it("reports would-clean entries without deleting or deleting branches", async () => {
		resetMocks();
		branchRegistryMocks.listActiveBranchEntries.mockResolvedValue([
			{ taskId: "task-1", branch: "kanban/task-1", baseRef: "main" },
		]);
		taskBoardMutationsMocks.hasLiveChainMemberSharingWorktree.mockReturnValue(false);
		gitUtilsMocks.runGit.mockResolvedValue({ ok: true });

		const response = await cleanMergedWorktrees({
			repoPath: "/repo",
			workspaceId: "ws-1",
			board: {} as never,
			dryRun: true,
		});

		expect(response).toEqual({ ok: true, cleanedTaskIds: ["task-1"], skipped: [] });
		expect(taskWorktreeMocks.deleteTaskWorktree).not.toHaveBeenCalled();
		expect(gitSyncMocks.runGitDeleteBranchAction).not.toHaveBeenCalled();
	});

	it("still reports skip reasons in dryRun without deleting anything", async () => {
		resetMocks();
		branchRegistryMocks.listActiveBranchEntries.mockResolvedValue([
			{ taskId: "task-2", branch: "kanban/task-2", baseRef: "main" },
		]);
		taskBoardMutationsMocks.hasLiveChainMemberSharingWorktree.mockReturnValue(false);
		gitUtilsMocks.runGit.mockResolvedValue({ ok: false });

		const response = await cleanMergedWorktrees({
			repoPath: "/repo",
			workspaceId: "ws-1",
			board: {} as never,
			dryRun: true,
		});

		expect(response.ok).toBe(true);
		expect(response.cleanedTaskIds).toEqual([]);
		expect(response.skipped).toEqual([
			{ taskId: "task-2", branch: "kanban/task-2", reason: "Not merged into its base ref." },
		]);
		expect(taskWorktreeMocks.deleteTaskWorktree).not.toHaveBeenCalled();
	});

	it("deletes for real when dryRun is not set", async () => {
		resetMocks();
		branchRegistryMocks.listActiveBranchEntries.mockResolvedValue([
			{ taskId: "task-3", branch: "kanban/task-3", baseRef: "main" },
		]);
		taskBoardMutationsMocks.hasLiveChainMemberSharingWorktree.mockReturnValue(false);
		gitUtilsMocks.runGit.mockResolvedValue({ ok: true });
		taskWorktreeMocks.deleteTaskWorktree.mockResolvedValue({ ok: true });
		gitSyncMocks.runGitDeleteBranchAction.mockResolvedValue({ ok: true });

		const response = await cleanMergedWorktrees({
			repoPath: "/repo",
			workspaceId: "ws-1",
			board: {} as never,
		});

		expect(response).toEqual({ ok: true, cleanedTaskIds: ["task-3"], skipped: [] });
		expect(taskWorktreeMocks.deleteTaskWorktree).toHaveBeenCalledWith({ repoPath: "/repo", taskId: "task-3" });
		expect(gitSyncMocks.runGitDeleteBranchAction).toHaveBeenCalledWith({ cwd: "/repo", branch: "kanban/task-3" });
	});
});
