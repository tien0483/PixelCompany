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
