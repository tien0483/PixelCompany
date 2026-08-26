import { describe, expect, it } from "vitest";

import {
	expandReviewCommand,
	isExpandedReviewCommand,
	REVIEW_CODE_REVIEW_DIFF_COMMAND,
	REVIEW_UNDERSTAND_CHANGES_COMMAND,
	reviewCommandNeedsGraphImpact,
	reviewCommandNeedsRules,
	reviewCommandScope,
} from "../../../src/review/review-command-expansion";

const WITH_GRAPH = { hasGraphImpact: true, hasRules: true } as const;
const NO_GRAPH = { hasGraphImpact: false, hasRules: true } as const;
const NO_RULES = { hasGraphImpact: true, hasRules: false } as const;

const ALL_EXPANDED = [
	REVIEW_UNDERSTAND_CHANGES_COMMAND,
	REVIEW_CODE_REVIEW_DIFF_COMMAND,
	"/understand-diff",
	"/security-review",
	"/code-review",
];

describe("expandReviewCommand", () => {
	it("leaves a question, a pass-through command and a project command alone", () => {
		// `/simplify` works as a real skill and already honours the selection; a project's
		// own command was written for that repository and the CLI can expand it there.
		for (const prompt of ["what does this do?", "/simplify", "/simplify this helper", "/review", "/mr-summary"]) {
			expect(expandReviewCommand(prompt, WITH_GRAPH)).toBeNull();
			expect(isExpandedReviewCommand(prompt)).toBe(false);
			expect(reviewCommandScope(prompt)).toBeNull();
		}
	});

	it("expands every review command into something with no leading slash", () => {
		for (const command of ALL_EXPANDED) {
			const expansion = expandReviewCommand(command, WITH_GRAPH);
			expect(expansion?.command).toBe(command);
			// A leading slash is the entire bug: the CLI would try to expand it against a
			// checkout that either lacks the command or lacks this branch.
			expect(expansion?.text.startsWith("/")).toBe(false);
			expect(expansion?.text).toContain("NOT checked out");
		}
	});

	it("matches only whole commands, so the longer name is never swallowed", () => {
		expect(expandReviewCommand("  /code-review", WITH_GRAPH)?.command).toBe("/code-review");
		// `/code-review` is a prefix of `/code-review-diff` in text but not as a command.
		expect(expandReviewCommand("/code-review-diff", WITH_GRAPH)?.command).toBe(REVIEW_CODE_REVIEW_DIFF_COMMAND);
		expect(expandReviewCommand("/code-reviewer", WITH_GRAPH)).toBeNull();
	});

	it("appends the reviewer's own words and gives them priority", () => {
		const expansion = expandReviewCommand("/security-review just the deserialization path", WITH_GRAPH);
		expect(expansion?.text).toContain("just the deserialization path");
		expect(expansion?.text).toMatch(/narrows the request above/);
	});

	it("keeps /understand-diff working as an alias of the button", () => {
		// The chip is gone, but a reviewer who types it from memory must not get
		// `Unknown command` again — and it must not be a second, narrower scope.
		const alias = expandReviewCommand("/understand-diff", WITH_GRAPH);
		const button = expandReviewCommand(REVIEW_UNDERSTAND_CHANGES_COMMAND, WITH_GRAPH);
		expect(alias?.text).toBe(button?.text);
		expect(alias?.scope).toBe("merge-request");
	});
});

describe("scope", () => {
	it("sends the two buttons and the security pass over the whole merge request", () => {
		for (const command of [
			REVIEW_UNDERSTAND_CHANGES_COMMAND,
			REVIEW_CODE_REVIEW_DIFF_COMMAND,
			"/understand-diff",
			"/security-review",
		]) {
			expect(reviewCommandScope(command)).toBe("merge-request");
		}
	});

	it("keeps the /code-review chip on what is on screen", () => {
		expect(reviewCommandScope("/code-review")).toBe("screen");
		const text = expandReviewCommand("/code-review", WITH_GRAPH)?.text ?? "";
		expect(text).toContain("selected lines");
		expect(text).toContain("Do not review the whole merge request");
		// The button exists precisely so this chip does not have to widen.
		expect(text).toContain("did not press it");
	});
});

describe("understand changes", () => {
	it("reads the graph first and greps only the paths it missed", () => {
		const text = expandReviewCommand(REVIEW_UNDERSTAND_CHANGES_COMMAND, WITH_GRAPH)?.text ?? "";
		expect(text).toContain("Knowledge-graph impact");
		expect(text).toContain("no repository-wide grep for callers");
		expect(text).toContain("Those, and only those");
	});

	it("falls back to searching when the project has no graph", () => {
		const text = expandReviewCommand(REVIEW_UNDERSTAND_CHANGES_COMMAND, NO_GRAPH)?.text ?? "";
		expect(text).toContain("no knowledge-graph brief");
		expect(text).toContain("fall back to searching");
		// Even then, never the 24 MB file itself.
		expect(text).toContain("Never read `.ua/knowledge-graph.json`");
	});
});

describe("code review diff", () => {
	it("checks the project's rules when a bundle exists", () => {
		const text = expandReviewCommand(REVIEW_CODE_REVIEW_DIFF_COMMAND, WITH_GRAPH)?.text ?? "";
		expect(text).toContain("Team rules");
		expect(text).toContain("cite the rule id");
		expect(text).toContain("Knowledge-graph impact");
		// The superpowers reviewer shape: calibrated severities and an explicit verdict.
		expect(text).toContain("### Critical");
		expect(text).toContain("Ready to merge");
	});

	it("refuses to invent a house style when there is no bundle", () => {
		const text = expandReviewCommand(REVIEW_CODE_REVIEW_DIFF_COMMAND, NO_RULES)?.text ?? "";
		expect(text).toContain("No rules bundle exists");
		expect(text).toContain("do not invent a convention");
		expect(text).not.toContain("cite the rule id");
	});
});

describe("security review", () => {
	it("reasons from the graph but labels it as inference", () => {
		const text = expandReviewCommand("/security-review", WITH_GRAPH)?.text ?? "";
		expect(text).toContain("reachability");
		expect(text).toContain("I have not read the caller");
		// The failure mode that made the command useless: it asked for a checkout.
		expect(text).toContain('never answer "no changes to review"');
	});
});

describe("route inputs", () => {
	it("asks for a fresh brief wherever the graph informs the answer", () => {
		expect(reviewCommandNeedsGraphImpact(REVIEW_UNDERSTAND_CHANGES_COMMAND)).toBe(true);
		expect(reviewCommandNeedsGraphImpact(REVIEW_CODE_REVIEW_DIFF_COMMAND)).toBe(true);
		expect(reviewCommandNeedsGraphImpact("/security-review the parser")).toBe(true);
		// The brief is background for a screen-scoped pass, not its subject, so a resumed
		// turn does not pay for the walk again.
		expect(reviewCommandNeedsGraphImpact("/code-review")).toBe(false);
		expect(reviewCommandNeedsGraphImpact("what does this do?")).toBe(false);
	});

	it("reads the rules bundle only for the whole-merge-request review", () => {
		expect(reviewCommandNeedsRules(REVIEW_CODE_REVIEW_DIFF_COMMAND)).toBe(true);
		for (const command of [REVIEW_UNDERSTAND_CHANGES_COMMAND, "/security-review", "/code-review", "/simplify"]) {
			expect(reviewCommandNeedsRules(command)).toBe(false);
		}
	});
});
