import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { RuntimeGitlabDiffRefs } from "../../../src/core/api-contract";
import {
	buildTextPosition,
	countPatchLines,
	resolveLinePairFromPatch,
} from "../../../src/gitlab/gitlab-position";

const DIFF_REFS: RuntimeGitlabDiffRefs = {
	baseSha: "a1b2c3d",
	startSha: "a1b2c3d",
	headSha: "e5f6a7b",
};

/** Computed the same way GitLab does, so a wrong digest fails here and not at the API. */
const SHA1_OF_PAY_PY = createHash("sha1").update("src/pay.py").digest("hex");

/**
 * A realistic MR patch: one replaced line, an added block, and trailing context.
 * The hunk header offsets are what make the old/new pairing non-trivial.
 */
const PATCH = [
	"@@ -35,6 +35,10 @@ class PaymentService:",
	" def process_charge(user_id, amount_cents):",
	"     # Fetch user account details",
	"-    gateway = StripeGateway(api_key=CONFIG.STRIPE_KEY)",
	"-    return gateway.charge(user_id, amount_cents)",
	"+    retry_count = 0",
	"+    while True:",
	"+        try:",
	"+            return gateway.charge(user_id, amount_cents)",
	"+        except GatewayTimeoutException:",
	"+            retry_count += 1",
	"     # Final fallback handler",
	"     logger.error('Payment failed completely')",
].join("\n");

