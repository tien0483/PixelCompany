import { describe, expect, it } from "vitest";

import type { BoardCard, BoardColumnId, BoardDependency } from "@/types";
import { computeDraggableCardOrder, type DragRenderContext, resolveDropInsertIndex } from "@/state/drag-index-mapping";

function cards(...ids: string[]): BoardCard[] {
	return ids.map(
		(id) =>
			({
				id,
				title: id,
				prompt: id,
				agentId: "claude",
				baseRef: "main",
				createdAt: 0,
				updatedAt: 0,
			}) as unknown as BoardCard,
	);
}

/** `follower` waits on `root`, sharing its worktree. */
function chainDependency(root: string, follower: string): BoardDependency {
	return {
		id: `${root}->${follower}`,
		fromTaskId: follower,
		toTaskId: root,
		chain: true,
		createdAt: 0,
	} as unknown as BoardDependency;
}

const BOARD_CONTEXT: DragRenderContext = { chainGroupingEnabled: true };
const DETAIL_CONTEXT: DragRenderContext = { chainGroupingEnabled: false };

function order(
	columnId: BoardColumnId,
	cardIds: string[],
	dependencies: BoardDependency[],
	context: DragRenderContext,
): string[] {
	return computeDraggableCardOrder(columnId, cards(...cardIds), dependencies, context);
}

describe("computeDraggableCardOrder", () => {
	it("numbers every card in a flat column", () => {
		expect(order("review", ["a", "b", "c"], [], BOARD_CONTEXT)).toEqual(["a", "b", "c"]);
	});

	it("skips chain followers folded into their stack head", () => {
		// In Progress renders A1 as the stack head with A2 as a queued row underneath.
		const deps = [chainDependency("a1", "a2")];
		expect(order("in_progress", ["a1", "a2", "b1", "b2"], deps, BOARD_CONTEXT)).toEqual(["a1", "b1", "b2"]);
	});

	it("skips a Backlog chain root that expanded into its member list", () => {
		const deps = [chainDependency("a1", "a2")];
		expect(
			order("backlog", ["a1", "a2", "c"], deps, { chainGroupingEnabled: true, expandedChainRootIds: { a1: true } }),
		).toEqual(["c"]);
		// Collapsed, the root renders as its own card again.
		expect(order("backlog", ["a1", "a2", "c"], deps, BOARD_CONTEXT)).toEqual(["a1", "c"]);
	});

	it("skips the Backlog card replaced by the inline editor", () => {
		expect(order("backlog", ["a", "b", "c"], [], { chainGroupingEnabled: true, editingTaskId: "b" })).toEqual([
			"a",
			"c",
		]);
		// Only Backlog swaps in the editor.
		expect(order("in_progress", ["a", "b", "c"], [], { chainGroupingEnabled: true, editingTaskId: "b" })).toEqual([
			"a",
			"b",
			"c",
		]);
	});

	it("keeps followers draggable on a surface that renders no chain groups", () => {
		const deps = [chainDependency("a1", "a2")];
		expect(order("in_progress", ["a1", "a2", "b1"], deps, DETAIL_CONTEXT)).toEqual(["a1", "a2", "b1"]);
	});

	it("does not group chains in columns that render them flat", () => {
		const deps = [chainDependency("a1", "a2")];
		expect(order("review", ["a1", "a2"], deps, BOARD_CONTEXT)).toEqual(["a1", "a2"]);
	});
});

describe("resolveDropInsertIndex", () => {
	const deps = [chainDependency("a1", "a2")];

	function insertIndex(
		columnId: BoardColumnId,
		cardIds: string[],
		dependencies: BoardDependency[],
		movedCardId: string,
		renderIndex: number,
		context: DragRenderContext = BOARD_CONTEXT,
	): number {
		return resolveDropInsertIndex({
			columnId,
			cards: cards(...cardIds),
			dependencies,
			movedCardId,
			renderIndex,
			context,
		});
	}

	it("maps render slots to array slots in a flat column", () => {
		expect(insertIndex("review", ["a", "b", "c"], [], "x", 0)).toBe(0);
		expect(insertIndex("review", ["a", "b", "c"], [], "x", 1)).toBe(1);
		expect(insertIndex("review", ["a", "b", "c"], [], "x", 3)).toBe(3);
	});

	it("lands below the whole stack when dropped below its head", () => {
		// Draggables render A1→0, B1→1; A2 is hidden inside A1's stack.
		// Render slot 1 means "after A1", which must clear A2 too.
		expect(insertIndex("in_progress", ["a1", "a2", "b1"], deps, "x", 1)).toBe(2);
		expect(insertIndex("in_progress", ["a1", "a2", "b1"], deps, "x", 0)).toBe(0);
		expect(insertIndex("in_progress", ["a1", "a2", "b1"], deps, "x", 2)).toBe(3);
	});

	it("ignores the moved card when it comes from the same column", () => {
		// Reordering B1 to the top of [A1, A2, B1]: the only remaining draggable is A1.
		expect(insertIndex("in_progress", ["a1", "a2", "b1"], deps, "b1", 0)).toBe(0);
		expect(insertIndex("in_progress", ["a1", "a2", "b1"], deps, "b1", 1)).toBe(2);
	});

	it("accounts for the inline editor's hidden slot", () => {
		const context: DragRenderContext = { chainGroupingEnabled: true, editingTaskId: "b" };
		// Draggables are A→0 and C→1; B is the editor and occupies array slot 1.
		expect(insertIndex("backlog", ["a", "b", "c"], [], "x", 1, context)).toBe(1);
		expect(insertIndex("backlog", ["a", "b", "c"], [], "x", 2, context)).toBe(3);
	});

	it("appends when the column has no other draggables", () => {
		expect(insertIndex("review", [], [], "x", 0)).toBe(0);
		expect(insertIndex("review", ["x"], [], "x", 0)).toBe(0);
	});

	it("clamps an out-of-range render index", () => {
		expect(insertIndex("review", ["a", "b"], [], "x", 99)).toBe(2);
		expect(insertIndex("review", ["a", "b"], [], "x", -3)).toBe(0);
	});

	it("uses flat numbering for the detail surface", () => {
		// The same column the board renders as a stack: here A2 is its own draggable, so
		// render slot 1 means "after A1" and nothing else.
		expect(insertIndex("in_progress", ["a1", "a2", "b1"], deps, "x", 1, DETAIL_CONTEXT)).toBe(1);
	});
});
