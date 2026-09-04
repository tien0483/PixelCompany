import { describe, expect, it } from "vitest";
import type { RuntimeReviewAnnotation, RuntimeReviewRule } from "../../../src/core/api-contract";
import {
	ANNOTATIONS_PROMPT_BUDGET,
	buildAuditPrompt,
	buildChatPrompt,
	formatAnnotationsForPrompt,
} from "../../../src/review/review-prompts";

function ann(overrides: Partial<RuntimeReviewAnnotation> = {}): RuntimeReviewAnnotation {
	return {
		id: "ann-1",
		newPath: "src/app.ts",
		oldPath: "src/app.ts",
		newLine: 42,
		oldLine: null,
		tag: { kind: "builtin", label: "Bug Risk" },
		note: "",
		headSha: "abc123",
		verdict: null,
		createdAt: "2026-09-01T00:00:00.000Z",
		...overrides,
	};
}

function rule(id: string): RuntimeReviewRule {
	return {
		id,
		title: id,
		category: "Test",
		severity: "LOW",
		summary: "",
		antiPattern: "",
		bestPractice: "",
		sourcePath: "",
		sourceAnchor: "",
	};
}

describe("formatAnnotationsForPrompt", () => {
	it("formats a single new-side annotation", () => {
		const text = formatAnnotationsForPrompt([ann()]);
		expect(text).toContain("ann-1");
		expect(text).toContain("src/app.ts:42");
		expect(text).toContain("Bug Risk");
		expect(text).toContain("new side");
	});

	it("keeps the plain-tag clause byte-identical", () => {
		expect(formatAnnotationsForPrompt([ann()])).toBe("- [ann-1] src/app.ts:42 (new side) — Tag: Bug Risk");
	});

	it("names a code smell as one", () => {
		const text = formatAnnotationsForPrompt([ann({ tag: { kind: "smell", label: "Feature Envy" } })]);
		expect(text).toContain("Suspected code smell: Feature Envy");
	});

	it("names a refactoring as a request", () => {
		const text = formatAnnotationsForPrompt([ann({ tag: { kind: "refactoring", label: "Extract Method" } })]);
		expect(text).toContain("Refactoring the reviewer wants applied here: Extract Method");
	});

	it("formats an old-side (deleted line) annotation", () => {
		const text = formatAnnotationsForPrompt([ann({ newLine: null, oldLine: 10 })]);
		expect(text).toContain(":10");
		expect(text).toContain("old/deleted side");
	});

	it("includes the note when present", () => {
		const text = formatAnnotationsForPrompt([ann({ note: "looks risky" })]);
		expect(text).toContain("looks risky");
	});

	it("marks a stale annotation when headSha differs from current", () => {
		const text = formatAnnotationsForPrompt([ann({ headSha: "old-sha" })], "new-sha");
		expect(text).toContain("earlier revision");
	});

	it("does not mark stale when headSha matches current", () => {
		const text = formatAnnotationsForPrompt([ann({ headSha: "abc123" })], "abc123");
		expect(text).not.toContain("earlier revision");
	});

	it("includes a range when lineRange is set", () => {
		const text = formatAnnotationsForPrompt([
			ann({ newLine: 50, lineRange: { startNewLine: 40, startOldLine: null } }),
		]);
		expect(text).toContain("40-50");
	});

	it("omits annotations over the budget and adds a note", () => {
		// Build enough annotations to exceed ANNOTATIONS_PROMPT_BUDGET
		const manyAnnotations = Array.from({ length: 200 }, (_, i) => ann({ id: `ann-${i}`, note: "x".repeat(80) }));
		const text = formatAnnotationsForPrompt(manyAnnotations, null, ANNOTATIONS_PROMPT_BUDGET);
		expect(text).toContain("omitted");
	});

	it("returns empty string for an empty array", () => {
		expect(formatAnnotationsForPrompt([])).toBe("");
	});
});

