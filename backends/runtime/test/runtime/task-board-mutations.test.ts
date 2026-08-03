import { describe, expect, it } from "vitest";

import type { RuntimeBoardData } from "../../src/core/api-contract";
import {
	addTaskDependency,
	addTaskToColumn,
	breakChain,
	deleteTasksFromBoard,
	getReadyLinkedTaskIdsAfterLeavingReview,
	getReadyLinkedTaskIdsForTaskInTrash,
	getTaskColumnId,
	hasLiveChainMemberSharingWorktree,
	moveTaskToColumn,
	reorderChainMembers,
	resolveChainWorktreeOwnerTaskId,
	trashTaskAndGetReadyLinkedTaskIds,
	updateTask,
	updateTaskDependencies,
} from "../../src/core/task-board-mutations";

function createBoard(): RuntimeBoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Done", cards: [] },
		],
		dependencies: [],
	};
}

describe("deleteTasksFromBoard", () => {
	it("removes a trashed task and any dependencies that reference it", () => {
		const createA = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Task A", baseRef: "main" },
			() => "aaaaa111",
		);
		const createB = addTaskToColumn(createA.board, "review", { prompt: "Task B", baseRef: "main" }, () => "bbbbb111");
		const linked = addTaskDependency(createB.board, "aaaaa", "bbbbb");
		if (!linked.added) {
			throw new Error("Expected dependency to be created.");
		}
		const trashed = trashTaskAndGetReadyLinkedTaskIds(linked.board, "bbbbb");
		const deleted = deleteTasksFromBoard(trashed.board, ["bbbbb"]);

		expect(deleted.deleted).toBe(true);
		expect(deleted.deletedTaskIds).toEqual(["bbbbb"]);
		expect(deleted.board.columns.find((column) => column.id === "trash")?.cards).toEqual([]);
		expect(deleted.board.dependencies).toEqual([]);
	});

	it("removes multiple trashed tasks at once", () => {
		const createA = addTaskToColumn(createBoard(), "trash", { prompt: "Task A", baseRef: "main" }, () => "aaaaa111");
		const createB = addTaskToColumn(createA.board, "trash", { prompt: "Task B", baseRef: "main" }, () => "bbbbb111");

		const deleted = deleteTasksFromBoard(createB.board, ["aaaaa", "bbbbb"]);

		expect(deleted.deleted).toBe(true);
		expect(deleted.deletedTaskIds.sort()).toEqual(["aaaaa", "bbbbb"]);
		expect(deleted.board.columns.find((column) => column.id === "trash")?.cards).toEqual([]);
	});
});

describe("taskLaunchSettings", () => {
	it("persists tags on create and update, and clears with null", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Tagged task",
				baseRef: "main",
				agentId: "claude",
				taskLaunchSettings: {
					modelId: "sonnet",
					effort: "high",
					skillIds: ["review", "review", ""],
					mcpServerIds: ["filesystem"],
				},
			},
			() => "aaaaa111",
		);

		expect(created.task.taskLaunchSettings).toEqual({
			modelId: "sonnet",
			effort: "high",
			skillIds: ["review"],
			mcpServerIds: ["filesystem"],
		});

		const updated = updateTask(created.board, "aaaaa", {
			prompt: "Tagged task",
			baseRef: "main",
			taskLaunchSettings: {
				modelId: "opus",
				skillIds: ["plan"],
			},
		});
		expect(updated.task?.taskLaunchSettings).toEqual({
			modelId: "opus",
			skillIds: ["plan"],
		});

		const cleared = updateTask(updated.board, "aaaaa", {
			prompt: "Tagged task",
			baseRef: "main",
			taskLaunchSettings: null,
		});
		expect(cleared.task?.taskLaunchSettings).toBeUndefined();
	});

	it("preserves existing tags when update omits taskLaunchSettings", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Tagged task",
				baseRef: "main",
				taskLaunchSettings: { modelId: "sonnet", skillIds: ["review"] },
			},
			() => "bbbbb111",
		);

		const updated = updateTask(created.board, "bbbbb", {
			prompt: "Tagged task edited",
			baseRef: "main",
		});

		expect(updated.task?.taskLaunchSettings).toEqual({
			modelId: "sonnet",
			skillIds: ["review"],
		});
	});
});

