import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeGitSyncSummary } from "../../../src/core/api-contract";

const gitSyncMocks = vi.hoisted(() => ({
	commitWorkspaceChanges: vi.fn(),
	discardGitChanges: vi.fn(),
	getGitSyncSummary: vi.fn(),
	getMergeConflicts: vi.fn(),
	resolveMergeConflict: vi.fn(),
	revertGitFile: vi.fn(),
	revertGitHunk: vi.fn(),
	runGitCheckoutAction: vi.fn(),
	runGitCherryPickAction: vi.fn(),
	runGitMergeIntoCurrentAction: vi.fn(),
	runGitPushBranchAction: vi.fn(),
	runGitRebaseCurrentOntoAction: vi.fn(),
	runGitSyncAction: vi.fn(),
}));

const ghMocks = vi.hoisted(() => ({ createPullRequest: vi.fn() }));
const historyMocks = vi.hoisted(() => ({
	getBlame: vi.fn(),
	getCommitDiff: vi.fn(),
	getGitLog: vi.fn(),
	getGitRefs: vi.fn(),
}));
const worktreeInventoryMocks = vi.hoisted(() => ({ listGitWorktrees: vi.fn() }));
const taskWorktreeMocks = vi.hoisted(() => ({
	deleteTaskWorktree: vi.fn(),
	ensureTaskWorktreeIfDoesntExist: vi.fn(),
	getTaskWorkspaceInfo: vi.fn(),
	resolveTaskCwd: vi.fn(),
}));

vi.mock("../../../src/workspace/git-sync.js", () => gitSyncMocks);
vi.mock("../../../src/workspace/git-gh.js", () => ghMocks);
vi.mock("../../../src/workspace/git-history.js", () => historyMocks);
vi.mock("../../../src/workspace/git-worktree-inventory.js", () => worktreeInventoryMocks);
vi.mock("../../../src/workspace/task-worktree.js", () => taskWorktreeMocks);

import { createWorkspaceApi } from "../../../src/trpc/workspace-api";

const SUMMARY: RuntimeGitSyncSummary = {
	currentBranch: "main",
	upstreamBranch: null,
	changedFiles: 0,
	additions: 0,
	deletions: 0,
	aheadCount: 0,
	behindCount: 0,
};

const SCOPE = { workspaceId: "ws-1", workspacePath: "/repo" };
const TASK_INFO = { taskId: "task-1", baseRef: "main" };

function makeApi() {
	const broadcast = vi.fn();
	const api = createWorkspaceApi({
		ensureTerminalManagerForWorkspace: vi.fn(),
		getScopedClineTaskSessionService: vi.fn(),
		broadcastRuntimeWorkspaceStateUpdated: broadcast,
		broadcastRuntimeProjectsUpdated: vi.fn(),
		buildWorkspaceStateSnapshot: vi.fn(),
	});
	return { api, broadcast };
}

beforeEach(() => {
	for (const fn of Object.values(gitSyncMocks)) fn.mockReset();
	ghMocks.createPullRequest.mockReset();
	historyMocks.getBlame.mockReset();
	worktreeInventoryMocks.listGitWorktrees.mockReset();
	taskWorktreeMocks.resolveTaskCwd.mockReset();
	taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/repo/.worktrees/task-1");
});

