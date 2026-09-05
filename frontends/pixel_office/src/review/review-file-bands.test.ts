import { describe, expect, it } from "vitest";

import { buildFileBands } from "@/review/review-file-bands";
import type { RuntimeGitlabDiffFile } from "@/runtime/types";

function file(path: string, additions: number, deletions: number): RuntimeGitlabDiffFile {
	return {
		oldPath: path,
		newPath: path,
		newFile: false,
		renamedFile: false,
		deletedFile: false,
		diff: "",
		binary: false,
		additions,
		deletions,
		tooLarge: false,
	};
}

const EMPTY_INPUT = {
	activePath: null,
	reviewedPaths: [],
	draftCountByPath: new Map<string, number>(),
	newCommentPaths: new Set<string>(),
};

function sum(fractions: number[]): number {
	return fractions.reduce((total, fraction) => total + fraction, 0);
}

describe("buildFileBands", () => {
	it("sizes a band by how much the file changed", () => {
		const bands = buildFileBands({
			...EMPTY_INPUT,
			files: [file("a.ts", 30, 0), file("b.ts", 10, 0)],
		});

		expect(bands.map((band) => band.path)).toEqual(["a.ts", "b.ts"]);
		expect(bands[0]?.fraction).toBeCloseTo(0.75);
		expect(bands[1]?.fraction).toBeCloseTo(0.25);
	});

	it("keeps a one-line file clickable beside a huge one, without overflowing the strip", () => {
		const bands = buildFileBands({
			...EMPTY_INPUT,
			files: [file("huge.ts", 5000, 0), file("tiny.ts", 1, 0)],
			minFraction: 0.05,
		});

		expect(bands[1]?.fraction).toBeCloseTo(0.05);
		expect(sum(bands.map((band) => band.fraction))).toBeCloseTo(1);
	});

	it("gives a binary or truncated file a band anyway", () => {
		const bands = buildFileBands({ ...EMPTY_INPUT, files: [file("image.png", 0, 0), file("a.ts", 3, 0)] });

		expect(bands[0]?.fraction).toBeGreaterThan(0);
		expect(sum(bands.map((band) => band.fraction))).toBeCloseTo(1);
	});

	it("falls back to even bands when the floor alone fills the strip", () => {
		const bands = buildFileBands({
			...EMPTY_INPUT,
			files: [file("a.ts", 100, 0), file("b.ts", 1, 0), file("c.ts", 1, 0)],
			minFraction: 1,
		});

		for (const band of bands) {
			expect(band.fraction).toBeCloseTo(1 / 3);
		}
	});

	it("marks the active file, reviewed files, and files still wanting attention", () => {
		const bands = buildFileBands({
			files: [file("a.ts", 5, 0), file("b.ts", 5, 0), file("c.ts", 5, 0)],
			activePath: "a.ts",
			reviewedPaths: ["b.ts"],
			draftCountByPath: new Map([["c.ts", 2]]),
			newCommentPaths: new Set(["b.ts"]),
		});

		expect(bands[0]).toMatchObject({ isActive: true, isReviewed: false, hasAttention: false });
		expect(bands[1]).toMatchObject({ isActive: false, isReviewed: true, hasAttention: true });
		expect(bands[2]).toMatchObject({ isActive: false, isReviewed: false, hasAttention: true });
	});

	it("labels a band with its path and line counts", () => {
		const bands = buildFileBands({ ...EMPTY_INPUT, files: [file("src/a.ts", 12, 4)] });

		expect(bands[0]?.label).toBe("src/a.ts (+12 −4)");
	});

	it("returns nothing for an empty merge request", () => {
		expect(buildFileBands({ ...EMPTY_INPUT, files: [] })).toEqual([]);
	});
});
