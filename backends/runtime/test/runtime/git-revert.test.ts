import { describe, expect, it } from "vitest";

import { extractSingleHunkPatch } from "../../src/workspace/git-sync.js";

const TWO_HUNK_DIFF = `diff --git a/foo.txt b/foo.txt
index 1111111..2222222 100644
--- a/foo.txt
+++ b/foo.txt
@@ -1,3 +1,3 @@
 line1
-line2
+LINE2
 line3
@@ -10,3 +10,3 @@
 line10
-line11
+LINE11
 line12
`;

describe("extractSingleHunkPatch", () => {
	it("returns the header plus only the first hunk", () => {
		const patch = extractSingleHunkPatch(TWO_HUNK_DIFF, 0);
		expect(patch).toContain("diff --git a/foo.txt b/foo.txt");
		expect(patch).toContain("@@ -1,3 +1,3 @@");
		expect(patch).toContain("+LINE2");
		expect(patch).not.toContain("+LINE11");
	});

	it("returns the header plus only the second hunk", () => {
		const patch = extractSingleHunkPatch(TWO_HUNK_DIFF, 1);
		expect(patch).toContain("@@ -10,3 +10,3 @@");
		expect(patch).toContain("+LINE11");
		expect(patch).not.toContain("+LINE2");
	});

	it("returns null for an out-of-range hunk index", () => {
		expect(extractSingleHunkPatch(TWO_HUNK_DIFF, 2)).toBeNull();
	});

	it("returns null when the diff has no hunks", () => {
		expect(extractSingleHunkPatch("diff --git a/foo b/foo\n", 0)).toBeNull();
	});
});
