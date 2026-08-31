import { beforeEach, describe, expect, it, vi } from "vitest";

const branchRegistryMocks = vi.hoisted(() => ({
	listActiveBranchEntries: vi.fn(),
	reconcileBranchRegistry: vi.fn(),
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
	getWorktreesBaseRootPath: vi.fn(),
	pruneEmptyParents: vi.fn(),
}));
const workspaceStateMocks = vi.hoisted(() => ({
	listWorkspaceIndexEntries: vi.fn(),
	loadWorkspaceBoardById: vi.fn(),
}));
const diskUsageMocks = vi.hoisted(() => ({
	measureDirectorySize: vi.fn(),
}));
const fsMocks = vi.hoisted(() => ({
	stat: vi.fn(),
	readdir: vi.fn(),
	rm: vi.fn(),
}));

vi.mock("../../../src/workspace/branch-registry.js", () => ({
	listActiveBranchEntries: branchRegistryMocks.listActiveBranchEntries,
	reconcileBranchRegistry: branchRegistryMocks.reconcileBranchRegistry,
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
	getWorktreesBaseRootPath: taskWorktreeMocks.getWorktreesBaseRootPath,
	pruneEmptyParents: taskWorktreeMocks.pruneEmptyParents,
}));
vi.mock("../../../src/state/workspace-state.js", () => ({
	listWorkspaceIndexEntries: workspaceStateMocks.listWorkspaceIndexEntries,
	loadWorkspaceBoardById: workspaceStateMocks.loadWorkspaceBoardById,
}));
vi.mock("../../../src/workspace/worktree-orphan-modules.js", () => ({
	findOrphanNodeModuleDirs: vi.fn().mockResolvedValue([]),
	removeOrphanNodeModuleDirs: vi.fn().mockResolvedValue({ cleaned: [], skipped: [] }),
}));
vi.mock("../../../src/workspace/worktree-disk-usage.js", () => ({
	measureDirectorySize: diskUsageMocks.measureDirectorySize,
}));
vi.mock("node:fs/promises", () => ({
	stat: fsMocks.stat,
	readdir: fsMocks.readdir,
	rm: fsMocks.rm,
}));

import { cleanMergedWorktrees, scanReclaimableWorktrees } from "../../../src/workspace/git-worktree-cleanup";

const WORKTREES_ROOT = "/home/u/.agent/worktrees";

/** A worktree whose directory exists and is the given number of bytes. */
function entry(taskId: string, options: { repoLabel?: string; baseRef?: string } = {}) {
	const repoLabel = options.repoLabel ?? "demo-repo";
	return {
		taskId,
		branch: `kanban/${taskId}`,
		worktreePath: `${WORKTREES_ROOT}/${taskId}/${repoLabel}`,
		baseRef: options.baseRef ?? "main",
		status: "active" as const,
		lastTouchedAt: "2026-01-01T00:00:00.000Z",
	};
}

/**
 * Dispatches `runGit` by the command being run so each test states only the
 * behaviour it cares about, rather than depending on call ordering.
 */
