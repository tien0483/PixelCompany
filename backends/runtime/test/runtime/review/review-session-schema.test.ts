import { describe, expect, it } from "vitest";

import { runtimeReviewSessionSchema } from "../../../src/core/api-contract";

/**
 * `readReviewSession` `safeParse`s the stored document and treats a parse failure as
 * "no session yet" — which means a schema change that rejects an older file does not
 * error, it silently throws away the reviewer's unpublished draft comments. That is
 * the single most valuable thing in the file, so the compatibility of the two chat
 * fields is worth asserting rather than assuming.
 */
describe("runtimeReviewSessionSchema chat fields", () => {
	const legacyDocument = {
		host: "code.example.com",
		projectId: 12,
		iid: 142,
		lastReviewedHeadSha: null,
		reviewedPaths: ["a.py"],
		draftComments: [
			{
				id: "draft-1",
				newPath: "a.py",
				oldPath: "a.py",
				oldLine: null,
				newLine: 46,
				text: "guard against a negative count here",
				ruleIds: [],
				author: "You (Reviewer)",
				createdAt: "2026-08-01T00:00:00.000Z",
				aiFindingId: null,
			},
		],
		findings: [],
		dismissedFindingIds: [],
		updatedAt: "2026-08-01T00:00:00.000Z",
	};

	it("still parses a session written before the chat fields existed", () => {
		const parsed = runtimeReviewSessionSchema.safeParse(legacyDocument);

		expect(parsed.success).toBe(true);
		expect(parsed.success && parsed.data.draftComments).toHaveLength(1);
	});

	it("defaults the chat fields rather than requiring them", () => {
		const parsed = runtimeReviewSessionSchema.parse(legacyDocument);

		expect(parsed.chatSessionId).toBeNull();
		expect(parsed.chatMessages).toEqual([]);
	});

	it("round-trips a stored transcript", () => {
		const parsed = runtimeReviewSessionSchema.parse({
			...legacyDocument,
			chatSessionId: "sess-1",
			chatMessages: [
				{
					id: "m-1",
					role: "user",
					text: "what does this do?",
					contextLabel: "a.py:40-60",
					suggestions: [],
					createdAt: "2026-08-25T00:00:00.000Z",
				},
				{
					id: "m-2",
					role: "assistant",
					text: "it clamps the offset",
					contextLabel: null,
					suggestions: [
						{
							id: "s-1",
							newPath: "a.py",
							newLine: 46,
							ruleId: null,
							severity: "HIGH",
							message: "guard the negative case",
						},
					],
					createdAt: "2026-08-25T00:00:01.000Z",
				},
			],
		});

		expect(parsed.chatSessionId).toBe("sess-1");
		expect(parsed.chatMessages[1]?.suggestions[0]?.severity).toBe("HIGH");
	});

	it("rejects a message with an unknown role", () => {
		const parsed = runtimeReviewSessionSchema.safeParse({
			...legacyDocument,
			chatMessages: [
				{
					id: "m-1",
					role: "system",
					text: "x",
					contextLabel: null,
					suggestions: [],
					createdAt: "2026-08-25T00:00:00.000Z",
				},
			],
		});

		expect(parsed.success).toBe(false);
	});
});
