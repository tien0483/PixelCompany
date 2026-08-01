import { describe, expect, it } from "vitest";

import {
	runtimeBoardCardSchema,
	runtimeTaskSessionStartRequestSchema,
} from "../../../src/core/api-contract";

describe("taskLaunchSettings schema", () => {
	it("round-trips on board cards", () => {
		const card = runtimeBoardCardSchema.parse({
			id: "task-1",
			title: "Tagged task",
			prompt: "Do the work",
			startInPlanMode: false,
			autoReviewEnabled: false,
			autoReviewMode: "commit",
			baseRef: "main",
			createdAt: 1,
			updatedAt: 1,
			taskLaunchSettings: {
				modelId: "sonnet",
				effort: "high",
				skillIds: ["review"],
				agentIds: ["code-reviewer"],
				commandIds: ["pr"],
				mcpServerIds: ["filesystem"],
			},
		});
		expect(card.taskLaunchSettings).toEqual({
			modelId: "sonnet",
			effort: "high",
			skillIds: ["review"],
			agentIds: ["code-reviewer"],
			commandIds: ["pr"],
			mcpServerIds: ["filesystem"],
		});
	});

	it("accepts taskLaunchSettings on startTaskSession", () => {
		const request = runtimeTaskSessionStartRequestSchema.parse({
			taskId: "task-1",
			prompt: "Go",
			baseRef: "main",
			taskLaunchSettings: {
				modelId: "composer-2",
				skillIds: ["plan"],
			},
		});
		expect(request.taskLaunchSettings?.modelId).toBe("composer-2");
		expect(request.taskLaunchSettings?.skillIds).toEqual(["plan"]);
	});

	it("rejects invalid effort values", () => {
		expect(() =>
			runtimeBoardCardSchema.parse({
				id: "task-1",
				title: "Bad effort",
				prompt: "Do the work",
				startInPlanMode: false,
				autoReviewEnabled: false,
				autoReviewMode: "commit",
				baseRef: "main",
				createdAt: 1,
				updatedAt: 1,
				taskLaunchSettings: {
					effort: "turbo",
				},
			}),
		).toThrow();
	});

	it("allows empty skill/MCP arrays (inherit-all) on start requests", () => {
		const request = runtimeTaskSessionStartRequestSchema.parse({
			taskId: "task-1",
			prompt: "Go",
			baseRef: "main",
			taskLaunchSettings: {
				modelId: "sonnet",
				skillIds: [],
				mcpServerIds: [],
			},
		});
		expect(request.taskLaunchSettings).toEqual({
			modelId: "sonnet",
			skillIds: [],
			mcpServerIds: [],
		});
	});
});
