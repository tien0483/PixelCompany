import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RuntimeReviewRule } from "../../../src/core/api-contract";
import {
	buildChatPrompt,
	buildSuggestionRewritePrompt,
	formatDiffsForPrompt,
	formatRulesForPrompt,
	REVIEW_CHAT_SYSTEM_PROMPT,
} from "../../../src/review/review-prompts";
import {
	buildRulesBundle,
	getReviewRulesPath,
	parseAuditFindings,
	parseExtractedRules,
	persistExtractedRules,
	REVIEW_RULES_BUNDLE_VERSION,
	toProjectKeyFileName,
} from "../../../src/review/review-rules";

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

describe("persistExtractedRules", () => {
	let agentDataRoot: string;
	let previousOverride: string | undefined;

	beforeEach(() => {
		// `PIXELOFFICE_AGENT_DATA` points at an `agent-data/` directory that must hold a
		// manifest for the walk to accept it; the content is never read here.
		const tmp = mkdtempSync(join(tmpdir(), "review-rules-"));
		agentDataRoot = join(tmp, "agent-data");
		mkdirSync(agentDataRoot, { recursive: true });
		writeFileSync(join(agentDataRoot, "manifest.json"), '{"version":1,"sources":[]}', "utf-8");
		previousOverride = process.env.PIXELOFFICE_AGENT_DATA;
		process.env.PIXELOFFICE_AGENT_DATA = agentDataRoot;
	});

	afterEach(() => {
		if (previousOverride === undefined) {
			delete process.env.PIXELOFFICE_AGENT_DATA;
		} else {
			process.env.PIXELOFFICE_AGENT_DATA = previousOverride;
		}
		rmSync(join(agentDataRoot, ".."), { recursive: true, force: true });
	});

	it("writes the bundle the audit reads back", async () => {
		const result = await persistExtractedRules({
			projectKey: "team/app",
			sourceRoots: ["/repo/docs"],
			text: JSON.stringify([VALID_RULE]),
		});
		expect(result).toEqual({ saved: 1, dropped: 0 });

		const written: unknown = JSON.parse(await readFile(getReviewRulesPath("team/app"), "utf-8"));
		expect(written).toMatchObject({
			version: REVIEW_RULES_BUNDLE_VERSION,
			projectKey: "team/app",
			sourceRoots: ["/repo/docs"],
		});
		expect((written as { rules: RuntimeReviewRule[] }).rules.map((rule) => rule.id)).toEqual(["RES-02"]);
	});

	it("leaves an existing bundle alone when the agent answered in prose", async () => {
		await persistExtractedRules({
			projectKey: "app",
			sourceRoots: ["/repo/docs"],
			text: JSON.stringify([VALID_RULE]),
		});
		const result = await persistExtractedRules({
			projectKey: "app",
			sourceRoots: ["/repo/docs"],
			text: "I could not read those files.",
		});

		// A zero-rule write would disarm every later audit under a bundle that claims
		// the project has no rules.
		expect(result).toEqual({ saved: 0, dropped: 0 });
		const written: unknown = JSON.parse(await readFile(getReviewRulesPath("app"), "utf-8"));
		expect((written as { rules: RuntimeReviewRule[] }).rules).toHaveLength(1);
	});

	it("still reports the rules it dropped alongside the ones it kept", async () => {
		const result = await persistExtractedRules({
			projectKey: "app",
			sourceRoots: [],
			text: JSON.stringify([VALID_RULE, { id: "X", title: "no source path" }]),
		});
		expect(result).toEqual({ saved: 1, dropped: 1 });
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
	it("keeps a pass-through command first so it still registers as a slash command", () => {
		const prompt = buildChatPrompt({
			prompt: "/simplify this helper",
			title: "Refactor payments",
			sourceBranch: "feature/x",
			targetBranch: "main",
			changedPaths: ["a.py"],
			isFirstTurn: true,
		});
		expect(prompt.startsWith("/simplify this helper")).toBe(true);
		expect(prompt).toContain("a.py");
	});

	it("expands the built-in review commands instead of leaving them to the CLI", () => {
		// `/understand-diff` is not installed in the reviewed checkout, and the other two
		// resolve against a working tree that does not have this branch — so a prompt
		// that still starts with a slash is the bug, not the feature.
		for (const command of ["/understand-diff", "/security-review", "/code-review"]) {
			const prompt = buildChatPrompt({
				prompt: `${command} focus on the parser`,
				title: "Refactor payments",
				sourceBranch: "feature/x",
				targetBranch: "main",
				changedPaths: ["a.py"],
				isFirstTurn: true,
			});
			expect(prompt.startsWith("/")).toBe(false);
			expect(prompt).toContain("focus on the parser");
			expect(prompt).toContain("NOT checked out");
		}
	});

	it("sends every patch for a whole-merge-request command, and drops the selection", () => {
		const prompt = buildChatPrompt({
			prompt: "/code-review-diff",
			title: "Refactor payments",
			sourceBranch: "feature/x",
			targetBranch: "main",
			changedPaths: ["a.py", "b.py"],
			activeDiff: "@@ -1 +1 @@\n+active file only\n",
			allDiffs: [
				{ newPath: "a.py", diff: "@@ -1 +1 @@\n+first patch\n" },
				{ newPath: "b.py", diff: "@@ -1 +1 @@\n+second patch\n" },
			],
			rules: [VALID_RULE as RuntimeReviewRule],
			screen: { path: "a.py", side: "new", startLine: 4, endLine: 9, text: "twenty lines" },
			isFirstTurn: true,
		});
		expect(prompt).toContain("first patch");
		expect(prompt).toContain("second patch");
		expect(prompt).toContain("## Team rules");
		expect(prompt).toContain(VALID_RULE.id);
		// Pointing a whole-merge-request pass at one selection is how it quietly becomes
		// a review of one hunk.
		expect(prompt).not.toContain("twenty lines");
		expect(prompt).not.toContain("active file only");
	});

	it("keeps a screen-scoped command on the selection even when every patch is offered", () => {
		const prompt = buildChatPrompt({
			prompt: "/code-review",
			title: "t",
			sourceBranch: "s",
			targetBranch: "m",
			changedPaths: ["a.py"],
			allDiffs: [{ newPath: "b.py", diff: "@@ -1 +1 @@\n+other file\n" }],
			screen: { path: "a.py", side: "new", startLine: 4, endLine: 9, text: "these lines" },
			isFirstTurn: true,
		});
		expect(prompt).toContain("these lines");
		expect(prompt).not.toContain("other file");
	});

	it("omits the active diff section when none is given", () => {
		const prompt = buildChatPrompt({
			prompt: "explain",
			title: "t",
			sourceBranch: "s",
			targetBranch: "m",
			changedPaths: [],
			isFirstTurn: true,
		});
		expect(prompt).not.toContain("```diff");
	});

	it("sends the merge-request context only on the first turn", () => {
		const args = {
			prompt: "hello",
			title: "Refactor payments",
			sourceBranch: "feature/x",
			targetBranch: "main",
			changedPaths: ["a.py"],
			activeDiff: "@@ -1 +1 @@\n+a\n",
		};
		const first = buildChatPrompt({ ...args, isFirstTurn: true });
		expect(first).toContain("Refactor payments");
		expect(first).toContain("```diff");

		// The whole point of the resumed path: a follow-up costs the message, not the
		// diff. Re-sending it per turn is what made a greeting read as "review this".
		const resumed = buildChatPrompt({ ...args, isFirstTurn: false });
		expect(resumed).toBe("hello");
	});

	it("prefers the reviewer's selection over the whole active file", () => {
		const prompt = buildChatPrompt({
			prompt: "what does this do?",
			title: "t",
			sourceBranch: "s",
			targetBranch: "m",
			changedPaths: ["a.py"],
			activeDiff: "@@ -1 +1 @@\n+whole file\n",
			screen: {
				path: "a.py",
				side: "new",
				startLine: 40,
				endLine: 60,
				text: "selected lines",
			},
			isFirstTurn: true,
		});
		expect(prompt).toContain("a.py:40-60");
		expect(prompt).toContain("selected lines");
		// Sending both would waste the budget the selection exists to save.
		expect(prompt).not.toContain("whole file");
	});

	it("carries the selection on a resumed turn, without the merge-request context", () => {
		const prompt = buildChatPrompt({
			prompt: "and this one?",
			title: "Refactor payments",
			sourceBranch: "s",
			targetBranch: "m",
			changedPaths: ["a.py"],
			screen: { path: "a.py", side: "new", startLine: 7, endLine: 7, text: "one line" },
			isFirstTurn: false,
		});
		expect(prompt.startsWith("and this one?")).toBe(true);
		expect(prompt).toContain("a.py:7");
		expect(prompt).not.toContain("Refactor payments");
	});

	it("falls back to the scrolled-to range when nothing is selected", () => {
		const prompt = buildChatPrompt({
			prompt: "explain",
			title: "t",
			sourceBranch: "s",
			targetBranch: "m",
			changedPaths: [],
			visible: { path: "a.py", startLine: 10, endLine: 30 },
			isFirstTurn: false,
		});
		expect(prompt).toContain("a.py:10-30");
	});

	it("asks for the suggestions block only when the caller expects it", () => {
		const base = {
			prompt: "/code-review",
			title: "t",
			sourceBranch: "s",
			targetBranch: "m",
			changedPaths: [],
			isFirstTurn: true,
		};
		expect(buildChatPrompt({ ...base, expectSuggestions: true })).toContain("```suggestions");
		expect(buildChatPrompt(base)).not.toContain("```suggestions");
	});
});

describe("REVIEW_CHAT_SYSTEM_PROMPT", () => {
	it("tells the agent to stay an assistant rather than review unprompted", () => {
		// The regression this whole change exists to prevent: `hello` producing a review.
		expect(REVIEW_CHAT_SYSTEM_PROMPT).toContain("Never volunteer findings");
		expect(REVIEW_CHAT_SYSTEM_PROMPT).toContain("Never produce a review unless you were asked");
	});
});

describe("buildSuggestionRewritePrompt", () => {
	it("anchors the rewrite to the file and line, and forbids a preamble", () => {
		const prompt = buildSuggestionRewritePrompt({
			rawText: "this could overflow if count is negative",
			newPath: "src/buf.ts",
			line: 46,
		});
		expect(prompt).toContain("src/buf.ts:46");
		expect(prompt).toContain("this could overflow if count is negative");
		expect(prompt).toContain("Output the comment text and nothing else");
	});
});