describe("workspaceApi.revertGitFile", () => {
	it("reverts against the workspace path (no taskInfo) and broadcasts on success", async () => {
		gitSyncMocks.revertGitFile.mockResolvedValue({ ok: true, summary: SUMMARY, output: "reverted" });
		const { api, broadcast } = makeApi();

		const res = await api.revertGitFile(SCOPE, { path: "a.ts" });

		expect(gitSyncMocks.revertGitFile).toHaveBeenCalledWith({ cwd: "/repo", path: "a.ts" });
		expect(taskWorktreeMocks.resolveTaskCwd).not.toHaveBeenCalled();
		expect(broadcast).toHaveBeenCalledWith("ws-1", "/repo");
		expect(res.ok).toBe(true);
	});

	it("resolves the task worktree cwd when taskInfo is provided", async () => {
		gitSyncMocks.revertGitFile.mockResolvedValue({ ok: true, summary: SUMMARY, output: "" });
		const { api } = makeApi();

		await api.revertGitFile(SCOPE, { path: "a.ts", taskInfo: TASK_INFO });

		expect(taskWorktreeMocks.resolveTaskCwd).toHaveBeenCalledWith({
			cwd: "/repo",
			taskId: "task-1",
			baseRef: "main",
			ensure: false,
		});
		expect(gitSyncMocks.revertGitFile).toHaveBeenCalledWith({
			cwd: "/repo/.worktrees/task-1",
			path: "a.ts",
		});
	});

	it("does not broadcast when the revert fails", async () => {
		gitSyncMocks.revertGitFile.mockResolvedValue({ ok: false, summary: SUMMARY, output: "", error: "nope" });
		const { api, broadcast } = makeApi();

		const res = await api.revertGitFile(SCOPE, { path: "a.ts" });

		expect(broadcast).not.toHaveBeenCalled();
		expect(res.ok).toBe(false);
	});

	it("returns an error envelope when the git function throws", async () => {
		gitSyncMocks.revertGitFile.mockRejectedValue(new Error("boom"));
		const { api, broadcast } = makeApi();

		const res = await api.revertGitFile(SCOPE, { path: "a.ts" });

		expect(res.ok).toBe(false);
		expect(res.error).toBe("boom");
		expect(broadcast).not.toHaveBeenCalled();
	});
});

describe("workspaceApi.revertGitHunk", () => {
	it("forwards the hunk index and broadcasts on success", async () => {
		gitSyncMocks.revertGitHunk.mockResolvedValue({ ok: true, summary: SUMMARY, output: "" });
		const { api, broadcast } = makeApi();

		await api.revertGitHunk(SCOPE, { path: "a.ts", hunkIndex: 2 });

		expect(gitSyncMocks.revertGitHunk).toHaveBeenCalledWith({ cwd: "/repo", path: "a.ts", hunkIndex: 2 });
		expect(broadcast).toHaveBeenCalled();
	});
});

describe("workspaceApi.commitWorkspaceChanges", () => {
	it("forwards message + paths and broadcasts on success", async () => {
		gitSyncMocks.commitWorkspaceChanges.mockResolvedValue({ ok: true, summary: SUMMARY, output: "" });
		const { api, broadcast } = makeApi();

		await api.commitWorkspaceChanges(SCOPE, { message: "msg", paths: ["a.ts"] });

		expect(gitSyncMocks.commitWorkspaceChanges).toHaveBeenCalledWith({
			cwd: "/repo",
			message: "msg",
			paths: ["a.ts"],
		});
		expect(broadcast).toHaveBeenCalled();
	});

	it("wraps a thrown error in an envelope", async () => {
		gitSyncMocks.commitWorkspaceChanges.mockRejectedValue(new Error("commit failed"));
		const { api } = makeApi();

		const res = await api.commitWorkspaceChanges(SCOPE, { message: "msg" });

		expect(res.ok).toBe(false);
		expect(res.error).toBe("commit failed");
	});
});

describe("workspaceApi.getBlame", () => {
	it("resolves task cwd and forwards the path", async () => {
		historyMocks.getBlame.mockResolvedValue({ ok: true, path: "a.ts", lines: [] });
		const { api } = makeApi();

		const res = await api.getBlame(SCOPE, { path: "a.ts", taskInfo: TASK_INFO });

		expect(historyMocks.getBlame).toHaveBeenCalledWith({ cwd: "/repo/.worktrees/task-1", path: "a.ts" });
		expect(res.ok).toBe(true);
	});

	it("returns an error envelope with the path on failure", async () => {
		historyMocks.getBlame.mockRejectedValue(new Error("blame failed"));
		const { api } = makeApi();

		const res = await api.getBlame(SCOPE, { path: "a.ts" });

		expect(res).toEqual({ ok: false, path: "a.ts", lines: [], error: "blame failed" });
	});
});

