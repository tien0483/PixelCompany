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

export interface ReviewTagColor {
	/** Chip surface: border + background + text. */
	chip: string;
	/** Left rule on a placed annotation or the pending-note composer. */
	rule: string;
	/** Token reference for the drop-target row, which tints via a custom property. */
	cssVar: string;
}

/**
 * One entry per `--color-status-*` token. Every class is written out in full because
 * Tailwind v4 scans source text — a `bg-status-${name}` template produces classes the
 * compiler never emits.
 */
const TAG_COLOR_RAMP: ReviewTagColor[] = [
	{
		chip: "border-status-blue/40 bg-status-blue/15 text-status-blue",
		rule: "border-status-blue",
		cssVar: "var(--color-status-blue)",
	},
	{
		chip: "border-status-cyan/40 bg-status-cyan/15 text-status-cyan",
		rule: "border-status-cyan",
		cssVar: "var(--color-status-cyan)",
	},
	{
		chip: "border-status-red/40 bg-status-red/15 text-status-red",
		rule: "border-status-red",
		cssVar: "var(--color-status-red)",
	},
	{
		chip: "border-status-gold/40 bg-status-gold/15 text-status-gold",
		rule: "border-status-gold",
		cssVar: "var(--color-status-gold)",
	},
	{
		chip: "border-status-rose/40 bg-status-rose/15 text-status-rose",
		rule: "border-status-rose",
		cssVar: "var(--color-status-rose)",
	},
	{
		chip: "border-status-orange/40 bg-status-orange/15 text-status-orange",
		rule: "border-status-orange",
		cssVar: "var(--color-status-orange)",
	},
	{
		chip: "border-status-violet/40 bg-status-violet/15 text-status-violet",
		rule: "border-status-violet",
		cssVar: "var(--color-status-violet)",
	},
	{
		chip: "border-status-green/40 bg-status-green/15 text-status-green",
		rule: "border-status-green",
		cssVar: "var(--color-status-green)",
	},
	{
		chip: "border-status-lime/40 bg-status-lime/15 text-status-lime",
		rule: "border-status-lime",
		cssVar: "var(--color-status-lime)",
	},
	{
		chip: "border-status-purple/40 bg-status-purple/15 text-status-purple",
		rule: "border-status-purple",
		cssVar: "var(--color-status-purple)",
	},
];

/** Lowercased builtin label to ramp index — the pairing is semantic, not incidental. */
const BUILTIN_TAG_COLOR_INDEX: Record<string, number> = {
	pattern: 0,
	"code style": 1,
	security: 2,
	performance: 3,
	"bug risk": 4,
	"error handling": 5,
	concurrency: 6,
	"test coverage": 7,
	simplify: 8,
	"breaking change": 9,
};

/** djb2, so a rule category lands on the same color on every machine and every reload. */
function hashLabel(label: string): number {
	let hash = 5381;
	for (let index = 0; index < label.length; index += 1) {
		hash = ((hash << 5) + hash + label.charCodeAt(index)) >>> 0;
	}
	return hash;
}

/**
 * The color a tag carries everywhere it appears: palette chip, drag ghost, drop-target
 * row, placed annotation, sidebar list. Derived from the label rather than stored on the
 * tag, so annotations saved before this existed color themselves correctly on load.
 *
 * Keyed on the label and not `kind`, so a rule category named "Security" inherits the
 * builtin's red — the same case-insensitive identity `buildTagSections` dedups on. The
 * catalog labels take a hashed slot for the same reason: a smell named after a builtin
 * would be deduped away, so agreeing on the label is what keeps the two consistent.
 */
export function reviewTagColor(tag: ReviewTag): ReviewTagColor {
	const key = tag.label.toLowerCase();
	const builtinIndex = BUILTIN_TAG_COLOR_INDEX[key];
	const index = builtinIndex ?? hashLabel(key) % TAG_COLOR_RAMP.length;
	return TAG_COLOR_RAMP[index] as ReviewTagColor;
}

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
