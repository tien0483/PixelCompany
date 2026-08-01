import { describe, expect, it } from "vitest";

import { createInitialBoardData } from "@/data/board-data";
import {
	addTaskToColumn,
	addTaskToColumnWithResult,
	findCardSelection,
	normalizeBoardData,
	setTaskLaunchSettings,
	updateTask,
	updateTaskTitle,
} from "@/state/board-state";

function boardWithOneTask(): { board: ReturnType<typeof createInitialBoardData>; taskId: string } {
	const board = addTaskToColumn(createInitialBoardData(), "backlog", {
		prompt: "tag me",
		baseRef: "main",
	});
	const taskId = board.columns.find((column) => column.id === "backlog")?.cards[0]?.id;
	if (!taskId) {
		throw new Error("Fixture task was not created");
	}
	return { board, taskId };
}

describe("setTaskLaunchSettings", () => {
	it("stores model/effort/skill/mcp tags on the card", () => {
		const { board, taskId } = boardWithOneTask();

		const result = setTaskLaunchSettings(board, taskId, {
			modelId: "sonnet",
			effort: "high",
			skillIds: ["review"],
			mcpServerIds: ["filesystem"],
		});

		expect(result.updated).toBe(true);
		expect(findCardSelection(result.board, taskId)?.card.taskLaunchSettings).toEqual({
			modelId: "sonnet",
			effort: "high",
			skillIds: ["review"],
			mcpServerIds: ["filesystem"],
		});
	});

	it("clears tags with null", () => {
		const { board, taskId } = boardWithOneTask();
		const tagged = setTaskLaunchSettings(board, taskId, { modelId: "opus", skillIds: ["plan"] }).board;

		const result = setTaskLaunchSettings(tagged, taskId, null);

		expect(result.updated).toBe(true);
		expect(findCardSelection(result.board, taskId)?.card.taskLaunchSettings).toBeUndefined();
		expect("taskLaunchSettings" in (findCardSelection(result.board, taskId)?.card ?? {})).toBe(false);
	});

	it("is a no-op when tags are unchanged", () => {
		const { board, taskId } = boardWithOneTask();
		const tagged = setTaskLaunchSettings(board, taskId, { modelId: "sonnet" }).board;

		const result = setTaskLaunchSettings(tagged, taskId, { modelId: "sonnet" });

		expect(result.updated).toBe(false);
		expect(result.board).toBe(tagged);
	});

	it("survives unrelated title edits", () => {
		const { board, taskId } = boardWithOneTask();
		const tagged = setTaskLaunchSettings(board, taskId, {
			skillIds: ["review"],
			mcpServerIds: ["filesystem"],
		}).board;

		const renamed = updateTaskTitle(tagged, taskId, "renamed").board;

		expect(findCardSelection(renamed, taskId)?.card.taskLaunchSettings).toEqual({
			skillIds: ["review"],
			mcpServerIds: ["filesystem"],
		});
	});
});

describe("taskLaunchSettings create / update / normalize", () => {
	it("stamps tags when creating a task", () => {
		const created = addTaskToColumnWithResult(createInitialBoardData(), "backlog", {
			prompt: "with tags",
			baseRef: "main",
			agentId: "claude",
			taskLaunchSettings: {
				modelId: "opus",
				effort: "max",
				skillIds: ["review"],
			},
		});

		expect(created.task.taskLaunchSettings).toEqual({
			modelId: "opus",
			effort: "max",
			skillIds: ["review"],
		});
	});

	it("updates tags through updateTask and can clear them with undefined", () => {
		const { board, taskId } = boardWithOneTask();
		const tagged = setTaskLaunchSettings(board, taskId, {
			modelId: "sonnet",
			skillIds: ["review"],
		}).board;

		const updated = updateTask(tagged, taskId, {
			prompt: "tag me",
			baseRef: "main",
			taskLaunchSettings: {
				modelId: "haiku",
				mcpServerIds: ["filesystem"],
			},
		});

		expect(updated.updated).toBe(true);
		expect(findCardSelection(updated.board, taskId)?.card.taskLaunchSettings).toEqual({
			modelId: "haiku",
			mcpServerIds: ["filesystem"],
		});

		const cleared = updateTask(updated.board, taskId, {
			prompt: "tag me",
			baseRef: "main",
			taskLaunchSettings: undefined,
		});
		expect(findCardSelection(cleared.board, taskId)?.card.taskLaunchSettings).toBeUndefined();
	});

	it("normalizes persisted board JSON with taskLaunchSettings", () => {
		const raw = {
			columns: [
				{
					id: "backlog",
					title: "Backlog",
					cards: [
						{
							id: "task-abc",
							title: "Persisted",
							prompt: "Keep tags",
							startInPlanMode: false,
							autoReviewEnabled: false,
							autoReviewMode: "commit",
							baseRef: "main",
							agentId: "cursor",
							taskLaunchSettings: {
								modelId: "  composer-2  ",
								effort: "high",
								skillIds: ["review", "", "review"],
								mcpServerIds: ["filesystem"],
							},
							createdAt: 1,
							updatedAt: 1,
						},
					],
				},
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [],
		};

		const board = normalizeBoardData(raw);
		expect(board).not.toBeNull();
		const card = board!.columns.find((column) => column.id === "backlog")?.cards[0];
		expect(card?.taskLaunchSettings).toEqual({
			modelId: "composer-2",
			effort: "high",
			skillIds: ["review"],
			mcpServerIds: ["filesystem"],
		});
	});
});
