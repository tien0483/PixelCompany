import { describe, expect, it } from "vitest";

import { insertAtCursor, togglePrefix, toggleWrap } from "@/components/plan-editor/markdown-selection-commands";

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
