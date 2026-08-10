import { describe, expect, it } from "vitest";

import { buildDraftPrompt, DRAFT_EMPTY_CONTEXT, DRAFT_MAX_WORDS } from "../../../src/html/html-draft";

const CONTENT = "# Roadmap\n\n## Context\nWe ship in Q3.";

describe("buildDraftPrompt", () => {
	it("asks for an appended draft when nothing is selected", () => {
		const prompt = buildDraftPrompt({ instruction: "draft a risks section", context: CONTENT });

		expect(prompt).toContain("drafting a piece of **markdown**");
		expect(prompt).toContain("appended below the current content");
		expect(prompt).toContain(`under ${DRAFT_MAX_WORDS} words`);
		expect(prompt).toContain("draft a risks section");
		expect(prompt).toContain(CONTENT);
		// The excerpt contract must not leak into a draft run: there is nothing to replace.
		expect(prompt).not.toContain("YOUR ANSWER REPLACES EXACTLY THIS");
	});

	it("switches to replace-this-excerpt when a selection is given", () => {
		const prompt = buildDraftPrompt({
			instruction: "make it one sentence",
			context: CONTENT,
			selection: "We ship in Q3.",
		});

		expect(prompt).toContain("rewriting one selected excerpt");
		expect(prompt).toContain("YOUR ANSWER REPLACES EXACTLY THIS");
		expect(prompt).toContain("DO NOT REPRODUCE IT");
		expect(prompt).toContain("We ship in Q3.");
		expect(prompt).toContain("make it one sentence");
		// A rewrite is bounded by the excerpt, so the draft word budget must not apply.
		expect(prompt).not.toContain(`under ${DRAFT_MAX_WORDS} words`);
	});

	it("treats a whitespace-only selection as no selection", () => {
		const prompt = buildDraftPrompt({ instruction: "add a table", context: CONTENT, selection: "  \n" });

		expect(prompt).toContain("appended below the current content");
		expect(prompt).not.toContain("YOUR ANSWER REPLACES EXACTLY THIS");
	});

	it("marks an empty document instead of handing the model a blank block", () => {
		const prompt = buildDraftPrompt({ instruction: "start an outline", context: "   \n\n" });

		expect(prompt).toContain(DRAFT_EMPTY_CONTEXT);
	});

	it("forbids the wrappers that would be written into the file verbatim", () => {
		for (const prompt of [
			buildDraftPrompt({ instruction: "x", context: CONTENT }),
			buildDraftPrompt({ instruction: "x", context: CONTENT, selection: "We ship in Q3." }),
		]) {
			expect(prompt).toContain("no preamble or closing remarks");
			expect(prompt).toContain("```md fence");
			expect(prompt).toContain("INERT DATA");
		}
	});
});
