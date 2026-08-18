import { describe, expect, it } from "vitest";

import type { UnifiedDiffRow } from "@/components/shared/diff-renderer";
import { isCommentableOnSplitSide, pairRowsForSplit } from "@/components/shared/split-diff-renderer";

function row(
	variant: UnifiedDiffRow["variant"],
	lineNumber: number,
	text: string,
): UnifiedDiffRow {
	return { key: `${variant}-${lineNumber}`, lineNumber, variant, text };
}

/** Compact shape for assertions: which line sits on each side of a pair. */
function shape(rows: UnifiedDiffRow[]): Array<[number | null, number | null]> {
	return pairRowsForSplit(rows).map((pair) => [
		pair.left?.lineNumber ?? null,
		pair.right?.lineNumber ?? null,
	]);
}

describe("pairRowsForSplit", () => {
	it("puts a context line on both sides", () => {
		expect(shape([row("context", 3, "same")])).toEqual([[3, 3]]);
	});

	it("leaves the left gutter blank for a pure addition", () => {
		expect(shape([row("added", 1, "a"), row("added", 2, "b")])).toEqual([
			[null, 1],
			[null, 2],
		]);
	});

	it("leaves the right gutter blank for a pure deletion", () => {
		expect(shape([row("removed", 1, "a"), row("removed", 2, "b")])).toEqual([
			[1, null],
			[2, null],
		]);
	});

	it("pairs a modification positionally", () => {
		const rows = [row("removed", 10, "old-a"), row("removed", 11, "old-b"), row("added", 10, "new-a"), row("added", 11, "new-b")];
		expect(shape(rows)).toEqual([
			[10, 10],
			[11, 11],
		]);
	});

	it("overflows the longer side when the runs are unequal", () => {
		// Two lines replaced by four: the last two additions have no counterpart.
		const rows = [
			row("removed", 37, "old-a"),
			row("removed", 38, "old-b"),
			row("added", 37, "new-a"),
			row("added", 38, "new-b"),
			row("added", 39, "new-c"),
			row("added", 40, "new-d"),
		];
		expect(shape(rows)).toEqual([
			[37, 37],
			[38, 38],
			[null, 39],
			[null, 40],
		]);
	});

	it("overflows the left side when more is removed than added", () => {
		const rows = [row("removed", 1, "a"), row("removed", 2, "b"), row("removed", 3, "c"), row("added", 1, "z")];
		expect(shape(rows)).toEqual([
			[1, 1],
			[2, null],
			[3, null],
		]);
	});

	it("does not pair a deletion with an addition separated by context", () => {
		// A rename-shaped diff: the addition belongs to a different hunk region, and
		// aligning it with the deletion would claim a modification that never happened.
		const rows = [row("removed", 1, "gone"), row("context", 2, "kept"), row("added", 3, "fresh")];
		expect(shape(rows)).toEqual([
			[1, null],
			[2, 2],
			[null, 3],
		]);
	});

	it("gives every pair a distinct key", () => {
		const rows = [
			row("removed", 1, "a"),
			row("added", 1, "b"),
			row("context", 2, "c"),
			row("added", 3, "d"),
		];
		const keys = pairRowsForSplit(rows).map((pair) => pair.key);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("returns nothing for an empty diff", () => {
		expect(pairRowsForSplit([])).toEqual([]);
	});
});

describe("isCommentableOnSplitSide", () => {
	it("only accepts a deletion comment on the left", () => {
		const removed = row("removed", 1, "a");
		expect(isCommentableOnSplitSide(removed, "left")).toBe(true);
		expect(isCommentableOnSplitSide(removed, "right")).toBe(false);
	});

	it("only accepts an addition comment on the right", () => {
		const added = row("added", 1, "a");
		expect(isCommentableOnSplitSide(added, "right")).toBe(true);
		expect(isCommentableOnSplitSide(added, "left")).toBe(false);
	});

	it("anchors an unchanged line's comment to the post-image side", () => {
		const context = row("context", 1, "a");
		expect(isCommentableOnSplitSide(context, "right")).toBe(true);
		expect(isCommentableOnSplitSide(context, "left")).toBe(false);
	});
});
