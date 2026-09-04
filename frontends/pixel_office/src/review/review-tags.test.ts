import { describe, expect, it } from "vitest";

import { BUILTIN_REVIEW_TAGS, buildTagPalette, reviewTagColor } from "@/review/review-tags";
import type { RuntimeReviewRule } from "@/runtime/types";

function rule(category: string): RuntimeReviewRule {
	return {
		id: `r-${category}`,
		title: category,
		category,
		severity: "MEDIUM",
		summary: "",
		antiPattern: "",
		bestPractice: "",
		sourcePath: "rules.md",
		sourceAnchor: "",
	};
}

describe("BUILTIN_REVIEW_TAGS", () => {
	it("includes at least one built-in tag", () => {
		expect(BUILTIN_REVIEW_TAGS.length).toBeGreaterThan(0);
	});

	it("marks every built-in tag with kind='builtin'", () => {
		for (const tag of BUILTIN_REVIEW_TAGS) {
			expect(tag.kind).toBe("builtin");
		}
	});
});

describe("reviewTagColor", () => {
	it("gives every built-in tag its own color", () => {
		const chips = new Set(BUILTIN_REVIEW_TAGS.map((tag) => reviewTagColor(tag).chip));
		expect(chips.size).toBe(BUILTIN_REVIEW_TAGS.length);
	});

	it("returns a chip, a rule and a token reference for every tag", () => {
		const color = reviewTagColor({ kind: "rule-category", label: "CustomCategory" });
		expect(color.chip).toMatch(/^border-status-/);
		expect(color.rule).toMatch(/^border-status-/);
		expect(color.cssVar).toMatch(/^var\(--color-status-/);
	});

	it("colors a rule category the same way on every call", () => {
		const first = reviewTagColor({ kind: "rule-category", label: "CustomCategory" });
		const second = reviewTagColor({ kind: "rule-category", label: "CustomCategory" });
		expect(second).toEqual(first);
	});

	it("colors a rule category by label, so it matches a built-in of the same name", () => {
		// buildTagPalette dedups case-insensitively, so the color has to agree with it.
		const builtin = reviewTagColor({ kind: "builtin", label: "Security" });
		expect(reviewTagColor({ kind: "rule-category", label: "security" })).toEqual(builtin);
	});
});

describe("buildTagPalette", () => {
	it("returns only built-ins when no rules are provided", () => {
		const palette = buildTagPalette([]);
		expect(palette).toEqual(BUILTIN_REVIEW_TAGS);
	});

	it("appends rule categories not already present in the built-ins", () => {
		const palette = buildTagPalette([rule("CustomCategory")]);
		const labels = palette.map((t) => t.label);
		expect(labels).toContain("CustomCategory");
	});

	it("does not duplicate a rule category that matches a built-in (case-insensitive)", () => {
		// 'Security' is a built-in tag; a rule with label 'security' must not duplicate it.
		const palette = buildTagPalette([rule("security")]);
		const count = palette.filter((t) => t.label.toLowerCase() === "security").length;
		expect(count).toBe(1);
	});

	it("deduplicates multiple rules with the same category", () => {
		const palette = buildTagPalette([rule("MyTag"), rule("MyTag")]);
		const myTagCount = palette.filter((t) => t.label === "MyTag").length;
		expect(myTagCount).toBe(1);
	});

	it("marks rule-derived tags with kind='rule-category'", () => {
		const palette = buildTagPalette([rule("CustomCategory")]);
		const derived = palette.find((t) => t.label === "CustomCategory");
		expect(derived?.kind).toBe("rule-category");
	});

	it("places built-ins before rule-derived tags", () => {
		const palette = buildTagPalette([rule("ZZZNew")]);
		const firstDerivedIndex = palette.findIndex((t) => t.kind === "rule-category");
		const lastBuiltinIndex = palette.reduce(
			(max, t, idx) => (t.kind === "builtin" ? idx : max),
			-1,
		);
		expect(firstDerivedIndex).toBeGreaterThan(lastBuiltinIndex);
	});
});
