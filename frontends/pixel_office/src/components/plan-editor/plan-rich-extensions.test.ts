import { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";

import { createPlanEditorExtensions } from "@/components/plan-editor/plan-rich-extensions";
import { getMarkdownFromEditor } from "@/components/plan-editor/plan-rich-markdown";

describe("createPlanEditorExtensions", () => {
	let editor: Editor | null = null;

	afterEach(() => {
		editor?.destroy();
		editor = null;
	});

	it("installs tiptap-markdown storage with getMarkdown", () => {
		editor = new Editor({
			element: document.createElement("div"),
			extensions: createPlanEditorExtensions(),
			content: "# Roadmap\n",
		});

		expect(
			typeof (editor.storage as { markdown?: { getMarkdown?: () => string } })
				.markdown?.getMarkdown,
		).toBe("function");
		const markdown = getMarkdownFromEditor(editor);
		expect(markdown.trim()).toContain("# Roadmap");
	});

	it("serializes highlight and text color marks with exact, correctly-placed HTML", () => {
		editor = new Editor({
			element: document.createElement("div"),
			extensions: createPlanEditorExtensions(),
			content: "<p>before <mark>highlighted</mark> <span style=\"color: #F85149\">red</span> after</p>",
		});

		const markdown = getMarkdownFromEditor(editor).trim();
		expect(markdown).toBe(
			'before <mark>highlighted</mark> <span style="color: #F85149">red</span> after',
		);
	});
});
