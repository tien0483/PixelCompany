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
