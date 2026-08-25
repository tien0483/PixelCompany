import { describe, expect, it } from "vitest";

import { selectNextUnreviewedPath, selectPreviousUnreviewedPath } from "@/review/review-target";
import type { RuntimeGitlabDiffFile } from "@/runtime/types";

function file(newPath: string): RuntimeGitlabDiffFile {
	return {
		oldPath: newPath,
		newPath,
		newFile: false,
		renamedFile: false,
		deletedFile: false,
		diff: "@@ -1 +1 @@\n-a\n+b\n",
		binary: false,
		additions: 1,
		deletions: 1,
		tooLarge: false,
	};
}

const FILES = [file("a.ts"), file("b.ts"), file("c.ts")];

describe("selectNextUnreviewedPath", () => {
	it("returns the next file after the active one", () => {
		expect(
			selectNextUnreviewedPath({ files: FILES, reviewedPaths: [], activePath: "a.ts" }),
		).toBe("b.ts");
	});

	it("skips files already marked reviewed", () => {
		expect(
			selectNextUnreviewedPath({ files: FILES, reviewedPaths: ["b.ts"], activePath: "a.ts" }),
		).toBe("c.ts");
	});

	it("wraps around to an unreviewed file above the active one", () => {
		expect(
			selectNextUnreviewedPath({ files: FILES, reviewedPaths: ["a.ts"], activePath: "c.ts" }),
		).toBe("b.ts");
	});

	it("returns null when every other file is reviewed", () => {
		expect(
			selectNextUnreviewedPath({
				files: FILES,
				reviewedPaths: ["a.ts", "b.ts", "c.ts"],
				activePath: "b.ts",
			}),
		).toBeNull();
	});

	it("never returns the active file, even when it is the only unreviewed one", () => {
		expect(
			selectNextUnreviewedPath({
				files: FILES,
				reviewedPaths: ["a.ts", "c.ts"],
				activePath: "b.ts",
			}),
		).toBeNull();
	});

	it("starts from the top when the active path is unknown", () => {
		expect(
			selectNextUnreviewedPath({ files: FILES, reviewedPaths: [], activePath: null }),
		).toBe("a.ts");
		expect(
			selectNextUnreviewedPath({ files: FILES, reviewedPaths: [], activePath: "gone.ts" }),
		).toBe("a.ts");
	});

	it("returns null for an empty changeset", () => {
		expect(selectNextUnreviewedPath({ files: [], reviewedPaths: [], activePath: null })).toBeNull();
	});
});

describe("selectPreviousUnreviewedPath", () => {
	it("returns the file before the active one", () => {
		expect(selectPreviousUnreviewedPath({ files: FILES, reviewedPaths: [], activePath: "c.ts" })).toBe(
			"b.ts",
		);
	});

	it("skips files already marked reviewed", () => {
		expect(
			selectPreviousUnreviewedPath({ files: FILES, reviewedPaths: ["b.ts"], activePath: "c.ts" }),
		).toBe("a.ts");
	});

	it("wraps around to an unreviewed file below the active one", () => {
		expect(
			selectPreviousUnreviewedPath({ files: FILES, reviewedPaths: ["b.ts"], activePath: "a.ts" }),
		).toBe("c.ts");
	});

	it("returns null when every other file is reviewed", () => {
		expect(
			selectPreviousUnreviewedPath({
				files: FILES,
				reviewedPaths: ["a.ts", "b.ts", "c.ts"],
				activePath: "b.ts",
			}),
		).toBeNull();
	});

	it("starts from the bottom when the active path is unknown", () => {
		expect(selectPreviousUnreviewedPath({ files: FILES, reviewedPaths: [], activePath: null })).toBe(
			"c.ts",
		);
		expect(
			selectPreviousUnreviewedPath({ files: FILES, reviewedPaths: [], activePath: "gone.ts" }),
		).toBe("c.ts");
	});

	it("returns null for a single-file changeset", () => {
		expect(
			selectPreviousUnreviewedPath({ files: [file("only.ts")], reviewedPaths: [], activePath: "only.ts" }),
		).toBeNull();
	});

	it("returns null for an empty changeset", () => {
		expect(selectPreviousUnreviewedPath({ files: [], reviewedPaths: [], activePath: null })).toBeNull();
	});
});
