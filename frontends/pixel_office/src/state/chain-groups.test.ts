import { describe, expect, it } from "vitest";

import { createInitialBoardData } from "@/data/board-data";
import { addTaskDependency, addTaskToColumn, moveTaskToColumn } from "@/state/board-state";
import { computeBacklogChainGroups, resolveChainRootId } from "@/state/chain-groups";
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

// addTaskDependency(board, follower, root): follower waits on root.
function chain(board: BoardData, followerId: string, rootId: string): BoardData {
	const result = addTaskDependency(board, followerId, rootId);
	if (!result.added) {
		throw new Error(`Expected chain link ${followerId} -> ${rootId} (${result.reason}).`);
	}
	return result.board;
}

function backlogCards(board: BoardData) {
	return board.columns.find((column) => column.id === "backlog")?.cards ?? [];
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
