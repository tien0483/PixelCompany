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
});
