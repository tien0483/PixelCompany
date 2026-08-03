import { describe, expect, it } from "vitest";

import { createInitialBoardData } from "@/data/board-data";
import { addTaskDependency, addTaskToColumn, moveTaskToColumn } from "@/state/board-state";
import { computeBacklogChainGroups, computeChainGroups, resolveChainRootId } from "@/state/chain-groups";
import type { BoardData } from "@/types";

// Builds N backlog tasks and returns the board plus each task id by its 1-based order.
function backlogBoard(count: number): { board: BoardData; ids: string[] } {
	let board = createInitialBoardData();
	for (let i = 0; i < count; i += 1) {
		board = addTaskToColumn(board, "backlog", { prompt: `Task ${i + 1}`, baseRef: "main" });
	}
	const ids = board.columns.find((column) => column.id === "backlog")?.cards.map((card) => card.id) ?? [];
	return { board, ids };
}

// Links so that `followerId` waits on `rootId`. addTaskDependency's first arg runs first (the
// root/prerequisite), so the root is passed first and the follower second.
function chain(board: BoardData, followerId: string, rootId: string): BoardData {
	const result = addTaskDependency(board, rootId, followerId);
	if (!result.added) {
		throw new Error(`Expected chain link ${followerId} -> ${rootId} (${result.reason}).`);
	}
	return result.board;
}

function backlogCards(board: BoardData) {
	return board.columns.find((column) => column.id === "backlog")?.cards ?? [];
}

function inProgressCards(board: BoardData) {
	return board.columns.find((column) => column.id === "in_progress")?.cards ?? [];
}

describe("computeBacklogChainGroups", () => {
	it("returns no groups when there are no chain dependencies", () => {
		const { board } = backlogBoard(2);
		const grouping = computeBacklogChainGroups(backlogCards(board), board.dependencies);
		expect(grouping.groups).toHaveLength(0);
	});

	it("groups a root with its follower in run order", () => {
		const { board, ids } = backlogBoard(2);
		const [root, follower] = ids as [string, string];
		const linked = chain(board, follower, root);
		const grouping = computeBacklogChainGroups(backlogCards(linked), linked.dependencies);

		expect(grouping.groups).toHaveLength(1);
		expect(grouping.groups[0]?.rootId).toBe(root);
		expect(grouping.groups[0]?.stackHeadId).toBe(root);
		expect(grouping.groups[0]?.memberIdsInOrder).toEqual([root, follower]);
		expect(grouping.rootIdByMemberId.get(follower)).toBe(root);
		expect(grouping.groupByRootId.has(root)).toBe(true);
	});

	it("orders a multi-level chain breadth-first from the root", () => {
		const { board, ids } = backlogBoard(3);
		const [a, b, c] = ids as [string, string, string];
		let linked = chain(board, b, a); // B waits on A
		linked = chain(linked, c, b); // C waits on B
		const grouping = computeBacklogChainGroups(backlogCards(linked), linked.dependencies);

		expect(grouping.groups).toHaveLength(1);
		expect(grouping.groups[0]?.memberIdsInOrder).toEqual([a, b, c]);
		expect(grouping.rootIdByMemberId.get(c)).toBe(a);
	});

	it("does not group a plain wait-link (one endpoint not in Backlog)", () => {
		const { board, ids } = backlogBoard(2);
		const [root, follower] = ids as [string, string];
		const running = moveTaskToColumn(board, root, "in_progress").board;
		const linked = addTaskDependency(running, follower, root);
		expect(linked.added).toBe(true);
		expect(linked.dependency?.chain).toBeUndefined();

		const grouping = computeBacklogChainGroups(backlogCards(linked.board), linked.board.dependencies);
		expect(grouping.groups).toHaveLength(0);
	});
});

describe("computeChainGroups", () => {
	it("keeps an in-progress queue stack after the root leaves Backlog", () => {
		const { board, ids } = backlogBoard(3);
		const [a, b, c] = ids as [string, string, string];
		let linked = chain(board, b, a);
		linked = chain(linked, c, b);
		linked = moveTaskToColumn(linked, a, "in_progress").board;
		linked = moveTaskToColumn(linked, b, "in_progress").board;
		linked = moveTaskToColumn(linked, c, "in_progress").board;

		const grouping = computeChainGroups(inProgressCards(linked), linked.dependencies);
		expect(grouping.groups).toHaveLength(1);
		expect(grouping.groups[0]?.rootId).toBe(a);
		expect(grouping.groups[0]?.stackHeadId).toBe(a);
		expect(grouping.groups[0]?.memberIdsInOrder).toEqual([a, b, c]);
	});

	it("re-anchors the stack head when the ultimate root has left the column", () => {
		const { board, ids } = backlogBoard(3);
		const [a, b, c] = ids as [string, string, string];
		let linked = chain(board, b, a);
		linked = chain(linked, c, b);
		linked = moveTaskToColumn(linked, a, "in_progress").board;
		linked = moveTaskToColumn(linked, b, "in_progress").board;
		linked = moveTaskToColumn(linked, c, "in_progress").board;
		linked = moveTaskToColumn(linked, a, "review").board;
		linked = moveTaskToColumn(linked, a, "trash").board;

		const grouping = computeChainGroups(inProgressCards(linked), linked.dependencies);
		expect(grouping.groups).toHaveLength(1);
		expect(grouping.groups[0]?.rootId).toBe(a);
		expect(grouping.groups[0]?.stackHeadId).toBe(b);
		expect(grouping.groups[0]?.memberIdsInOrder).toEqual([b, c]);
		expect(grouping.rootIdByMemberId.get(c)).toBe(b);
		expect(grouping.groupByRootId.has(b)).toBe(true);
	});
});

describe("resolveChainRootId", () => {
	it("walks followers up to the chain root", () => {
		const { board, ids } = backlogBoard(3);
		const [a, b, c] = ids as [string, string, string];
		let linked = chain(board, b, a);
		linked = chain(linked, c, b);
		expect(resolveChainRootId(linked.dependencies, c)).toBe(a);
		expect(resolveChainRootId(linked.dependencies, a)).toBe(a);
	});
});