describe("task images", () => {
	it("preserves images when creating and updating tasks", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Task with image",
				baseRef: "main",
				images: [
					{
						id: "img-1",
						data: "abc123",
						mimeType: "image/png",
					},
				],
			},
			() => "aaaaa111",
		);

		expect(created.task.images).toEqual([
			{
				id: "img-1",
				data: "abc123",
				mimeType: "image/png",
			},
		]);

		const updated = updateTask(created.board, created.task.id, {
			prompt: "Task with updated image",
			baseRef: "main",
			images: [
				{
					id: "img-2",
					data: "def456",
					mimeType: "image/jpeg",
				},
			],
		});

		expect(updated.task?.images).toEqual([
			{
				id: "img-2",
				data: "def456",
				mimeType: "image/jpeg",
			},
		]);
	});
});

describe("per-task agent/model/provider overrides", () => {
	it("persists agentId on the card when creating a task", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Smart task", baseRef: "main", agentId: "claude" },
			() => "aaaaa111",
		);

		expect(created.task.agentId).toBe("claude");
	});

	it("persists task-level Cline settings on the card when creating a task", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Dumb task",
				baseRef: "main",
				agentId: "cline",
				clineSettings: {
					providerId: "anthropic",
					modelId: "claude-sonnet-4-20250514",
					reasoningEffort: "high",
				},
			},
			() => "aaaaa111",
		);

		expect(created.task.agentId).toBe("cline");
		expect(created.task.clineSettings).toEqual({
			providerId: "anthropic",
			modelId: "claude-sonnet-4-20250514",
			reasoningEffort: "high",
		});
	});

	it("leaves override fields undefined when not provided", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Default task", baseRef: "main" },
			() => "aaaaa111",
		);

		expect(created.task.agentId).toBeUndefined();
		expect(created.task.clineSettings).toBeUndefined();
	});

	it("updates agentId from undefined to a value", () => {
		const created = addTaskToColumn(createBoard(), "backlog", { prompt: "Task", baseRef: "main" }, () => "aaaaa111");
		expect(created.task.agentId).toBeUndefined();

		const updated = updateTask(created.board, created.task.id, {
			prompt: "Task",
			baseRef: "main",
			agentId: "codex",
		});

		expect(updated.updated).toBe(true);
		expect(updated.task?.agentId).toBe("codex");
	});

	it("updates clineModelId", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Task", baseRef: "main", clineSettings: { modelId: "old-model" } },
			() => "aaaaa111",
		);

		const updated = updateTask(created.board, created.task.id, {
			prompt: "Task",
			baseRef: "main",
			clineSettings: { modelId: "new-model" },
		});

		expect(updated.task?.clineSettings?.modelId).toBe("new-model");
	});

	it("preserves existing overrides when update input omits them (undefined)", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Task",
				baseRef: "main",
				agentId: "claude",
				clineSettings: {
					providerId: "anthropic",
					modelId: "claude-sonnet-4-20250514",
					reasoningEffort: "low",
				},
			},
			() => "aaaaa111",
		);

		const updated = updateTask(created.board, created.task.id, {
			prompt: "Updated prompt",
			baseRef: "main",
			// agentId and clineSettings are undefined, so existing overrides should persist
		});

		expect(updated.task?.agentId).toBe("claude");
		expect(updated.task?.clineSettings).toEqual({
			providerId: "anthropic",
			modelId: "claude-sonnet-4-20250514",
			reasoningEffort: "low",
		});
	});

	it("clears overrides when update input provides null", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Task",
				baseRef: "main",
				agentId: "codex",
				clineSettings: {
					providerId: "openai",
					modelId: "gpt-4",
					reasoningEffort: "medium",
				},
			},
			() => "aaaaa111",
		);

		const updated = updateTask(created.board, created.task.id, {
			prompt: "Task",
			baseRef: "main",
			agentId: null,
			clineSettings: null,
		});

		expect(updated.task?.agentId).toBeUndefined();
		expect(updated.task?.clineSettings).toBeUndefined();
	});

	it("preserves overrides across move operations", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Movable task",
				baseRef: "main",
				agentId: "claude",
				clineSettings: {
					providerId: "anthropic",
					modelId: "claude-sonnet-4-20250514",
					reasoningEffort: "high",
				},
			},
			() => "aaaaa111",
		);

		const moved = moveTaskToColumn(created.board, created.task.id, "in_progress");

		expect(moved.moved).toBe(true);
		expect(moved.task?.agentId).toBe("claude");
		expect(moved.task?.clineSettings).toEqual({
			providerId: "anthropic",
			modelId: "claude-sonnet-4-20250514",
			reasoningEffort: "high",
		});
	});
});

