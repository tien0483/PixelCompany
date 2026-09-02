import { describe, expect, it } from "vitest";

import {
	ANNOTATIONS_PROMPT_BUDGET,
	buildAuditPrompt,
	buildChatPrompt,
	formatAnnotationsForPrompt,
} from "../../../src/review/review-prompts";
import type { RuntimeReviewAnnotation, RuntimeReviewRule } from "../../../src/core/api-contract";

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
		const manyAnnotations = Array.from({ length: 200 }, (_, i) =>
			ann({ id: `ann-${i}`, note: "x".repeat(80) }),
		);
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
