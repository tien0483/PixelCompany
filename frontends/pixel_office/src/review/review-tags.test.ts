import { describe, expect, it } from "vitest";

import {
	BUILTIN_REVIEW_TAGS,
	buildTagSections,
	CODE_SMELL_TAG_GROUPS,
	countTags,
	REFACTORING_TAG_GROUPS,
	type ReviewTag,
	type ReviewTagSection,
	type ReviewTagSectionId,
	reviewTagColor,
} from "@/review/review-tags";
import {
	describedTagLabelKeys,
	reviewTagDescription,
	reviewTagDescriptionHeadings,
} from "@/review/review-tag-descriptions";
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

function section(sections: ReviewTagSection[], id: ReviewTagSectionId): ReviewTagSection {
	const found = sections.find((candidate) => candidate.id === id);
	if (found === undefined) {
		throw new Error(`missing section: ${id}`);
	}
	return found;
}

function flatten(sections: ReviewTagSection[]): ReviewTag[] {
	return sections.flatMap((entry) => entry.groups.flatMap((group) => group.tags));
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
		// buildTagSections dedups case-insensitively, so the color has to agree with it.
		const builtin = reviewTagColor({ kind: "builtin", label: "Security" });
		expect(reviewTagColor({ kind: "rule-category", label: "security" })).toEqual(builtin);
	});

	it("colors a catalog label by its own name, ignoring the kind", () => {
		const smell = reviewTagColor({ kind: "smell", label: "Feature Envy" });
		expect(smell.chip).toMatch(/^border-status-/);
		expect(reviewTagColor({ kind: "rule-category", label: "feature envy" })).toEqual(smell);
	});
});

describe("refactoring catalogs", () => {
	it("ships the published code smells", () => {
		const labels = CODE_SMELL_TAG_GROUPS.flatMap((group) => group.tags.map((tag) => tag.label));
		// Guards against a group being dropped in a merge: the catalog is fixed, so a
		// changed count is a change to the taxonomy and should be deliberate.
		expect(labels).toHaveLength(23);
		expect(labels).toContain("Feature Envy");
		expect(labels).toContain("Shotgun Surgery");
		expect(new Set(labels).size).toBe(labels.length);
	});

	it("ships the published refactoring techniques", () => {
		const labels = REFACTORING_TAG_GROUPS.flatMap((group) => group.tags.map((tag) => tag.label));
		expect(labels).toHaveLength(66);
		expect(labels).toContain("Extract Method");
		expect(labels).toContain("Replace Conditional with Polymorphism");
		expect(new Set(labels).size).toBe(labels.length);
	});

	it("marks each catalog with its own kind", () => {
		for (const group of CODE_SMELL_TAG_GROUPS) {
			for (const tag of group.tags) {
				expect(tag.kind).toBe("smell");
			}
		}
		for (const group of REFACTORING_TAG_GROUPS) {
			for (const tag of group.tags) {
				expect(tag.kind).toBe("refactoring");
			}
		}
	});

	it("titles every catalog group", () => {
		for (const group of [...CODE_SMELL_TAG_GROUPS, ...REFACTORING_TAG_GROUPS]) {
			expect(group.title.length).toBeGreaterThan(0);
		}
	});
});

describe("buildTagSections", () => {
	it("returns the three sections in order", () => {
		expect(buildTagSections([]).map((entry) => entry.id)).toEqual(["tags", "smells", "refactorings"]);
	});

	it("returns only built-ins in the tags section when no rules are provided", () => {
		expect(section(buildTagSections([]), "tags").groups).toEqual([{ title: "", tags: BUILTIN_REVIEW_TAGS }]);
	});

	it("appends rule categories not already present in the built-ins", () => {
		const labels = section(buildTagSections([rule("CustomCategory")]), "tags").groups[0]?.tags.map((t) => t.label);
		expect(labels).toContain("CustomCategory");
	});

	it("does not duplicate a rule category that matches a built-in (case-insensitive)", () => {
		// 'Security' is a built-in tag; a rule with label 'security' must not duplicate it.
		const tags = flatten(buildTagSections([rule("security")]));
		expect(tags.filter((t) => t.label.toLowerCase() === "security")).toHaveLength(1);
	});

	it("does not duplicate a rule category that matches a code smell", () => {
		// The dedup seed spans every section, not just the built-ins.
		const tags = flatten(buildTagSections([rule("duplicate code")]));
		expect(tags.filter((t) => t.label.toLowerCase() === "duplicate code")).toHaveLength(1);
	});

	it("does not duplicate a rule category that matches a refactoring technique", () => {
		const tags = flatten(buildTagSections([rule("Extract Method")]));
		expect(tags.filter((t) => t.label === "Extract Method")).toHaveLength(1);
	});

	it("deduplicates multiple rules with the same category", () => {
		const tags = flatten(buildTagSections([rule("MyTag"), rule("MyTag")]));
		expect(tags.filter((t) => t.label === "MyTag")).toHaveLength(1);
	});

	it("marks rule-derived tags with kind='rule-category'", () => {
		const tags = flatten(buildTagSections([rule("CustomCategory")]));
		expect(tags.find((t) => t.label === "CustomCategory")?.kind).toBe("rule-category");
	});

	it("places built-ins before rule-derived tags", () => {
		const tags = section(buildTagSections([rule("ZZZNew")]), "tags").groups[0]?.tags ?? [];
		const firstDerivedIndex = tags.findIndex((t) => t.kind === "rule-category");
		const lastBuiltinIndex = tags.reduce((max, t, idx) => (t.kind === "builtin" ? idx : max), -1);
		expect(firstDerivedIndex).toBeGreaterThan(lastBuiltinIndex);
	});
});

describe("countTags", () => {
	it("sums a section's groups", () => {
		const sections = buildTagSections([]);
		expect(countTags(section(sections, "tags"))).toBe(BUILTIN_REVIEW_TAGS.length);
		expect(countTags(section(sections, "smells"))).toBe(23);
		expect(countTags(section(sections, "refactorings"))).toBe(66);
	});
});

describe("reviewTagDescription", () => {
	const catalogTags = [
		...BUILTIN_REVIEW_TAGS,
		...CODE_SMELL_TAG_GROUPS.flatMap((group) => group.tags),
		...REFACTORING_TAG_GROUPS.flatMap((group) => group.tags),
	];

	it("explains every chip the strip can render", () => {
		const undescribed = catalogTags.filter((tag) => reviewTagDescription(tag) === null).map((tag) => tag.label);
		expect(undescribed).toEqual([]);
	});

	it("has no description for a label the catalogs no longer carry", () => {
		const known = new Set(catalogTags.map((tag) => tag.label.toLowerCase()));
		expect(describedTagLabelKeys().filter((key) => !known.has(key))).toEqual([]);
	});

	it("matches a rules-bundle category to the builtin it shares a name with", () => {
		// Same case-insensitive identity the colour and the dedup already use.
		expect(reviewTagDescription({ kind: "rule-category", label: "security" })).toEqual(
			reviewTagDescription({ kind: "builtin", label: "Security" }),
		);
		expect(reviewTagDescription({ kind: "rule-category", label: "Team Convention" })).toBeNull();
	});

	it("heads the two lines by kind, since 'Fix' reads wrong for a technique", () => {
		expect(reviewTagDescriptionHeadings({ kind: "smell", label: "Feature Envy" }).then).toBe("Fix");
		expect(reviewTagDescriptionHeadings({ kind: "refactoring", label: "Extract Method" }).then).toBe(
			"What it does",
		);
	});
});