describe("workspaceApi.getMergeConflicts", () => {
	it("passes the resolved cwd and never broadcasts (read-only)", async () => {
		gitSyncMocks.getMergeConflicts.mockResolvedValue({ ok: true, conflicts: [] });
		const { api, broadcast } = makeApi();

		await api.getMergeConflicts(SCOPE, TASK_INFO);

		expect(gitSyncMocks.getMergeConflicts).toHaveBeenCalledWith({ cwd: "/repo/.worktrees/task-1" });
		expect(broadcast).not.toHaveBeenCalled();
	});

	it("returns an error envelope on failure", async () => {
		gitSyncMocks.getMergeConflicts.mockRejectedValue(new Error("bad"));
		const { api } = makeApi();

		const res = await api.getMergeConflicts(SCOPE, null);

		expect(res).toEqual({ ok: false, conflicts: [], error: "bad" });
	});
});

describe("workspaceApi.resolveMergeConflict", () => {
	it("forwards side + content and broadcasts on success", async () => {
		gitSyncMocks.resolveMergeConflict.mockResolvedValue({ ok: true, summary: SUMMARY, output: "" });
		const { api, broadcast } = makeApi();

		await api.resolveMergeConflict(SCOPE, { path: "a.ts", side: "ours" });

		expect(gitSyncMocks.resolveMergeConflict).toHaveBeenCalledWith({
			cwd: "/repo",
			path: "a.ts",
			side: "ours",
			content: undefined,
		});
		expect(broadcast).toHaveBeenCalled();
	});
});

describe("workspaceApi.listWorktrees", () => {
	it("delegates to listGitWorktrees against the workspace path", async () => {
		worktreeInventoryMocks.listGitWorktrees.mockResolvedValue({ ok: true, worktrees: [] });
		const { api } = makeApi();

		const res = await api.listWorktrees(SCOPE);

		expect(worktreeInventoryMocks.listGitWorktrees).toHaveBeenCalledWith("/repo");
		expect(res.ok).toBe(true);
	});

	it("returns an error envelope on failure", async () => {
		worktreeInventoryMocks.listGitWorktrees.mockRejectedValue(new Error("no repo"));
		const { api } = makeApi();

		const res = await api.listWorktrees(SCOPE);

		expect(res).toEqual({ ok: false, worktrees: [], error: "no repo" });
	});
});

describe("workspaceApi.createPullRequest", () => {
	it("forwards title/body/base and does not broadcast (no local state change)", async () => {
		ghMocks.createPullRequest.mockResolvedValue({ ok: true, url: "https://pr", output: "" });
		const { api, broadcast } = makeApi();

		const res = await api.createPullRequest(SCOPE, { title: "T", body: "B", base: "main" });

		expect(ghMocks.createPullRequest).toHaveBeenCalledWith({ cwd: "/repo", title: "T", body: "B", base: "main" });
		expect(broadcast).not.toHaveBeenCalled();
		expect(res.url).toBe("https://pr");
	});

	it("returns an error envelope on failure", async () => {
		ghMocks.createPullRequest.mockRejectedValue(new Error("gh boom"));
		const { api } = makeApi();

		const res = await api.createPullRequest(SCOPE, { title: "T", body: "B" });

		expect(res).toEqual({ ok: false, url: null, output: "", error: "gh boom" });
	});
});

