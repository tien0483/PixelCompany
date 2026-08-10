import { describe, expect, it } from "vitest";

import { buildRefineDiff } from "@/components/plan-editor/plan-refine-diff";

describe("buildRefineDiff", () => {
	/** Enough prose that a hunk is genuinely cheaper than shipping the document twice. */
	const LONG_BASE = [
		"# Roadmap",
		"",
		"## Q1",
		"Ship the editor. It needs the split pane, the markdown toolbar and image paste.",
		"Autosave runs on a debounce so the file on disk always matches the pane.",
		"",
		"## Q2",
		"Ship the dashboard. Operations wants per-team throughput and a weekly rollup.",
		"",
		"## Q3",
		"Ship the reports. Finance wants the same numbers as the dashboard, exportable.",
		"",
		"## Risks",
		"The sidecar has to be running for any of the HTML passes to work at all.",
	].join("\n");

	it("returns only the changed hunk, not the whole document", () => {
		const next = LONG_BASE.replace("Finance wants", "Finance and legal want");

		const outcome = buildRefineDiff(LONG_BASE, next);

		expect(outcome.kind).toBe("diff");
		if (outcome.kind !== "diff") return;
		expect(outcome.diff).toContain("-Ship the reports. Finance wants");
		expect(outcome.diff).toContain("+Ship the reports. Finance and legal want");
		// Only the hunk plus its context travels — lines further away stay behind.
		expect(outcome.diff).not.toContain("Ship the editor.");
		expect(outcome.diff.length).toBeLessThan(LONG_BASE.length);
	});

	it("emits hunks without the filename preamble, which the agent cannot use", () => {
		const outcome = buildRefineDiff(LONG_BASE, LONG_BASE.replace("Q3", "Q4"));

		expect(outcome.kind).toBe("diff");
		if (outcome.kind !== "diff") return;
		expect(outcome.diff.startsWith("@@")).toBe(true);
		expect(outcome.diff).not.toContain("+++");
	});

	it("reports an unchanged document rather than asking the agent to do nothing", () => {
		expect(buildRefineDiff("# Roadmap\n", "# Roadmap\n")).toEqual({ kind: "unchanged" });
	});

	it("reports a trailing-whitespace-only change as unchanged", () => {
		// Line-identical: a line-oriented diff has no hunk to emit, so there is nothing to apply.
		expect(buildRefineDiff("# Roadmap\n", "# Roadmap")).toEqual({ kind: "unchanged" });
	});

	it("falls back to the full document when there is no recorded base", () => {
		expect(buildRefineDiff(null, "# Roadmap\n")).toEqual({ kind: "full", reason: "no-base" });
	});

	it("falls back to the full document when the diff is no smaller than the document", () => {
		const outcome = buildRefineDiff("alpha\nbeta\ngamma\n", "one\ntwo\nthree\n");

		expect(outcome).toEqual({ kind: "full", reason: "rewrite" });
	});
});