describe("task chains", () => {
	// Builds A, B, C all in Backlog. Returns the board.
	function boardWithThreeBacklogTasks(): RuntimeBoardData {
		const a = addTaskToColumn(createBoard(), "backlog", { prompt: "Task A", baseRef: "main" }, () => "aaaaa111");
		const b = addTaskToColumn(a.board, "backlog", { prompt: "Task B", baseRef: "main" }, () => "bbbbb111");
		const c = addTaskToColumn(b.board, "backlog", { prompt: "Task C", baseRef: "main" }, () => "ccccc111");
		return c.board;
	}

	it("marks a link between two Backlog tasks as a chain (first arg runs first / is root)", () => {
		const linked = addTaskDependency(boardWithThreeBacklogTasks(), "aaaaa", "bbbbb");
		expect(linked.added).toBe(true);
		expect(linked.dependency?.chain).toBe(true);
		// first arg (drag source / `link A B`'s A) = root/prerequisite (toTaskId), runs first;
		// second arg = follower (fromTaskId), runs after.
		expect(linked.dependency?.toTaskId).toBe("aaaaa");
		expect(linked.dependency?.fromTaskId).toBe("bbbbb");
		// The root owns the shared worktree; the follower resolves up to it.
		expect(resolveChainWorktreeOwnerTaskId(linked.board, "bbbbb")).toBe("aaaaa");
		expect(resolveChainWorktreeOwnerTaskId(linked.board, "aaaaa")).toBe("aaaaa");
	});

	it("does not mark a link as a chain when one endpoint is already running", () => {
		const board = boardWithThreeBacklogTasks();
		const running = moveTaskToColumn(board, "bbbbb", "in_progress");
		const linked = addTaskDependency(running.board, "aaaaa", "bbbbb");
		expect(linked.added).toBe(true);
		expect(linked.dependency?.chain).toBeUndefined();
	});

	it("rejects chaining one follower onto two different roots", () => {
		// A→B makes B a follower of A. Trying C→B (B a follower of C too) must be rejected: a
		// follower may resolve to only one root/worktree owner.
		const first = addTaskDependency(boardWithThreeBacklogTasks(), "aaaaa", "bbbbb");
		if (!first.added) {
			throw new Error("Expected first chain link to be created.");
		}
		const second = addTaskDependency(first.board, "ccccc", "bbbbb");
		expect(second.added).toBe(false);
		expect(second.reason).toBe("chain_conflict");
	});

	it("resolves the worktree owner transitively to the chain root", () => {
		// A→B→C: A runs first (root), B follows A, C follows B → all share A's worktree.
		const linkAB = addTaskDependency(boardWithThreeBacklogTasks(), "aaaaa", "bbbbb");
		const linkBC = addTaskDependency(linkAB.board, "bbbbb", "ccccc");
		const board = linkBC.board;
		expect(resolveChainWorktreeOwnerTaskId(board, "ccccc")).toBe("aaaaa");
		expect(resolveChainWorktreeOwnerTaskId(board, "bbbbb")).toBe("aaaaa");
		expect(resolveChainWorktreeOwnerTaskId(board, "aaaaa")).toBe("aaaaa");
	});

	it("keeps the shared worktree while a chain follower is still live", () => {
		// A→B: A is the root, B follows. Root moved to review then trashed; B still live.
		const linkAB = addTaskDependency(boardWithThreeBacklogTasks(), "aaaaa", "bbbbb");
		const inProgress = moveTaskToColumn(linkAB.board, "aaaaa", "in_progress");
		const review = moveTaskToColumn(inProgress.board, "aaaaa", "review");
		const trashed = trashTaskAndGetReadyLinkedTaskIds(review.board, "aaaaa");
		expect(hasLiveChainMemberSharingWorktree(trashed.board, "aaaaa", "aaaaa")).toBe(true);
	});

	it("unlocks a chain follower already queued in in_progress when the root is Done", () => {
		const linkAB = addTaskDependency(boardWithThreeBacklogTasks(), "aaaaa", "bbbbb");
		let board = moveTaskToColumn(linkAB.board, "aaaaa", "in_progress").board;
		board = moveTaskToColumn(board, "bbbbb", "in_progress").board;
		board = moveTaskToColumn(board, "aaaaa", "review").board;
		const trashed = trashTaskAndGetReadyLinkedTaskIds(board, "aaaaa");
		expect(trashed.moved).toBe(true);
		expect(trashed.readyTaskIds).toEqual(["bbbbb"]);
		expect(getTaskColumnId(trashed.board, "bbbbb")).toBe("in_progress");
	});

	it("unlocks every direct waiter of a forked chain when the root is Done", () => {
		// Fork without linearize: B and C both wait on A, so both unlock together.
		const linkAB = addTaskDependency(boardWithThreeBacklogTasks(), "aaaaa", "bbbbb");
		const forked = addTaskDependency(linkAB.board, "aaaaa", "ccccc").board;
		let board = moveTaskToColumn(forked, "aaaaa", "in_progress").board;
		board = moveTaskToColumn(board, "bbbbb", "in_progress").board;
		board = moveTaskToColumn(board, "ccccc", "in_progress").board;
		board = moveTaskToColumn(board, "aaaaa", "review").board;
		const trashed = trashTaskAndGetReadyLinkedTaskIds(board, "aaaaa");
		expect(trashed.readyTaskIds.sort()).toEqual(["bbbbb", "ccccc"]);
	});

	it("after linearizing a fork, Done on the root unlocks only the next follower", () => {
		const linkAB = addTaskDependency(boardWithThreeBacklogTasks(), "aaaaa", "bbbbb");
		const forked = addTaskDependency(linkAB.board, "aaaaa", "ccccc").board;
		const linearized = reorderChainMembers(forked, ["aaaaa", "bbbbb", "ccccc"]);
		expect(linearized.reordered).toBe(true);
		let board = moveTaskToColumn(linearized.board, "aaaaa", "in_progress").board;
		board = moveTaskToColumn(board, "bbbbb", "in_progress").board;
		board = moveTaskToColumn(board, "ccccc", "in_progress").board;
		board = moveTaskToColumn(board, "aaaaa", "review").board;
		const trashed = trashTaskAndGetReadyLinkedTaskIds(board, "aaaaa");
		expect(trashed.readyTaskIds).toEqual(["bbbbb"]);
		expect(trashed.readyTaskIds).not.toContain("ccccc");
	});

	it("computes ready followers with an explicit review fromColumnId when already in Done", () => {
		const linkAB = addTaskDependency(boardWithThreeBacklogTasks(), "aaaaa", "bbbbb");
		let board = moveTaskToColumn(linkAB.board, "aaaaa", "in_progress").board;
		board = moveTaskToColumn(board, "bbbbb", "in_progress").board;
		board = moveTaskToColumn(board, "aaaaa", "review").board;
		board = moveTaskToColumn(board, "aaaaa", "trash").board;
		// Already in Done: column-based unlock would no-op; override keeps chain handoff working.
		expect(getReadyLinkedTaskIdsForTaskInTrash(board, "aaaaa")).toEqual([]);
		expect(getReadyLinkedTaskIdsAfterLeavingReview(board, "aaaaa", "review")).toEqual(["bbbbb"]);
	});

	it("releases the shared worktree once no live chain member remains", () => {
		const linkAB = addTaskDependency(boardWithThreeBacklogTasks(), "aaaaa", "bbbbb");
		let board = moveTaskToColumn(linkAB.board, "aaaaa", "trash").board;
		board = moveTaskToColumn(board, "bbbbb", "trash").board;
		board = moveTaskToColumn(board, "ccccc", "trash").board;
		expect(hasLiveChainMemberSharingWorktree(board, "aaaaa", "bbbbb")).toBe(false);
	});

	it("preserves the chain flag through updateTaskDependencies", () => {
		const linked = addTaskDependency(boardWithThreeBacklogTasks(), "aaaaa", "bbbbb");
		const normalized = updateTaskDependencies(linked.board);
		expect(normalized.dependencies[0]?.chain).toBe(true);
	});

	// A→B→C: build the linear chain [A, B, C].
	function chainedBoard(): RuntimeBoardData {
		const linkAB = addTaskDependency(boardWithThreeBacklogTasks(), "aaaaa", "bbbbb");
		const linkBC = addTaskDependency(linkAB.board, "bbbbb", "ccccc");
		return linkBC.board;
	}

	it("reorders chain members and repoints the worktree owner to the new first member", () => {
		// Reorder [A, B, C] → [C, A, B]: C becomes the root/worktree owner.
		const result = reorderChainMembers(chainedBoard(), ["ccccc", "aaaaa", "bbbbb"]);
		expect(result.reordered).toBe(true);
		expect(resolveChainWorktreeOwnerTaskId(result.board, "aaaaa")).toBe("ccccc");
		expect(resolveChainWorktreeOwnerTaskId(result.board, "bbbbb")).toBe("ccccc");
		expect(resolveChainWorktreeOwnerTaskId(result.board, "ccccc")).toBe("ccccc");
		// Still a single linear spine of two chain edges.
		const chainEdges = result.board.dependencies.filter((dependency) => dependency.chain === true);
		expect(chainEdges).toHaveLength(2);
	});

	it("linearizes a forked chain when reordering", () => {
		// A→B and A→C (a fork: both B and C follow A). Reorder to a single line [A, B, C].
		const linkAB = addTaskDependency(boardWithThreeBacklogTasks(), "aaaaa", "bbbbb");
		const forked = addTaskDependency(linkAB.board, "aaaaa", "ccccc").board;
		const result = reorderChainMembers(forked, ["aaaaa", "bbbbb", "ccccc"]);
		expect(result.reordered).toBe(true);
		expect(resolveChainWorktreeOwnerTaskId(result.board, "ccccc")).toBe("aaaaa");
		const chainEdges = result.board.dependencies.filter((dependency) => dependency.chain === true);
		expect(chainEdges).toHaveLength(2);
		expect(chainEdges.some((edge) => edge.fromTaskId === "ccccc" && edge.toTaskId === "bbbbb")).toBe(true);
	});

	it("does not reorder across two different chains or for out-of-Backlog members", () => {
		const board = chainedBoard();
		// A non-member id breaks the "one shared chain" invariant.
		expect(reorderChainMembers(board, ["aaaaa", "bbbbb", "zzzzz"]).reordered).toBe(false);
		// A member that has left Backlog cannot be reordered into the run order.
		const running = moveTaskToColumn(board, "aaaaa", "in_progress").board;
		expect(reorderChainMembers(running, ["aaaaa", "bbbbb", "ccccc"]).reordered).toBe(false);
	});

	it("breaks a chain, leaving members as standalone tasks", () => {
		const result = breakChain(chainedBoard(), ["aaaaa", "bbbbb", "ccccc"]);
		expect(result.removed).toBe(true);
		expect(result.board.dependencies).toHaveLength(0);
		expect(resolveChainWorktreeOwnerTaskId(result.board, "ccccc")).toBe("ccccc");
	});
});
