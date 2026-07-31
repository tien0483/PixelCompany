import { describe, expect, it } from "vitest";

import { createInitialBoardData } from "@/data/board-data";
import { addTaskToColumn, findCardSelection, setTaskJackedAccount, updateTaskTitle } from "@/state/board-state";

function boardWithOneTask(): { board: ReturnType<typeof createInitialBoardData>; taskId: string } {
	const board = addTaskToColumn(createInitialBoardData(), "backlog", {
		prompt: "pin me",
		baseRef: "main",
	});
	const taskId = board.columns.find((column) => column.id === "backlog")?.cards[0]?.id;
	if (!taskId) {
		throw new Error("Fixture task was not created");
	}
	return { board, taskId };
}

describe("setTaskJackedAccount", () => {
	it("pins a card to a Claude account", () => {
		const { board, taskId } = boardWithOneTask();

		const result = setTaskJackedAccount(board, taskId, 2);

		expect(result.updated).toBe(true);
		expect(findCardSelection(result.board, taskId)?.card.jackedAccountId).toBe(2);
	});

	it("clears the pin so the task follows auto-swap again", () => {
		const { board, taskId } = boardWithOneTask();
		const pinned = setTaskJackedAccount(board, taskId, 2).board;

		const result = setTaskJackedAccount(pinned, taskId, null);

		expect(result.updated).toBe(true);
		expect(findCardSelection(result.board, taskId)?.card.jackedAccountId).toBeUndefined();
		expect("jackedAccountId" in (findCardSelection(result.board, taskId)?.card ?? {})).toBe(false);
	});

	it("is a no-op when the pin is unchanged", () => {
		const { board, taskId } = boardWithOneTask();
		const pinned = setTaskJackedAccount(board, taskId, 5).board;

		const result = setTaskJackedAccount(pinned, taskId, 5);

		expect(result.updated).toBe(false);
		expect(result.board).toBe(pinned);
	});

	it("ignores unknown task ids", () => {
		const { board } = boardWithOneTask();

		const result = setTaskJackedAccount(board, "missing-task", 1);

		expect(result.updated).toBe(false);
		expect(result.board).toBe(board);
	});

	it("survives unrelated card edits", () => {
		const { board, taskId } = boardWithOneTask();
		const pinned = setTaskJackedAccount(board, taskId, 3).board;

		const renamed = updateTaskTitle(pinned, taskId, "renamed task").board;

		expect(findCardSelection(renamed, taskId)?.card.jackedAccountId).toBe(3);
	});
});