describe("buildTextPosition", () => {
	it("sends only new_line for an added line", () => {
		const result = buildTextPosition({
			diffRefs: DIFF_REFS,
			position: { oldPath: "src/pay.py", newPath: "src/pay.py", oldLine: null, newLine: 40 },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.position).toEqual({
			position_type: "text",
			base_sha: "a1b2c3d",
			start_sha: "a1b2c3d",
			head_sha: "e5f6a7b",
			old_path: "src/pay.py",
			new_path: "src/pay.py",
			new_line: 40,
		});
		expect("old_line" in result.position).toBe(false);
	});

	it("sends only old_line for a removed line", () => {
		const result = buildTextPosition({
			diffRefs: DIFF_REFS,
			position: { oldPath: "src/pay.py", newPath: "src/pay.py", oldLine: 37, newLine: null },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.position.old_line).toBe(37);
		expect("new_line" in result.position).toBe(false);
	});

	it("sends both sides for an unchanged line", () => {
		const result = buildTextPosition({
			diffRefs: DIFF_REFS,
			position: { oldPath: "src/pay.py", newPath: "src/pay.py", oldLine: 39, newLine: 43 },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.position.old_line).toBe(39);
		expect(result.position.new_line).toBe(43);
	});

	it("keeps both paths distinct for a rename", () => {
		const result = buildTextPosition({
			diffRefs: DIFF_REFS,
			position: { oldPath: "src/old.py", newPath: "src/new.py", oldLine: null, newLine: 3 },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.position.old_path).toBe("src/old.py");
		expect(result.position.new_path).toBe("src/new.py");
	});

	it("falls back to the other side's path when one is missing", () => {
		const result = buildTextPosition({
			diffRefs: DIFF_REFS,
			position: { oldPath: null, newPath: "src/added.py", oldLine: null, newLine: 1 },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.position.old_path).toBe("src/added.py");
	});

	it("refuses a position with no line on either side", () => {
		const result = buildTextPosition({
			diffRefs: DIFF_REFS,
			position: { oldPath: "src/pay.py", newPath: "src/pay.py", oldLine: null, newLine: null },
		});
		expect(result).toEqual({ ok: false, error: "A diff note needs a line number." });
	});

	it("refuses an incomplete diff refs set", () => {
		const result = buildTextPosition({
			diffRefs: { baseSha: "", startSha: "a", headSha: "b" },
			position: { oldPath: "src/pay.py", newPath: "src/pay.py", oldLine: null, newLine: 40 },
		});
		expect(result.ok).toBe(false);
	});

	it("omits line_range for a single-line note", () => {
		const result = buildTextPosition({
			diffRefs: DIFF_REFS,
			position: { oldPath: "src/pay.py", newPath: "src/pay.py", oldLine: null, newLine: 40 },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect("line_range" in result.position).toBe(false);
	});

	it("builds a line_range for a dragged run of added lines", () => {
		const result = buildTextPosition({
			diffRefs: DIFF_REFS,
			position: {
				oldPath: "src/pay.py",
				newPath: "src/pay.py",
				oldLine: null,
				newLine: 42,
				lineRange: { startOldLine: null, startNewLine: 38 },
			},
		});
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		// The path SHA1 is the post-image path's, and a missing side is written as 0.
		expect(result.position.line_range).toEqual({
			start: { line_code: `${SHA1_OF_PAY_PY}_0_38`, type: "new", new_line: 38 },
			end: { line_code: `${SHA1_OF_PAY_PY}_0_42`, type: "new", new_line: 42 },
		});
		expect(result.position.new_line).toBe(42);
	});

	it("builds an old-side line_range for a dragged run of removed lines", () => {
		const result = buildTextPosition({
			diffRefs: DIFF_REFS,
			position: {
				oldPath: "src/pay.py",
				newPath: "src/pay.py",
				oldLine: 38,
				newLine: null,
				lineRange: { startOldLine: 37, startNewLine: null },
			},
		});
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.position.line_range).toEqual({
			start: { line_code: `${SHA1_OF_PAY_PY}_37_0`, type: "old", old_line: 37 },
			end: { line_code: `${SHA1_OF_PAY_PY}_38_0`, type: "old", old_line: 38 },
		});
	});

	it("keeps both line numbers on a context-line range", () => {
		const result = buildTextPosition({
			diffRefs: DIFF_REFS,
			position: {
				oldPath: "src/pay.py",
				newPath: "src/pay.py",
				oldLine: 39,
				newLine: 43,
				lineRange: { startOldLine: 36, startNewLine: 36 },
			},
		});
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.position.line_range).toEqual({
			start: { line_code: `${SHA1_OF_PAY_PY}_36_36`, type: "new", old_line: 36, new_line: 36 },
			end: { line_code: `${SHA1_OF_PAY_PY}_39_43`, type: "new", old_line: 39, new_line: 43 },
		});
	});

	it("uses the post-image path's SHA1 for a renamed file's range", () => {
		const result = buildTextPosition({
			diffRefs: DIFF_REFS,
			position: {
				oldPath: "src/old.py",
				newPath: "src/new.py",
				oldLine: null,
				newLine: 4,
				lineRange: { startOldLine: null, startNewLine: 2 },
			},
		});
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		const digest = createHash("sha1").update("src/new.py").digest("hex");
		expect(result.position.line_range?.start.line_code).toBe(`${digest}_0_2`);
	});

	it("degrades a one-line range to a plain single-line note", () => {
		const result = buildTextPosition({
			diffRefs: DIFF_REFS,
			position: {
				oldPath: "src/pay.py",
				newPath: "src/pay.py",
				oldLine: null,
				newLine: 40,
				lineRange: { startOldLine: null, startNewLine: 40 },
			},
		});
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect("line_range" in result.position).toBe(false);
	});

	it("refuses a range that spans both sides of the diff", () => {
		const result = buildTextPosition({
			diffRefs: DIFF_REFS,
			position: {
				oldPath: "src/pay.py",
				newPath: "src/pay.py",
				oldLine: null,
				newLine: 40,
				lineRange: { startOldLine: 37, startNewLine: null },
			},
		});
		expect(result).toEqual({
			ok: false,
			error: "A multi-line diff note has to stay on one side of the diff.",
		});
	});

	it("refuses a range that ends before it starts", () => {
		const result = buildTextPosition({
			diffRefs: DIFF_REFS,
			position: {
				oldPath: "src/pay.py",
				newPath: "src/pay.py",
				oldLine: null,
				newLine: 38,
				lineRange: { startOldLine: null, startNewLine: 42 },
			},
		});
		expect(result).toEqual({
			ok: false,
			error: "A multi-line diff note cannot end before it starts.",
		});
	});

	it("refuses a range with no start line", () => {
		const result = buildTextPosition({
			diffRefs: DIFF_REFS,
			position: {
				oldPath: "src/pay.py",
				newPath: "src/pay.py",
				oldLine: null,
				newLine: 38,
				lineRange: { startOldLine: null, startNewLine: null },
			},
		});
		expect(result).toEqual({ ok: false, error: "A multi-line diff note needs a start line." });
	});
});

describe("resolveLinePairFromPatch", () => {
	it("returns no old line for an added line", () => {
		expect(resolveLinePairFromPatch(PATCH, 37)).toEqual({ oldLine: null, newLine: 37 });
	});

	it("pairs an unchanged line with its pre-image line", () => {
		// New-side 36 is the second context line of the hunk: old 36, new 36.
		expect(resolveLinePairFromPatch(PATCH, 36)).toEqual({ oldLine: 36, newLine: 36 });
	});

	it("accounts for the offset that additions introduce in trailing context", () => {
		// After 2 deletions and 6 additions the trailing context sits at old 39 / new 43.
		expect(resolveLinePairFromPatch(PATCH, 43)).toEqual({ oldLine: 39, newLine: 43 });
	});

	it("returns null for a line the patch does not contain", () => {
		expect(resolveLinePairFromPatch(PATCH, 9000)).toBeNull();
		expect(resolveLinePairFromPatch("", 1)).toBeNull();
	});

	it("ignores no-newline markers", () => {
		const patch = ["@@ -1,2 +1,2 @@", "-old", "+new", "\\ No newline at end of file"].join("\n");
		expect(resolveLinePairFromPatch(patch, 1)).toEqual({ oldLine: null, newLine: 1 });
	});
});

describe("countPatchLines", () => {
	it("counts additions and deletions without the file headers", () => {
		expect(countPatchLines(PATCH)).toEqual({ additions: 6, deletions: 2 });
	});

	it("skips +++ and --- header lines", () => {
		const patch = ["--- a/x", "+++ b/x", "@@ -1 +1 @@", "-a", "+b"].join("\n");
		expect(countPatchLines(patch)).toEqual({ additions: 1, deletions: 1 });
	});
});