describe("buildAuditPrompt — annotations section", () => {
	const base = {
		title: "Fix crash",
		sourceBranch: "fix/crash",
		targetBranch: "main",
		rules: [rule("R1")],
		files: [{ newPath: "a.ts", diff: "@@ -1 +1 @@\n-a\n+b\n" }],
	};

	it("includes the reviewer annotations section when annotations are provided", () => {
		const prompt = buildAuditPrompt({ ...base, annotations: [ann()] });
		expect(prompt).toContain("## Reviewer annotations");
		expect(prompt).toContain("ann-1");
	});

	it("includes the verdict contract instruction when annotations are provided", () => {
		const prompt = buildAuditPrompt({ ...base, annotations: [ann()] });
		expect(prompt).toContain("verdict");
		expect(prompt).toContain("annotationId");
	});

	it("explains a catalog kind only when that kind is present", () => {
		const plain = buildAuditPrompt({ ...base, annotations: [ann()] });
		expect(plain).not.toContain("refactoring.guru");
		expect(plain).not.toContain("worth applying here");

		const smells = buildAuditPrompt({
			...base,
			annotations: [ann({ tag: { kind: "smell", label: "Feature Envy" } })],
		});
		expect(smells).toContain("refactoring.guru");
		expect(smells).not.toContain("worth applying here");

		const refactorings = buildAuditPrompt({
			...base,
			annotations: [ann({ tag: { kind: "refactoring", label: "Extract Method" } })],
		});
		expect(refactorings).toContain("worth applying here");
		expect(refactorings).not.toContain("refactoring.guru");
	});

	it("omits the annotations section when annotations array is empty", () => {
		const prompt = buildAuditPrompt({ ...base, annotations: [] });
		expect(prompt).not.toContain("## Reviewer annotations");
	});

	it("omits the annotations section when annotations is absent", () => {
		const prompt = buildAuditPrompt(base);
		expect(prompt).not.toContain("## Reviewer annotations");
	});
});

describe("buildChatPrompt — annotations section", () => {
	const base = {
		prompt: "What does this change do?",
		title: "Fix crash",
		sourceBranch: "fix/crash",
		targetBranch: "main",
		changedPaths: ["a.ts"],
		isFirstTurn: true,
	};

	it("includes reviewer-flagged spots on the first user turn with annotations", () => {
		const prompt = buildChatPrompt({ ...base, annotations: [ann()] });
		expect(prompt).toContain("Reviewer-flagged spots");
		expect(prompt).toContain("ann-1");
	});

	it("does not include annotations section when array is empty", () => {
		const prompt = buildChatPrompt({ ...base, annotations: [] });
		expect(prompt).not.toContain("Reviewer-flagged spots");
	});
});

describe("buildChatPrompt — suggestions contract", () => {
	const base = {
		prompt: "/code-review",
		title: "Fix crash",
		sourceBranch: "fix/crash",
		targetBranch: "main",
		changedPaths: ["a.ts"],
		isFirstTurn: true,
	};

	it("omits the contract entirely when suggestions were not asked for", () => {
		const prompt = buildChatPrompt({ ...base, annotations: [ann()] });
		expect(prompt).not.toContain("```suggestions");
		expect(prompt).not.toContain("annotationId");
	});

	it("asks only for findings when there are no annotations", () => {
		const prompt = buildChatPrompt({ ...base, expectSuggestions: true });
		expect(prompt).toContain("```suggestions");
		expect(prompt).not.toContain("annotationId");
		expect(prompt).toContain("Omit the block entirely");
	});

	it("asks for a verdict per flagged spot when annotations are in the prompt", () => {
		const prompt = buildChatPrompt({ ...base, expectSuggestions: true, annotations: [ann()] });
		expect(prompt).toContain("annotationId");
		expect(prompt).toContain("one verdict element per reviewer-flagged spot");
		// The block stops being optional: a pass that finds no bugs still owes the
		// reviewer an answer on every spot they flagged.
		expect(prompt).not.toContain("Omit the block entirely");
		expect(prompt).toContain("Emit the block even when you found nothing");
	});

	it("does not ask for verdicts when the flagged spots were not sent this turn", () => {
		// A pass-through command on a resumed turn carries no context block, so there is
		// no list of ids to echo — asking for one is how an id gets invented.
		const prompt = buildChatPrompt({
			...base,
			prompt: "/simplify",
			isFirstTurn: false,
			expectSuggestions: true,
			annotations: [ann()],
		});
		expect(prompt).not.toContain("Reviewer-flagged spots");
		expect(prompt).not.toContain("annotationId");
	});
});
