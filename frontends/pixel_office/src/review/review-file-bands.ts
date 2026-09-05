import type { RuntimeGitlabDiffFile } from "@/runtime/types";

/**
 * The whole merge request as one thin strip beside the per-file ruler.
 *
 * The diff pane only ever mounts one file, so the overview ruler can only ever describe
 * that file. This is the other half of the same question — "where am I in the change?" —
 * answered across files, sized by how much each one actually changed rather than by its
 * position in an alphabetical list.
 */
export interface ReviewFileBand {
	path: string;
	label: string;
	/** Fraction of the strip, 0–1. Sums to 1 across all bands. */
	fraction: number;
	additions: number;
	deletions: number;
	isActive: boolean;
	isReviewed: boolean;
	/** Unsent drafts or comments that arrived since this file was marked reviewed. */
	hasAttention: boolean;
}

export interface ReviewFileBandsInput {
	files: readonly RuntimeGitlabDiffFile[];
	activePath: string | null;
	reviewedPaths: readonly string[];
	draftCountByPath: ReadonlyMap<string, number>;
	newCommentPaths: ReadonlySet<string>;
	/**
	 * Smallest share of the strip a file may occupy, so a one-line change stays a
	 * clickable target next to a thousand-line one.
	 */
	minFraction?: number;
}

const DEFAULT_MIN_FRACTION = 0.02;

export function buildFileBands(input: ReviewFileBandsInput): ReviewFileBand[] {
	if (input.files.length === 0) {
		return [];
	}
	const reviewed = new Set(input.reviewedPaths);
	const minFraction = Math.min(input.minFraction ?? DEFAULT_MIN_FRACTION, 1 / input.files.length);

	// A binary or diff-truncated file reports zero changed lines; it still has to be a
	// band, or the strip would skip files the reviewer can select in the file list.
	const weights = input.files.map((file) => Math.max(1, file.additions + file.deletions));
	const totalWeight = weights.reduce((total, weight) => total + weight, 0);

	const rawFractions = weights.map((weight) => weight / totalWeight);
	// Lifting the small bands to the floor overshoots 1, so the slack comes back out of
	// the bands that are above it, in proportion — otherwise the strip would overflow.
	const liftedFractions = rawFractions.map((fraction) => Math.max(fraction, minFraction));
	const overshoot = liftedFractions.reduce((total, fraction) => total + fraction, 0) - 1;
	let normalized = liftedFractions;
	if (overshoot > 0) {
		const shrinkable = liftedFractions.reduce(
			(total, fraction) => total + Math.max(0, fraction - minFraction),
			0,
		);
		normalized =
			shrinkable > 0
				? liftedFractions.map(
						(fraction) => fraction - (Math.max(0, fraction - minFraction) / shrinkable) * overshoot,
					)
				: liftedFractions.map(() => 1 / input.files.length);
	}

	return input.files.map((file, index) => {
		const path = file.newPath;
		return {
			path,
			label: `${path} (+${file.additions} −${file.deletions})`,
			fraction: normalized[index] ?? 0,
			additions: file.additions,
			deletions: file.deletions,
			isActive: path === input.activePath,
			isReviewed: reviewed.has(path),
			hasAttention: (input.draftCountByPath.get(path) ?? 0) > 0 || input.newCommentPaths.has(path),
		};
	});
}
