/**
 * One entry point the review routes call to get a knowledge-graph brief.
 *
 * Separate from `review-graph.ts` (the walk) and `review-prompts.ts` (the wording)
 * because it is the only place that depends on both, and putting it in either would
 * make those two import each other.
 *
 * Every failure here degrades to "no brief". A review must not stop because a
 * project was never analyzed, because the graph is mid-rebuild, or because git is
 * unhappy — the reviewer's merge request is still in front of them either way.
 */
import { formatGraphImpactForPrompt } from "./review-prompts";
import {
	type ReviewGraphFreshness,
	type ReviewGraphImpact,
	computeReviewGraphImpact,
	loadReviewGraphIndex,
	readReviewGraphFreshness,
	reviewGraphFingerprint,
	writeReviewGraphDiffOverlay,
} from "./review-graph";

export interface ReviewGraphBrief {
	impact: ReviewGraphImpact;
	freshness: ReviewGraphFreshness;
	fingerprint: string;
	/** Prompt-ready markdown. Undefined when there is nothing worth sending. */
	text?: string;
}

export interface BuildReviewGraphBriefInput {
	projectPath: string | null | undefined;
	changedPaths: string[];
	maxAffected?: number;
	/** Written into `diff-overlay.json` so the dashboard can label the comparison. */
	baseBranch?: string;
	/**
	 * When set, the overlay the dashboard reads is refreshed as a side effect. Only
	 * the surfaces the reviewer explicitly drives set this: a chat turn should not
	 * silently rewrite a file in the project the reviewer is reading.
	 */
	writeDiffOverlay?: boolean;
	/** Supplied rather than read from the clock, so the overlay writer is testable. */
	generatedAt?: string;
}

/**
 * Null means "carry on without a graph". The distinction between "no graph" and
 * "graph failed to load" is kept for the UI query, not for the prompt: an agent
 * cannot act on the difference.
 */
export async function buildReviewGraphBrief(input: BuildReviewGraphBriefInput): Promise<ReviewGraphBrief | null> {
	const projectPath = input.projectPath?.trim();
	if (!projectPath || input.changedPaths.length === 0) {
		return null;
	}

	const loaded = await loadReviewGraphIndex(projectPath);
	if (loaded.index === null) {
		return null;
	}
	const index = loaded.index;

	const impact = computeReviewGraphImpact(index, input.changedPaths, {
		...(input.maxAffected === undefined ? {} : { maxAffected: input.maxAffected }),
	});
	const freshness = await readReviewGraphFreshness(projectPath, index.project, { dataDir: index.dataDir });

	// A brief that matched nothing is worse than no brief: it spends tokens telling
	// the agent the graph knows nothing about this change, which invites it to go
	// looking anyway.
	const hasSignal = impact.changed.length > 0 || impact.affected.length > 0;
	const text = hasSignal ? formatGraphImpactForPrompt({ impact, freshness }) : undefined;

	if (input.writeDiffOverlay && hasSignal) {
		try {
			await writeReviewGraphDiffOverlay({
				dataDir: index.dataDir,
				baseBranch: input.baseBranch ?? "unknown",
				generatedAt: input.generatedAt ?? new Date().toISOString(),
				changedPaths: impact.changedPaths,
				changedNodeIds: impact.changedNodeIds,
				affectedNodeIds: impact.affectedNodeIds,
			});
		} catch {
			// The overlay is a dashboard nicety. A read-only checkout must not fail a review.
		}
	}

	return {
		impact,
		freshness,
		fingerprint: reviewGraphFingerprint(index),
		...(text === undefined ? {} : { text }),
	};
}

/**
 * The prompt fragment on its own, for callers that only want to inject it. Kept as
 * a distinct function so a route cannot accidentally treat "no graph" as an error.
 */
export async function buildReviewGraphPromptSection(input: BuildReviewGraphBriefInput): Promise<string | undefined> {
	const brief = await buildReviewGraphBrief(input);
	return brief?.text;
}
