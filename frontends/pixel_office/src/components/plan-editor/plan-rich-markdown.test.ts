import { Editor } from "@tiptap/react";
import { describe, expect, it } from "vitest";

import { createPlanEditorExtensions } from "@/components/plan-editor/plan-rich-extensions";
import {
	fromEditorMarkdown,
	getMarkdownFromEditor,
	PlanMarkdownStorageError,
	toEditorMarkdown,
} from "@/components/plan-editor/plan-rich-markdown";

describe("plan-rich-markdown", () => {
	it("rewrites relative image paths to asset URLs for the editor", () => {
		const input = "See ![shot](diagram.png)";
		expect(toEditorMarkdown(input, "plan-1")).toBe(
			"See ![shot](/api/plans/asset?planId=plan-1&path=diagram.png)",
		);
	});

	it("restores relative paths before saving", () => {
		const input =
			"See ![shot](/api/plans/asset?planId=plan-1&path=diagram.png)";
		expect(fromEditorMarkdown(input, "plan-1")).toBe(
			"See ![shot](diagram.png)",
		);
	});

	it("throws PlanMarkdownStorageError when markdown storage is missing", () => {
		const editor = new Editor({
			element: document.createElement("div"),
			extensions: createPlanEditorExtensions().filter(
				(extension) => extension.name !== "markdown",
			),
			content: "hello",
		});
		try {
			expect(() => getMarkdownFromEditor(editor)).toThrow(
				PlanMarkdownStorageError,
			);
		} finally {
			editor.destroy();
		}
	});
});
