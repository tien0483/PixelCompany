import { describe, expect, it } from "vitest";

import { resolveHtmlAgentCwd, resolveHtmlAllowedTools } from "../../../src/html/html-agent-args.js";

/**
 * These two decisions are what let a template read the mockup images its input
 * references. Both have to stay conservative: without an opt-in the agent must
 * end up exactly where it was before — no allowlist, no derived cwd.
 */

describe("resolveHtmlAgentCwd", () => {
	it("derives the plan's folder so relative asset paths resolve", () => {
		expect(resolveHtmlAgentCwd({ planPath: "/home/u/plans/spec.md" })).toBe("/home/u/plans");
	});

	it("prefers an explicit cwd from the caller", () => {
		expect(resolveHtmlAgentCwd({ cwd: "/work/repo", planPath: "/home/u/plans/spec.md" })).toBe("/work/repo");
	});

	it("stays undefined when the plan is unknown, keeping the previous behaviour", () => {
		expect(resolveHtmlAgentCwd({})).toBeUndefined();
		expect(resolveHtmlAgentCwd({ planPath: null })).toBeUndefined();
	});
});

describe("resolveHtmlAllowedTools", () => {
	it("grants Read and Glob only when the template asked", () => {
		expect(resolveHtmlAllowedTools(true)).toEqual(["Read", "Glob"]);
	});

	it("grants nothing otherwise", () => {
		expect(resolveHtmlAllowedTools(false)).toBeUndefined();
		expect(resolveHtmlAllowedTools(undefined)).toBeUndefined();
	});
});
