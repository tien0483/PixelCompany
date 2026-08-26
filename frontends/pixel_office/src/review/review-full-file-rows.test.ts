import { describe, expect, it } from "vitest";

import { buildFullFileRows, splitFileContent } from "@/review/review-full-file-rows";

/**
 * `charlie-old` became `charlie`, and `hotel` was inserted — two hunks with a gap
 * before, between and after them, which is what exercises the reconstruction.
 */
const PATCH = [
	"@@ -2,3 +2,3 @@",
	" bravo",
	"-charlie-old",
	"+charlie",
	" delta",
	"@@ -7,2 +7,3 @@",
	" golf",
	"+hotel",
	" india",
	"",
].join("\n");

const CONTENT = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"].join(
	"\n",
);

describe("splitFileContent", () => {
	it("drops the terminating newline instead of yielding an empty last line", () => {
		expect(splitFileContent("a\nb\n")).toEqual(["a", "b"]);
	});

	it("keeps a file that does not end in a newline intact", () => {
		expect(splitFileContent("a\nb")).toEqual(["a", "b"]);
	});

	it("keeps a genuinely blank last line, which carries its own newline", () => {
		expect(splitFileContent("a\n\n")).toEqual(["a", ""]);
	});
});

describe("buildFullFileRows", () => {
	it("covers every line of the file plus the patch's removed lines", () => {
		const rows = buildFullFileRows({ patch: PATCH, content: `${CONTENT}\n` });
		expect(rows).not.toBeNull();
		// 10 post-image lines, plus the one removed row that has no post-image line.
		expect(rows).toHaveLength(11);
		expect(rows?.filter((row) => row.variant === "removed").map((row) => row.text)).toEqual(["charlie-old"]);
		expect(rows?.filter((row) => row.variant === "added").map((row) => row.text)).toEqual(["charlie", "hotel"]);
	});

	it("renders the post-image in order, so line numbers match the text", () => {
		const rows = buildFullFileRows({ patch: PATCH, content: `${CONTENT}\n` }) ?? [];
		const fileLines = CONTENT.split("\n");
		for (const row of rows) {
			if (row.variant === "removed" || row.lineNumber == null) {
				continue;
			}
			expect(row.text).toBe(fileLines[row.lineNumber - 1]);
		}
		expect(rows.at(-1)?.text).toBe("juliet");
	});

	it("pairs each unchanged line with its pre-image number, inside and outside hunks", () => {
		const rows = buildFullFileRows({ patch: PATCH, content: `${CONTENT}\n` }) ?? [];
		const oldByNew = new Map(
			rows
				.filter((row) => row.variant === "context" && row.lineNumber != null)
				.map((row) => [row.lineNumber, row.oldLineNumber]),
		);
		// Before the first hunk and between the hunks nothing has shifted yet.
		expect(oldByNew.get(1)).toBe(1);
		expect(oldByNew.get(5)).toBe(5);
		expect(oldByNew.get(6)).toBe(6);
		// After the insertion the post-image runs one line ahead of the pre-image.
		expect(oldByNew.get(10)).toBe(9);
	});

	it("gives synthesized gap rows keys the patch parser never mints", () => {
		const rows = buildFullFileRows({ patch: PATCH, content: `${CONTENT}\n` }) ?? [];
		expect(rows.find((row) => row.lineNumber === 1)?.key).toBe("f-1");
		expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
	});

	it("handles a file with no trailing newline the same way", () => {
		const withNewline = buildFullFileRows({ patch: PATCH, content: `${CONTENT}\n` });
		const withoutNewline = buildFullFileRows({ patch: PATCH, content: CONTENT });
		expect(withoutNewline).toEqual(withNewline);
	});

	it("handles a hunk that starts at the first line, with no gap before it", () => {
		const patch = ["@@ -1,2 +1,2 @@", "-one-old", "+one", " two", ""].join("\n");
		const rows = buildFullFileRows({ patch, content: "one\ntwo\nthree\n" }) ?? [];
		expect(rows.map((row) => [row.variant, row.text])).toEqual([
			["removed", "one-old"],
			["added", "one"],
			["context", "two"],
			["context", "three"],
		]);
		expect(rows.at(-1)?.lineNumber).toBe(3);
	});

	it("renders the whole file as context when the patch carries no hunks", () => {
		const rows = buildFullFileRows({ patch: "", content: "one\ntwo\n" }) ?? [];
		expect(rows).toEqual([
			{ key: "f-1", lineNumber: 1, oldLineNumber: 1, variant: "context", text: "one" },
			{ key: "f-2", lineNumber: 2, oldLineNumber: 2, variant: "context", text: "two" },
		]);
	});

	it("refuses to splice content that disagrees with the patch", () => {
		// The reviewer's diff says line 3 is `charlie`; this file says otherwise, so the
		// two are different revisions and every line number below the change is a guess.
		const drifted = CONTENT.replace("charlie", "charlie-rewritten");
		expect(buildFullFileRows({ patch: PATCH, content: drifted })).toBeNull();
	});

	it("refuses when the file is shorter than the patch claims", () => {
		expect(buildFullFileRows({ patch: PATCH, content: "alpha\n" })).toBeNull();
	});
});
