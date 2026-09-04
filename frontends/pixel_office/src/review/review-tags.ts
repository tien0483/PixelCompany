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
 * builtin's red — the same case-insensitive identity `buildTagPalette` dedups on.
 */
export function reviewTagColor(tag: ReviewTag): ReviewTagColor {
	const key = tag.label.toLowerCase();
	const builtinIndex = BUILTIN_TAG_COLOR_INDEX[key];
	const index = builtinIndex ?? hashLabel(key) % TAG_COLOR_RAMP.length;
	return TAG_COLOR_RAMP[index] as ReviewTagColor;
}

/** Builtins first, then unique rule categories (case-insensitive dedup vs builtins). */
export function buildTagPalette(rules: RuntimeReviewRule[]): ReviewTag[] {
	const seen = new Set(BUILTIN_REVIEW_TAGS.map((tag) => tag.label.toLowerCase()));
	const palette = [...BUILTIN_REVIEW_TAGS];
	for (const rule of rules) {
		const key = rule.category.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		palette.push({ kind: "rule-category", label: rule.category });
	}
	return palette;
}
