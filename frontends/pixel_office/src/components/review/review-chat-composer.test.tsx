import { describe, expect, it } from "vitest";

import {
	hasRunReviewCommand,
	isMergeRequestScopedPrompt,
	isReviewCommandPrompt,
	REVIEW_CODE_REVIEW_DIFF_COMMAND,
	REVIEW_QUICK_PROMPTS,
	REVIEW_UNDERSTAND_CHANGES_COMMAND,
} from "@/components/review/review-chat-composer";

function userMessage(text: string): { role: "user"; text: string } {
	return { role: "user", text };
}

describe("REVIEW_QUICK_PROMPTS", () => {
	it("no longer offers /understand-diff, which the button now owns", () => {
		// Two answers to "what does this touch", at two scopes, was the confusion.
		expect(REVIEW_QUICK_PROMPTS.map((entry) => entry.command)).toEqual([
			"/security-review",
			"/code-review",
			"/simplify",
		]);
	});
});

describe("isMergeRequestScopedPrompt", () => {
	it("attaches every patch for the buttons, the alias and the security pass", () => {
		for (const prompt of [
			REVIEW_UNDERSTAND_CHANGES_COMMAND,
			REVIEW_CODE_REVIEW_DIFF_COMMAND,
			"/understand-diff",
			"/security-review the parser",
		]) {
			expect(isMergeRequestScopedPrompt(prompt)).toBe(true);
		}
	});

	it("keeps every other turn off the whole-merge-request payload", () => {
		// This is the token bill: `allDiffs` is the most expensive field on the request.
		for (const prompt of ["/code-review", "/simplify", "/review", "what does this do?"]) {
			expect(isMergeRequestScopedPrompt(prompt)).toBe(false);
		}
	});
});

describe("isReviewCommandPrompt", () => {
	it("counts the button commands, so their answers become draft comments", () => {
		expect(isReviewCommandPrompt(REVIEW_UNDERSTAND_CHANGES_COMMAND)).toBe(true);
		expect(isReviewCommandPrompt(REVIEW_CODE_REVIEW_DIFF_COMMAND)).toBe(true);
		expect(isReviewCommandPrompt("/code-review")).toBe(true);
		expect(isReviewCommandPrompt("does this handle null?")).toBe(false);
	});

	it("counts a project's own command", () => {
		expect(isReviewCommandPrompt("/review", [{ command: "/review", description: null, source: "x" }])).toBe(true);
	});
});

describe("hasRunReviewCommand", () => {
	it("is true once the reviewer's own message for that pass is in the transcript", () => {
		const messages = [userMessage("what changed here?"), userMessage(REVIEW_UNDERSTAND_CHANGES_COMMAND)];
		expect(hasRunReviewCommand(messages, REVIEW_UNDERSTAND_CHANGES_COMMAND)).toBe(true);
		expect(hasRunReviewCommand(messages, REVIEW_CODE_REVIEW_DIFF_COMMAND)).toBe(false);
	});

	it("counts a run the reviewer narrowed with their own words", () => {
		const messages = [userMessage(`${REVIEW_CODE_REVIEW_DIFF_COMMAND} focus on the parser`)];
		expect(hasRunReviewCommand(messages, REVIEW_CODE_REVIEW_DIFF_COMMAND)).toBe(true);
	});

	it("ignores the assistant quoting the command back", () => {
		// Otherwise an answer that says "run /code-review-diff for the full pass" would
		// light the dot green without anything having run.
		const messages = [{ role: "assistant" as const, text: `${REVIEW_CODE_REVIEW_DIFF_COMMAND} would cover that` }];
		expect(hasRunReviewCommand(messages, REVIEW_CODE_REVIEW_DIFF_COMMAND)).toBe(false);
	});

	it("does not confuse the two code-review commands", () => {
		expect(hasRunReviewCommand([userMessage("/code-review")], REVIEW_CODE_REVIEW_DIFF_COMMAND)).toBe(false);
		expect(hasRunReviewCommand([userMessage(REVIEW_CODE_REVIEW_DIFF_COMMAND)], "/code-review")).toBe(false);
	});
});
