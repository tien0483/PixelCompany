import { describe, expect, it } from "vitest";

import {
	insertAtCursor,
	insertBlock,
	togglePrefix,
	toggleWrap,
} from "@/components/plan-editor/markdown-selection-commands";
import { MARKDOWN_SNIPPET_GROUPS } from "@/components/plan-editor/markdown-snippets";

describe("toggleWrap", () => {
	it("wraps a selection", () => {
		const result = toggleWrap({ value: "hello world", selectionStart: 0, selectionEnd: 5 }, "**");
		expect(result.value).toBe("**hello** world");
		expect(result.selectionStart).toBe(2);
		expect(result.selectionEnd).toBe(7);
	});

	it("unwraps an already-wrapped selection", () => {
		const result = toggleWrap({ value: "**hello** world", selectionStart: 2, selectionEnd: 7 }, "**");
		expect(result.value).toBe("hello world");
		expect(result.selectionStart).toBe(0);
		expect(result.selectionEnd).toBe(5);
	});

	it("inserts an empty pair with the cursor between them when nothing is selected", () => {
		const result = toggleWrap({ value: "hello", selectionStart: 5, selectionEnd: 5 }, "**");
		expect(result.value).toBe("hello****");
		expect(result.selectionStart).toBe(7);
		expect(result.selectionEnd).toBe(7);
	});

	it("supports distinct prefix/suffix pairs", () => {
		const result = toggleWrap({ value: "risk item", selectionStart: 0, selectionEnd: 4 }, "<mark>", "</mark>");
		expect(result.value).toBe("<mark>risk</mark> item");
	});

	it("round-trips wrap then unwrap", () => {
		const wrapped = toggleWrap({ value: "hello", selectionStart: 0, selectionEnd: 5 }, "*");
		const unwrapped = toggleWrap(wrapped, "*");
		expect(unwrapped.value).toBe("hello");
	});
});

describe("togglePrefix", () => {
	it("adds a marker to a single line", () => {
		const result = togglePrefix({ value: "Goals", selectionStart: 0, selectionEnd: 0 }, "## ");
		expect(result.value).toBe("## Goals");
	});

	it("removes the marker when already present", () => {
		const result = togglePrefix({ value: "## Goals", selectionStart: 3, selectionEnd: 3 }, "## ");
		expect(result.value).toBe("Goals");
	});

	it("applies the marker to every line touched by a multiline selection", () => {
		const value = "first\nsecond\nthird";
		const result = togglePrefix({ value, selectionStart: 0, selectionEnd: value.length }, "- ");
		expect(result.value).toBe("- first\n- second\n- third");
	});

	it("treats the block as prefixed only when every line has the marker", () => {
		const value = "- first\nsecond";
		const result = togglePrefix({ value, selectionStart: 0, selectionEnd: value.length }, "- ");
		expect(result.value).toBe("- first\n- second");
	});
});

describe("insertAtCursor", () => {
	it("replaces the selection and places the cursor after the inserted text", () => {
		const result = insertAtCursor({ value: "see  here", selectionStart: 4, selectionEnd: 4 }, "![img](a.png)");
		expect(result.value).toBe("see ![img](a.png) here");
		expect(result.selectionStart).toBe(result.selectionEnd);
		expect(result.selectionStart).toBe(4 + "![img](a.png)".length);
	});

	it("overwrites a non-empty selection", () => {
		const result = insertAtCursor({ value: "hello world", selectionStart: 6, selectionEnd: 11 }, "there");
		expect(result.value).toBe("hello there");
	});
});

describe("insertBlock", () => {
	const BLOCK = "| A | B |\n| - | - |\n";

	it("inserts verbatim into an empty document", () => {
		const result = insertBlock({ value: "", selectionStart: 0, selectionEnd: 0 }, BLOCK);
		expect(result.value).toBe(BLOCK);
	});

	it("starts the block on a fresh paragraph when the cursor sits mid-line", () => {
		const result = insertBlock({ value: "Intro text", selectionStart: 10, selectionEnd: 10 }, BLOCK);
		expect(result.value).toBe(`Intro text\n\n${BLOCK}`);
	});

	it("adds only the missing newline after a single line break", () => {
		const result = insertBlock({ value: "Intro\n", selectionStart: 6, selectionEnd: 6 }, BLOCK);
		expect(result.value).toBe(`Intro\n\n${BLOCK}`);
	});

	it("never stacks a third blank line on an existing paragraph boundary", () => {
		const result = insertBlock({ value: "Intro\n\n", selectionStart: 7, selectionEnd: 7 }, BLOCK);
		expect(result.value).toBe(`Intro\n\n${BLOCK}`);
	});

	it("keeps a blank line between the block and following text", () => {
		const result = insertBlock({ value: "Intro\n\nOutro", selectionStart: 7, selectionEnd: 7 }, BLOCK);
		expect(result.value).toBe(`Intro\n\n${BLOCK}\nOutro`);
	});

	it("does not double the separator when the tail already starts with a break", () => {
		const result = insertBlock({ value: "Intro\n\n\nOutro", selectionStart: 7, selectionEnd: 7 }, BLOCK);
		expect(result.value).toBe(`Intro\n\n${BLOCK}\nOutro`);
	});

	it("terminates a block that has no trailing newline", () => {
		const result = insertBlock({ value: "", selectionStart: 0, selectionEnd: 0 }, "> Quote");
		expect(result.value).toBe("> Quote\n");
	});

	it("collapses the cursor after the inserted block", () => {
		const result = insertBlock({ value: "Intro", selectionStart: 5, selectionEnd: 5 }, BLOCK);
		expect(result.selectionStart).toBe(result.selectionEnd);
		expect(result.selectionStart).toBe(result.value.length);
	});

	it("replaces a selection rather than wrapping it", () => {
		const result = insertBlock({ value: "keep drop", selectionStart: 5, selectionEnd: 9 }, "> Quote\n");
		expect(result.value).toBe("keep \n\n> Quote\n");
	});
});

describe("MARKDOWN_SNIPPET_GROUPS", () => {
	const snippets = MARKDOWN_SNIPPET_GROUPS.flatMap((group) => group.snippets);

	it("exposes unique snippet ids", () => {
		const ids = snippets.map((snippet) => snippet.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("ships every snippet newline-terminated and short enough to read in the menu", () => {
		for (const snippet of snippets) {
			expect(snippet.content.endsWith("\n"), snippet.id).toBe(true);
			expect(snippet.content.trimEnd().split("\n").length, snippet.id).toBeLessThanOrEqual(8);
		}
	});

	it("keeps the table snippet a valid GFM table once inserted", () => {
		const table = snippets.find((snippet) => snippet.id === "table");
		expect(table).toBeDefined();
		const lines = insertBlock({ value: "", selectionStart: 0, selectionEnd: 0 }, (table as { content: string }).content)
			.value.trimEnd()
			.split("\n");
		expect(lines[0]).toMatch(/^\|.*\|$/);
		expect(lines[1]).toMatch(/^\|[\s-]+\|[\s-]+\|[\s-]+\|$/);
		expect(lines.length).toBe(4);
	});

	it("fences the csv and tsv snippets so the preview does not eat the rows", () => {
		for (const id of ["csv", "tsv"]) {
			const snippet = snippets.find((candidate) => candidate.id === id);
			expect(snippet, id).toBeDefined();
			expect((snippet as { content: string }).content.startsWith(`\`\`\`${id}\n`), id).toBe(true);
			expect((snippet as { content: string }).content.trimEnd().endsWith("```"), id).toBe(true);
		}
	});
});