describe("workspaceApi.cherryPickCommit", () => {
	it("cherry-picks into the worktree that has the target branch checked out", async () => {
		worktreeInventoryMocks.listGitWorktrees.mockResolvedValue({
			ok: true,
			worktrees: [{ path: "/repo", branch: "main" }],
		});
		gitSyncMocks.runGitCherryPickAction.mockResolvedValue({
			ok: true,
			commitHash: "abcdef1234567",
			targetBranch: "main",
			summary: SUMMARY,
			output: "",
		});
		const { api, broadcast } = makeApi();

		const res = await api.cherryPickCommit(SCOPE, {
			taskId: "task-1",
			baseRef: "main",
			commitHash: "abcdef1234567",
			targetBranch: "main",
		});

		expect(gitSyncMocks.runGitCherryPickAction).toHaveBeenCalledWith({
			cwd: "/repo",
			commitHash: "abcdef1234567",
			targetBranch: "main",
		});
		expect(broadcast).toHaveBeenCalledWith("ws-1", "/repo");
		expect(res.ok).toBe(true);
	});
});

describe("workspaceApi.pushGitBranch", () => {
	it("pushes from the task worktree when it is on the branch", async () => {
		gitSyncMocks.getGitSyncSummary.mockResolvedValue({
			...SUMMARY,
			currentBranch: "kanban/task-1",
		});
		gitSyncMocks.runGitPushBranchAction.mockResolvedValue({
			ok: true,
			branch: "kanban/task-1",
			summary: SUMMARY,
			output: "",
		});
		const { api, broadcast } = makeApi();

		const res = await api.pushGitBranch(SCOPE, {
			taskId: "task-1",
			baseRef: "main",
			branch: "kanban/task-1",
		});

		expect(taskWorktreeMocks.resolveTaskCwd).toHaveBeenCalled();
		expect(gitSyncMocks.runGitPushBranchAction).toHaveBeenCalledWith({
			cwd: "/repo/.worktrees/task-1",
			branch: "kanban/task-1",
		});
		expect(broadcast).toHaveBeenCalled();
		expect(res.ok).toBe(true);
	});
});

describe("workspaceApi.mergeBranchIntoCurrent", () => {
	it("merges into the workspace cwd and broadcasts on success", async () => {
		gitSyncMocks.runGitMergeIntoCurrentAction.mockResolvedValue({
			ok: true,
			branch: "feature",
			summary: SUMMARY,
			output: "",
		});
		const { api, broadcast } = makeApi();

		const res = await api.mergeBranchIntoCurrent(SCOPE, { branch: "feature" });

		expect(gitSyncMocks.runGitMergeIntoCurrentAction).toHaveBeenCalledWith({
			cwd: "/repo",
			branch: "feature",
		});
		expect(broadcast).toHaveBeenCalledWith("ws-1", "/repo");
		expect(res.ok).toBe(true);
	});

	it("does not broadcast when the merge fails", async () => {
		gitSyncMocks.runGitMergeIntoCurrentAction.mockResolvedValue({
			ok: false,
			branch: "feature",
			summary: SUMMARY,
			output: "",
			error: "conflicts",
		});
		const { api, broadcast } = makeApi();

		const res = await api.mergeBranchIntoCurrent(SCOPE, { branch: "feature" });

		expect(broadcast).not.toHaveBeenCalled();
		expect(res.ok).toBe(false);
	});
});

describe("workspaceApi.rebaseCurrentOnto", () => {
	it("rebases onto the selected branch and broadcasts on success", async () => {
		gitSyncMocks.runGitRebaseCurrentOntoAction.mockResolvedValue({
			ok: true,
			branch: "main",
			summary: SUMMARY,
			output: "",
		});
		const { api, broadcast } = makeApi();

		const res = await api.rebaseCurrentOnto(SCOPE, { branch: "main" });

		expect(gitSyncMocks.runGitRebaseCurrentOntoAction).toHaveBeenCalledWith({
			cwd: "/repo",
			branch: "main",
		});
		expect(broadcast).toHaveBeenCalledWith("ws-1", "/repo");
		expect(res.ok).toBe(true);
	});
});
