import { describe, expect, it } from "vitest";

import type { RuntimeReviewRule } from "../../../src/core/api-contract";
import {
	buildRulesBundle,
	parseAuditFindings,
	parseExtractedRules,
	REVIEW_RULES_BUNDLE_VERSION,
	toProjectKeyFileName,
} from "../../../src/review/review-rules";
import { buildChatPrompt, formatDiffsForPrompt, formatRulesForPrompt } from "../../../src/review/review-prompts";

const VALID_RULE = {
	id: "RES-02",
	title: "Capped exponential backoff",
	category: "Resilience",
	severity: "HIGH",
	summary: "Uncapped retry loops exhaust threads.",
	antiPattern: "while True: time.sleep(2 ** n)",
	bestPractice: "if n > MAX: raise",
	sourcePath: "/repo/docs/guidelines/python.md",
	sourceAnchor: "## Retries",
};

describe("toProjectKeyFileName", () => {
	it("keeps a plain key readable", () => {
		expect(toProjectKeyFileName("akselos-dev")).toBe("akselos-dev.json");
	});

	it("neutralizes path traversal in a project key", () => {
		// A key reaches this from a user-typed path; escaping the rules directory
		// would let a review write anywhere on disk.
		expect(toProjectKeyFileName("../../etc/passwd")).toBe("etc_passwd.json");
		expect(toProjectKeyFileName("team/app")).toBe("team_app.json");
	});

	it("falls back to a default when nothing usable survives sanitizing", () => {
		expect(toProjectKeyFileName("...")).toBe("default.json");
		expect(toProjectKeyFileName("")).toBe("default.json");
	});

	it("collapses a host into a readable key", () => {
		expect(toProjectKeyFileName("code.akselos.com/repo")).toBe("code_akselos_com_repo.json");
	});
});

describe("parseExtractedRules", () => {
	it("reads a bare JSON array", () => {
		const { rules, dropped } = parseExtractedRules(JSON.stringify([VALID_RULE]));
		expect(rules).toHaveLength(1);
		expect(dropped).toBe(0);
	});

	it("reads an array inside a json code fence with surrounding prose", () => {
		const text = `Here are the rules I found.\n\n\`\`\`json\n${JSON.stringify([VALID_RULE])}\n\`\`\`\n\nHope that helps.`;
		expect(parseExtractedRules(text).rules).toHaveLength(1);
	});

	it("drops an invalid rule without losing the valid ones", () => {
		const text = JSON.stringify([VALID_RULE, { id: "X", title: "no source path" }]);
		const { rules, dropped } = parseExtractedRules(text);
		expect(rules.map((rule) => rule.id)).toEqual(["RES-02"]);
		expect(dropped).toBe(1);
	});

	it("drops a duplicate id so citations stay unambiguous", () => {
		const { rules, dropped } = parseExtractedRules(JSON.stringify([VALID_RULE, { ...VALID_RULE, title: "Other" }]));
		expect(rules).toHaveLength(1);
		expect(dropped).toBe(1);
	});

	it("rejects an unknown severity", () => {
		const { rules, dropped } = parseExtractedRules(JSON.stringify([{ ...VALID_RULE, severity: "BLOCKER" }]));
		expect(rules).toHaveLength(0);
		expect(dropped).toBe(1);
	});

	it("returns nothing for output with no array in it", () => {
		expect(parseExtractedRules("I could not read those files.")).toEqual({ rules: [], dropped: 0 });
	});
});

describe("parseAuditFindings", () => {
	it("parses findings and normalizes a missing severity to MEDIUM", () => {
		const text = JSON.stringify([
			{ newPath: "a.py", newLine: 40, ruleId: "RES-02", severity: "high", message: "Uncapped retry." },
			{ newPath: "b.py", message: "No severity given." },
		]);
		expect(parseAuditFindings(text)).toEqual([
			{ newPath: "a.py", newLine: 40, ruleId: "RES-02", severity: "HIGH", message: "Uncapped retry." },
			{ newPath: "b.py", newLine: null, ruleId: null, severity: "MEDIUM", message: "No severity given." },
		]);
	});

	it("skips a finding with no path or no message", () => {
		expect(parseAuditFindings(JSON.stringify([{ newLine: 3, message: "orphan" }, { newPath: "a.py" }]))).toEqual([]);
	});
});

describe("buildRulesBundle", () => {
	it("stamps the current bundle version", () => {
		const rules = parseExtractedRules(JSON.stringify([VALID_RULE])).rules;
		const bundle = buildRulesBundle({ projectKey: "app", sourceRoots: ["/docs"], rules });
		expect(bundle.version).toBe(REVIEW_RULES_BUNDLE_VERSION);
		expect(bundle.rules).toHaveLength(1);
	});
});

describe("prompt budgeting", () => {
	const rule = VALID_RULE as RuntimeReviewRule;

	it("notes how many rules it left out rather than silently truncating", () => {
		const many = Array.from({ length: 40 }, (_, index) => ({ ...rule, id: `R-${index}` }));
		const text = formatRulesForPrompt(many, 200);
		expect(text).toMatch(/further rules omitted for length/);
	});

	it("reports which diffs did not fit", () => {
		const files = [
			{ newPath: "small.py", diff: "@@ -1 +1 @@\n+a\n" },
			{ newPath: "huge.py", diff: "x".repeat(500) },
		];
		const { text, omittedPaths } = formatDiffsForPrompt(files, 120);
		expect(text).toContain("small.py");
		expect(omittedPaths).toEqual(["huge.py"]);
	});
});

describe("buildChatPrompt", () => {
	it("keeps the reviewer's text first so a slash command still registers", () => {
		const prompt = buildChatPrompt({
			prompt: "/understand-diff what does this touch?",
			title: "Refactor payments",
			sourceBranch: "feature/x",
			targetBranch: "main",
			changedPaths: ["a.py"],
		});
		expect(prompt.startsWith("/understand-diff what does this touch?")).toBe(true);
		expect(prompt).toContain("a.py");
	});

	it("omits the active diff section when none is given", () => {
		const prompt = buildChatPrompt({
			prompt: "explain",
			title: "t",
			sourceBranch: "s",
			targetBranch: "m",
			changedPaths: [],
		});
		expect(prompt).not.toContain("```diff");
	});
});
