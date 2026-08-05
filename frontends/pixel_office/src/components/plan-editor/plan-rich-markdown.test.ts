import { describe, expect, it } from "vitest";

import {
	fromEditorMarkdown,
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
		const input = "See ![shot](/api/plans/asset?planId=plan-1&path=diagram.png)";
		expect(fromEditorMarkdown(input, "plan-1")).toBe("See ![shot](diagram.png)");
	});
});
