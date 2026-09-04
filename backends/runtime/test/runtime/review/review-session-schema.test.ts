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

/**
 * The annotations field was added after the initial chat fields. Sessions written before
 * it must still parse — `.default([])` is the guard; these tests confirm it is in place.
 */
describe("runtimeReviewSessionSchema annotations field", () => {
	const legacyDocument = {
		host: "code.example.com",
		projectId: 12,
		iid: 142,
		lastReviewedHeadSha: null,
		reviewedPaths: [],
		draftComments: [],
		findings: [],
		dismissedFindingIds: [],
		updatedAt: "2026-08-01T00:00:00.000Z",
	};

	it("defaults annotations to [] when the field is absent (backward-compat)", () => {
		const parsed = runtimeReviewSessionSchema.safeParse(legacyDocument);

		expect(parsed.success).toBe(true);
		expect(parsed.success && parsed.data.annotations).toEqual([]);
	});

	it("accepts and round-trips a full annotation object", () => {
		const annotation = {
			id: "ann-1",
			newPath: "src/app.ts",
			oldPath: "src/app.ts",
			newLine: 42,
			oldLine: null,
			tag: { kind: "builtin", label: "Bug Risk" },
			note: "looks risky",
			headSha: "abc123",
			createdAt: "2026-09-01T00:00:00.000Z",
			verdict: {
				verdict: "confirmed",
				reasoning: "yes, it is a bug",
				headSha: "abc123",
				at: "2026-09-01T01:00:00.000Z",
			},
		};
		const parsed = runtimeReviewSessionSchema.parse({
			...legacyDocument,
			annotations: [annotation],
		});

		expect(parsed.annotations).toHaveLength(1);
		expect(parsed.annotations[0]?.id).toBe("ann-1");
		expect(parsed.annotations[0]?.verdict?.verdict).toBe("confirmed");
	});

	it("accepts an annotation without a verdict (pre-audit state)", () => {
		const parsed = runtimeReviewSessionSchema.safeParse({
			...legacyDocument,
			annotations: [
				{
					id: "ann-2",
					newPath: "src/index.ts",
					oldPath: "src/index.ts",
					newLine: 10,
					oldLine: null,
					tag: { kind: "rule-category", label: "Security" },
					note: "",
					headSha: null,
					createdAt: "2026-09-01T00:00:00.000Z",
					verdict: null,
				},
			],
		});

		expect(parsed.success).toBe(true);
	});

	it("accepts the refactoring-catalog tag kinds", () => {
		for (const kind of ["smell", "refactoring"]) {
			const parsed = runtimeReviewSessionSchema.safeParse({
				...legacyDocument,
				annotations: [
					{
						id: `ann-${kind}`,
						newPath: "src/index.ts",
						oldPath: "src/index.ts",
						newLine: 10,
						oldLine: null,
						tag: { kind, label: "Feature Envy" },
						note: "",
						headSha: null,
						createdAt: "2026-09-01T00:00:00.000Z",
						verdict: null,
					},
				],
			});

			expect(parsed.success).toBe(true);
		}
	});

	it("rejects an annotation with an unknown tag kind", () => {
		const parsed = runtimeReviewSessionSchema.safeParse({
			...legacyDocument,
			annotations: [
				{
					id: "ann-4",
					newPath: "a.ts",
					oldPath: "a.ts",
					newLine: 1,
					oldLine: null,
					tag: { kind: "design-pattern", label: "Observer" },
					note: "",
					headSha: null,
					createdAt: "2026-09-01T00:00:00.000Z",
					verdict: null,
				},
			],
		});

		expect(parsed.success).toBe(false);
	});

	it("rejects an annotation with an unknown verdict value", () => {
		const parsed = runtimeReviewSessionSchema.safeParse({
			...legacyDocument,
			annotations: [
				{
					id: "ann-3",
					newPath: "a.ts",
					oldPath: "a.ts",
					newLine: 1,
					oldLine: null,
					tag: { kind: "builtin", label: "Pattern" },
					note: "",
					headSha: null,
					createdAt: "2026-09-01T00:00:00.000Z",
					verdict: { verdict: "unsure", reasoning: "?", headSha: null, at: "2026-09-01T00:00:00.000Z" },
				},
			],
		});

		expect(parsed.success).toBe(false);
	});
});
