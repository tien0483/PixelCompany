import type { RuntimeReviewAnnotationTag, RuntimeReviewRule } from "@/runtime/types";

export type ReviewTag = RuntimeReviewAnnotationTag;

/** Always available, rules bundle or not. */
export const BUILTIN_REVIEW_TAGS: ReviewTag[] = [
	{ kind: "builtin", label: "Pattern" },
	{ kind: "builtin", label: "Code Style" },
	{ kind: "builtin", label: "Security" },
	{ kind: "builtin", label: "Performance" },
	{ kind: "builtin", label: "Bug Risk" },
	{ kind: "builtin", label: "Error Handling" },
	{ kind: "builtin", label: "Concurrency" },
	{ kind: "builtin", label: "Test Coverage" },
	{ kind: "builtin", label: "Simplify" },
	{ kind: "builtin", label: "Breaking Change" },
];

/**
 * The published code-smell catalog (Fowler, as grouped by refactoring.guru). These are
 * names the agent already knows, which is why nothing here ships a definition — the
 * prompt only has to say that a label *is* a smell name, not what the smell means.
 */
const CODE_SMELL_CATALOG: Array<{ title: string; labels: string[] }> = [
	{
		title: "Bloaters",
		labels: ["Long Method", "Large Class", "Primitive Obsession", "Long Parameter List", "Data Clumps"],
	},
	{
		title: "Object-Orientation Abusers",
		labels: [
			"Alternative Classes with Different Interfaces",
			"Refused Bequest",
			"Switch Statements",
			"Temporary Field",
		],
	},
	{
		title: "Change Preventers",
		labels: ["Divergent Change", "Shotgun Surgery", "Parallel Inheritance Hierarchies"],
	},
	{
		title: "Dispensables",
		labels: ["Comments", "Duplicate Code", "Data Class", "Dead Code", "Lazy Class", "Speculative Generality"],
	},
	{
		title: "Couplers",
		labels: ["Feature Envy", "Inappropriate Intimacy", "Message Chains", "Middle Man"],
	},
	{
		title: "Other",
		labels: ["Incomplete Library Class"],
	},
];

/** The refactoring techniques from the same catalog — dragged as "apply this here". */
const REFACTORING_CATALOG: Array<{ title: string; labels: string[] }> = [
	{
		title: "Composing Methods",
		labels: [
			"Extract Method",
			"Inline Method",
			"Extract Variable",
			"Inline Temp",
			"Replace Temp with Query",
			"Split Temporary Variable",
			"Remove Assignments to Parameters",
			"Replace Method with Method Object",
			"Substitute Algorithm",
		],
	},
	{
		title: "Moving Features between Objects",
		labels: [
			"Move Method",
			"Move Field",
			"Extract Class",
			"Inline Class",
			"Hide Delegate",
			"Remove Middle Man",
			"Introduce Foreign Method",
			"Introduce Local Extension",
		],
	},
	{
		title: "Organizing Data",
		labels: [
			"Change Value to Reference",
			"Change Reference to Value",
			"Duplicate Observed Data",
			"Self Encapsulate Field",
			"Replace Data Value with Object",
			"Replace Array with Object",
			"Change Unidirectional Association to Bidirectional",
			"Change Bidirectional Association to Unidirectional",
			"Encapsulate Field",
			"Encapsulate Collection",
			"Replace Magic Number with Symbolic Constant",
			"Replace Type Code with Class",
			"Replace Type Code with Subclasses",
			"Replace Type Code with State/Strategy",
			"Replace Subclass with Fields",
		],
	},
	{
		title: "Simplifying Conditional Expressions",
		labels: [
			"Consolidate Conditional Expression",
			"Consolidate Duplicate Conditional Fragments",
			"Decompose Conditional",
			"Replace Conditional with Polymorphism",
			"Remove Control Flag",
			"Replace Nested Conditional with Guard Clauses",
			"Introduce Null Object",
			"Introduce Assertion",
		],
	},
	{
		title: "Simplifying Method Calls",
		labels: [
			"Add Parameter",
			"Remove Parameter",
			"Rename Method",
			"Separate Query from Modifier",
			"Parameterize Method",
			"Introduce Parameter Object",
			"Preserve Whole Object",
			"Remove Setting Method",
			"Replace Parameter with Explicit Methods",
			"Replace Parameter with Method Call",
			"Hide Method",
			"Replace Constructor with Factory Method",
			"Replace Error Code with Exception",
			"Replace Exception with Test",
		],
	},
	{
		title: "Dealing with Generalization",
		labels: [
			"Pull Up Field",
			"Pull Up Method",
			"Pull Up Constructor Body",
			"Push Down Field",
			"Push Down Method",
			"Extract Subclass",
			"Extract Superclass",
			"Extract Interface",
			"Collapse Hierarchy",
			"Form Template Method",
			"Replace Inheritance with Delegation",
			"Replace Delegation with Inheritance",
		],
	},
];