function stubGit(handlers: {
	merged?: boolean;
	statusPorcelain?: string;
	head?: string;
	baseCommit?: string;
	aheadCount?: string;
}) {
	gitUtilsMocks.runGit.mockImplementation(async (_cwd: string, args: string[]) => {
		if (args[0] === "merge-base") {
			return { ok: handlers.merged === true };
		}
		if (args[0] === "for-each-ref") {
			return { ok: true, stdout: "" };
		}
		if (args[0] === "status") {
			return { ok: true, stdout: handlers.statusPorcelain ?? "" };
		}
		if (args[0] === "rev-parse") {
			const isBase = args[1] !== "HEAD";
			return { ok: true, stdout: isBase ? (handlers.baseCommit ?? "base") : (handlers.head ?? "base") };
		}
		if (args[0] === "rev-list") {
			return { ok: true, stdout: handlers.aheadCount ?? "0" };
		}
		return { ok: false };
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	taskBoardMutationsMocks.hasLiveChainMemberSharingWorktree.mockReturnValue(false);
	taskWorktreeMocks.getWorktreesBaseRootPath.mockReturnValue(WORKTREES_ROOT);
	taskWorktreeMocks.deleteTaskWorktree.mockResolvedValue({ ok: true });
	gitSyncMocks.runGitDeleteBranchAction.mockResolvedValue({ ok: true });
	branchRegistryMocks.reconcileBranchRegistry.mockResolvedValue({ droppedTaskIds: [] });
	diskUsageMocks.measureDirectorySize.mockResolvedValue(1024);
	// Every worktree directory exists unless a test says otherwise.
	fsMocks.stat.mockResolvedValue({ isDirectory: () => true });
	// No stray directories under the worktrees root by default.
	fsMocks.readdir.mockResolvedValue([]);
	fsMocks.rm.mockResolvedValue(undefined);
	workspaceStateMocks.listWorkspaceIndexEntries.mockResolvedValue([{ workspaceId: "ws-1", repoPath: "/repo" }]);
	workspaceStateMocks.loadWorkspaceBoardById.mockResolvedValue({ columns: [], dependencies: [] });
});

describe("cleanMergedWorktrees dryRun", () => {
	it("reports would-clean entries without deleting anything", async () => {
		branchRegistryMocks.listActiveBranchEntries.mockResolvedValue([entry("task-1")]);
		stubGit({ merged: true });
		workspaceStateMocks.loadWorkspaceBoardById.mockResolvedValue({
			columns: [{ id: "backlog", title: "Backlog", cards: [{ id: "task-1" }] }],
			dependencies: [],
		});

		const response = await cleanMergedWorktrees({
			repoPath: "/repo",
			workspaceId: "ws-1",
			board: {} as never,
			dryRun: true,
		});

		expect(response.ok).toBe(true);
		expect(response.cleanedTaskIds).toEqual(["task-1"]);
		expect(response.skipped).toEqual([]);
		expect(taskWorktreeMocks.deleteTaskWorktree).not.toHaveBeenCalled();
		expect(gitSyncMocks.runGitDeleteBranchAction).not.toHaveBeenCalled();
	});

	it("still reports skip reasons in dryRun without deleting anything", async () => {
		branchRegistryMocks.listActiveBranchEntries.mockResolvedValue([entry("task-2")]);
		// Not merged, dirty, and owned by a card: nothing qualifies.
		stubGit({ merged: false, statusPorcelain: " M src/a.ts\n" });
		workspaceStateMocks.loadWorkspaceBoardById.mockResolvedValue({
			columns: [{ id: "backlog", title: "Backlog", cards: [{ id: "task-2" }] }],
			dependencies: [],
		});

		const response = await cleanMergedWorktrees({
			repoPath: "/repo",
			workspaceId: "ws-1",
			board: {} as never,
			dryRun: true,
		});

		expect(response.cleanedTaskIds).toEqual([]);
		expect(response.skipped).toEqual([
			expect.objectContaining({ taskId: "task-2", branch: "kanban/task-2", reason: "Has uncommitted changes." }),
		]);
		expect(taskWorktreeMocks.deleteTaskWorktree).not.toHaveBeenCalled();
	});

	it("deletes for real when dryRun is not set", async () => {
		branchRegistryMocks.listActiveBranchEntries.mockResolvedValue([entry("task-3")]);
		stubGit({ merged: true });
		workspaceStateMocks.loadWorkspaceBoardById.mockResolvedValue({
			columns: [{ id: "backlog", title: "Backlog", cards: [{ id: "task-3" }] }],
			dependencies: [],
		});

		const response = await cleanMergedWorktrees({ repoPath: "/repo", workspaceId: "ws-1", board: {} as never });

		expect(response.cleanedTaskIds).toEqual(["task-3"]);
		expect(taskWorktreeMocks.deleteTaskWorktree).toHaveBeenCalledWith({ repoPath: "/repo", taskId: "task-3" });
		expect(gitSyncMocks.runGitDeleteBranchAction).toHaveBeenCalledWith({ cwd: "/repo", branch: "kanban/task-3" });
	});

	it("only acts on the merged category by default, even when other categories are reclaimable", async () => {
		branchRegistryMocks.listActiveBranchEntries.mockResolvedValue([entry("unused-1")]);
		// Clean, unmerged, sitting exactly on base: `unused`, not `merged`.
		stubGit({ merged: false, statusPorcelain: "", head: "base", baseCommit: "base", aheadCount: "0" });
		workspaceStateMocks.loadWorkspaceBoardById.mockResolvedValue({
			columns: [{ id: "backlog", title: "Backlog", cards: [{ id: "unused-1" }] }],
			dependencies: [],
		});

		const response = await cleanMergedWorktrees({ repoPath: "/repo", workspaceId: "ws-1", board: {} as never });

		expect(response.reclaimable?.map((item) => item.category)).toEqual(["unused"]);
		expect(response.cleanedTaskIds).toEqual([]);
		expect(taskWorktreeMocks.deleteTaskWorktree).not.toHaveBeenCalled();
	});
});

describe("scanReclaimableWorktrees classification", () => {
	it("classifies a clean worktree still on its base commit as unused", async () => {
		branchRegistryMocks.listActiveBranchEntries.mockResolvedValue([entry("unused-1")]);
		stubGit({ merged: false, statusPorcelain: "", head: "abc123", baseCommit: "abc123", aheadCount: "0" });
		workspaceStateMocks.loadWorkspaceBoardById.mockResolvedValue({
			columns: [{ id: "review", title: "Review", cards: [{ id: "unused-1" }] }],
			dependencies: [],
		});

		const scan = await scanReclaimableWorktrees({ repoPath: "/repo", workspaceId: "ws-1", board: {} as never });

		expect(scan.reclaimable).toHaveLength(1);
		expect(scan.reclaimable[0]).toMatchObject({ taskId: "unused-1", category: "unused", sizeBytes: 1024 });
	});

	it("does not call a worktree unused when it has commits ahead of base", async () => {
		branchRegistryMocks.listActiveBranchEntries.mockResolvedValue([entry("ahead-1")]);
		// HEAD equals the base ref's current commit, but rev-list reports commits in
		// between — the base ref moved, so this worktree did real work.
		stubGit({ merged: false, statusPorcelain: "", head: "abc123", baseCommit: "abc123", aheadCount: "2" });
		workspaceStateMocks.loadWorkspaceBoardById.mockResolvedValue({
			columns: [{ id: "review", title: "Review", cards: [{ id: "ahead-1" }] }],
			dependencies: [],
		});

		const scan = await scanReclaimableWorktrees({ repoPath: "/repo", workspaceId: "ws-1", board: {} as never });

		expect(scan.reclaimable).toEqual([]);
		expect(scan.skipped[0]?.reason).toBe("Has commits that are not merged into its base ref.");
	});

	it("classifies a worktree owned by no card on any board as orphaned", async () => {
		branchRegistryMocks.listActiveBranchEntries.mockResolvedValue([entry("orphan-1")]);
		// Clean but ahead of base, so neither merged nor unused — only ownership decides.
		stubGit({ merged: false, statusPorcelain: "", head: "aaa", baseCommit: "bbb" });
		workspaceStateMocks.loadWorkspaceBoardById.mockResolvedValue({ columns: [], dependencies: [] });

		const scan = await scanReclaimableWorktrees({ repoPath: "/repo", workspaceId: "ws-1", board: {} as never });

		expect(scan.reclaimable[0]).toMatchObject({ taskId: "orphan-1", category: "orphaned" });
	});

	it("resolves ownership across every workspace, not just the one being cleaned", async () => {
		// The regression this guards: a card on the spm-3d-bi board owned an
		// akselos-dev worktree, and a per-workspace ownership check called it an
		// orphan. Ownership must be global.
		branchRegistryMocks.listActiveBranchEntries.mockResolvedValue([entry("cross-1")]);
		stubGit({ merged: false, statusPorcelain: "", head: "aaa", baseCommit: "bbb" });
		workspaceStateMocks.listWorkspaceIndexEntries.mockResolvedValue([
			{ workspaceId: "ws-1", repoPath: "/repo" },
			{ workspaceId: "ws-other", repoPath: "/other" },
		]);
		workspaceStateMocks.loadWorkspaceBoardById.mockImplementation(async (workspaceId: string) =>
			workspaceId === "ws-other"
				? { columns: [{ id: "review", title: "Review", cards: [{ id: "cross-1" }] }], dependencies: [] }
				: { columns: [], dependencies: [] },
		);

		const scan = await scanReclaimableWorktrees({ repoPath: "/repo", workspaceId: "ws-1", board: {} as never });

		expect(scan.reclaimable).toEqual([]);
		expect(scan.skipped[0]?.taskId).toBe("cross-1");
	});

	it("never proposes an unowned worktree that still has uncommitted changes", async () => {
		branchRegistryMocks.listActiveBranchEntries.mockResolvedValue([entry("dirty-orphan")]);
		stubGit({ merged: false, statusPorcelain: " M src/a.ts\n" });
		workspaceStateMocks.loadWorkspaceBoardById.mockResolvedValue({ columns: [], dependencies: [] });

		const scan = await scanReclaimableWorktrees({ repoPath: "/repo", workspaceId: "ws-1", board: {} as never });

		expect(scan.reclaimable).toEqual([]);
		expect(scan.skipped[0]?.reason).toBe("No card owns this worktree, but it has uncommitted changes.");
	});

	it("classifies a registry entry with no directory as missing", async () => {
		branchRegistryMocks.listActiveBranchEntries.mockResolvedValue([entry("gone-1")]);
		fsMocks.stat.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

		const scan = await scanReclaimableWorktrees({ repoPath: "/repo", workspaceId: "ws-1", board: {} as never });

		expect(scan.reclaimable[0]).toMatchObject({ taskId: "gone-1", category: "missing", sizeBytes: 0 });
	});

	it("reports directories under the worktrees root that no registry claims", async () => {
		branchRegistryMocks.listActiveBranchEntries.mockResolvedValue([entry("known-1")]);
		stubGit({ merged: false, statusPorcelain: " M a.ts\n" });
		workspaceStateMocks.loadWorkspaceBoardById.mockResolvedValue({
			columns: [{ id: "backlog", title: "Backlog", cards: [{ id: "known-1" }] }],
			dependencies: [],
		});
		fsMocks.readdir.mockImplementation(async (path: string) => {
			if (path === WORKTREES_ROOT) {
				return ["known-1", "stray-1"];
			}
			return ["demo-repo"];
		});

		const scan = await scanReclaimableWorktrees({ repoPath: "/repo", workspaceId: "ws-1", board: {} as never });

		const unregistered = scan.reclaimable.filter((item) => item.category === "unregistered");
		expect(unregistered).toHaveLength(1);
		expect(unregistered[0]?.worktreePath).toBe(`${WORKTREES_ROOT}/stray-1/demo-repo`);
	});

	it("skips a worktree shared with a live chain member before any other check", async () => {
		branchRegistryMocks.listActiveBranchEntries.mockResolvedValue([entry("chained-1")]);
		taskBoardMutationsMocks.hasLiveChainMemberSharingWorktree.mockReturnValue(true);
		stubGit({ merged: true });

		const scan = await scanReclaimableWorktrees({ repoPath: "/repo", workspaceId: "ws-1", board: {} as never });

		expect(scan.reclaimable).toEqual([]);
		expect(scan.skipped[0]?.reason).toBe("Shared with a live chain member.");
	});
});

describe("cleanMergedWorktrees category selection", () => {
	it("removes an unused worktree but leaves its branch alone", async () => {
		branchRegistryMocks.listActiveBranchEntries.mockResolvedValue([entry("unused-2")]);
		stubGit({ merged: false, statusPorcelain: "", head: "abc", baseCommit: "abc", aheadCount: "0" });
		workspaceStateMocks.loadWorkspaceBoardById.mockResolvedValue({
			columns: [{ id: "review", title: "Review", cards: [{ id: "unused-2" }] }],
			dependencies: [],
		});

		const response = await cleanMergedWorktrees({
			repoPath: "/repo",
			workspaceId: "ws-1",
			board: {} as never,
			categories: ["unused"],
		});

		expect(response.cleanedTaskIds).toEqual(["unused-2"]);
		expect(taskWorktreeMocks.deleteTaskWorktree).toHaveBeenCalledWith({ repoPath: "/repo", taskId: "unused-2" });
		// The branch may hold the only reference to work, so only `merged` deletes it.
		expect(gitSyncMocks.runGitDeleteBranchAction).not.toHaveBeenCalled();
	});

	it("honours a taskIds filter so a single worktree can be deselected", async () => {
		branchRegistryMocks.listActiveBranchEntries.mockResolvedValue([entry("keep-1"), entry("drop-1")]);
		stubGit({ merged: true });
		workspaceStateMocks.loadWorkspaceBoardById.mockResolvedValue({
			columns: [{ id: "backlog", title: "Backlog", cards: [{ id: "keep-1" }, { id: "drop-1" }] }],
			dependencies: [],
		});

		const response = await cleanMergedWorktrees({
			repoPath: "/repo",
			workspaceId: "ws-1",
			board: {} as never,
			categories: ["merged"],
			taskIds: ["drop-1"],
		});

		expect(response.cleanedTaskIds).toEqual(["drop-1"]);
		expect(taskWorktreeMocks.deleteTaskWorktree).toHaveBeenCalledTimes(1);
	});

	it("removes an unregistered directory instead of asking for manual cleanup", async () => {
		branchRegistryMocks.listActiveBranchEntries.mockResolvedValue([]);
		fsMocks.readdir.mockImplementation(async (path: string) =>
			path === WORKTREES_ROOT ? ["stray-1"] : ["demo-repo"],
		);

		const response = await cleanMergedWorktrees({
			repoPath: "/repo",
			workspaceId: "ws-1",
			board: {} as never,
			categories: ["unregistered"],
		});

		expect(response.cleanedTaskIds).toEqual(["stray-1"]);
		expect(fsMocks.rm).toHaveBeenCalled();
		expect(taskWorktreeMocks.deleteTaskWorktree).not.toHaveBeenCalled();
	});

	it("deletes a merged local branch when the worktree is removed", async () => {
		branchRegistryMocks.listActiveBranchEntries.mockResolvedValue([entry("merged-1")]);
		stubGit({ merged: true });
		workspaceStateMocks.loadWorkspaceBoardById.mockResolvedValue({
			columns: [{ id: "backlog", title: "Backlog", cards: [{ id: "merged-1" }] }],
			dependencies: [],
		});

		await cleanMergedWorktrees({ repoPath: "/repo", workspaceId: "ws-1", board: {} as never });

		expect(gitSyncMocks.runGitDeleteBranchAction).toHaveBeenCalledWith({
			cwd: "/repo",
			branch: "kanban/merged-1",
		});
	});

	it("reconciles the registry after a real delete so the next scan is accurate", async () => {
		branchRegistryMocks.listActiveBranchEntries.mockResolvedValue([entry("merged-1")]);
		stubGit({ merged: true });
		workspaceStateMocks.loadWorkspaceBoardById.mockResolvedValue({
			columns: [{ id: "backlog", title: "Backlog", cards: [{ id: "merged-1" }] }],
			dependencies: [],
		});

		await cleanMergedWorktrees({ repoPath: "/repo", workspaceId: "ws-1", board: {} as never });

		expect(branchRegistryMocks.reconcileBranchRegistry).toHaveBeenCalledWith("ws-1");
	});
});