export interface ReviewTagGroup {
	/** Empty for a section that needs no sub-heading (the curated tags). */
	title: string;
	tags: ReviewTag[];
}

export type ReviewTagSectionId = "tags" | "smells" | "refactorings";

export interface ReviewTagSection {
	id: ReviewTagSectionId;
	title: string;
	groups: ReviewTagGroup[];
}

function toGroups(catalog: Array<{ title: string; labels: string[] }>, kind: ReviewTag["kind"]): ReviewTagGroup[] {
	return catalog.map((group) => ({
		title: group.title,
		tags: group.labels.map((label) => ({ kind, label })),
	}));
}

export const CODE_SMELL_TAG_GROUPS: ReviewTagGroup[] = toGroups(CODE_SMELL_CATALOG, "smell");
export const REFACTORING_TAG_GROUPS: ReviewTagGroup[] = toGroups(REFACTORING_CATALOG, "refactoring");

function labelsOf(groups: ReviewTagGroup[]): string[] {
	return groups.flatMap((group) => group.tags.map((tag) => tag.label));
}

export function countTags(section: ReviewTagSection): number {
	return section.groups.reduce((total, group) => total + group.tags.length, 0);
}

/**
 * Curated tags first (built-ins, then unique rule categories), then the two catalog
 * sections. The dedup seed spans *every* section, not just the built-ins: a rules
 * bundle whose categories include "Duplicate Code" would otherwise render that chip
 * twice, once as a rule category and once as a smell.
 */
export function buildTagSections(rules: RuntimeReviewRule[]): ReviewTagSection[] {
	const seen = new Set(
		[
			...BUILTIN_REVIEW_TAGS.map((tag) => tag.label),
			...labelsOf(CODE_SMELL_TAG_GROUPS),
			...labelsOf(REFACTORING_TAG_GROUPS),
		].map((label) => label.toLowerCase()),
	);
	const curated = [...BUILTIN_REVIEW_TAGS];
	for (const rule of rules) {
		const key = rule.category.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		curated.push({ kind: "rule-category", label: rule.category });
	}
	return [
		{ id: "tags", title: "Tags", groups: [{ title: "", tags: curated }] },
		{ id: "smells", title: "Smells", groups: CODE_SMELL_TAG_GROUPS },
		{ id: "refactorings", title: "Refactorings", groups: REFACTORING_TAG_GROUPS },
	];
}

/**
 * Border colour by kind, so a chip stays recognisable once it is sitting on a diff row
 * away from the section it was dragged from. `null` means "keep the call site's own
 * default" — the strip and the diff rows disagree on which neutral border they use.
 */
export function reviewTagChipClassName(kind: ReviewTag["kind"]): string | null {
	if (kind === "smell") {
		return "border-status-orange/40";
	}
	if (kind === "refactoring") {
		return "border-status-blue/40";
	}
	return null;
}
