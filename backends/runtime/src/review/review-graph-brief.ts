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

import {
	computeReviewGraphImpact,
	loadReviewGraphIndex,
	lookupReviewGraphSymbols,
	MAX_LOOKUP_SYMBOLS,
	type ReviewGraphFreshness,
	type ReviewGraphImpact,
	readReviewGraphFreshness,
	reviewGraphFingerprint,
	writeReviewGraphDiffOverlay,
} from "./review-graph";
import { formatGraphImpactForPrompt, formatGraphSymbolsForPrompt } from "./review-prompts";

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

/** Identifier-ish, and long enough that a bare token is not an English word. */
const BARE_TOKEN_PATTERN = /\b[A-Za-z_][A-Za-z0-9_]{3,}\b/g;
/** `a.b`, `a::b`, `a->b` — a qualified reference, split into its own segments. */
const QUALIFIER_PATTERN = /::|->|\./;

/**
 * The symbol names a prompt is asking about.
 *
 * Two stages, and the order is the whole design. A backticked span is the reviewer
 * saying "this is code", so those win outright and nothing else is considered. Only
 * a prompt with no backticks at all falls back to bare tokens, and then only ones
 * that *look* like code — containing an underscore or an internal capital — because
 * "what does this function return" must extract nothing rather than look up "function".
 *
 * Pure, and cheap on purpose: it runs before the graph is loaded, so a prompt with no
 * symbols in it never pays for a 24 MB parse it had no use for.
 *
 * Never called with the selection text or the diff. A hunk is code, so every
 * identifier in it is a candidate, most of them hit the index, and the section fills
 * with symbols nobody asked about — a sweep with extra steps.
 */
export function extractSymbolCandidates(prompt: string): string[] {
	const candidates: string[] = [];
	const push = (value: string): void => {
		const trimmed = value.trim();
		if (trimmed.length > 1 && !candidates.includes(trimmed)) {
			candidates.push(trimmed);
		}
	};

	const backticked = prompt.match(/`([^`\n]+)`/g) ?? [];
	for (const span of backticked) {
		const inner = span.slice(1, -1).trim();
		// A backticked path or call site still names a symbol: `directories.get_x` is
		// two candidates, and `get_x()` is one with the parentheses shed.
		const bare = inner.replace(/\(.*$/, "").trim();
		if (bare.length === 0) {
			continue;
		}
		push(bare);
		if (QUALIFIER_PATTERN.test(bare)) {
			for (const segment of bare.split(QUALIFIER_PATTERN)) {
				push(segment);
			}
		}
	}

	if (candidates.length === 0) {
		for (const token of prompt.match(BARE_TOKEN_PATTERN) ?? []) {
			if (token.includes("_") || /[a-z][A-Z]/.test(token)) {
				push(token);
			}
		}
	}

	return candidates.slice(0, MAX_LOOKUP_SYMBOLS);
}

/**
 * The "where is this defined" section, or nothing.
 *
 * Rides the same module-level graph cache as the impact brief, so on every turn after
 * the first this is a `stat` plus a handful of Map lookups. Freshness is deliberately
 * not re-read here — that is four `git` spawns, and unlike the impact brief this runs
 * on every message rather than the first.
 */
export async function buildReviewGraphSymbolSection(input: {
	projectPath: string | null | undefined;
	prompt: string;
	changedPaths: string[];
}): Promise<string | undefined> {
	const projectPath = input.projectPath?.trim();
	if (!projectPath) {
		return undefined;
	}
	const names = extractSymbolCandidates(input.prompt);
	if (names.length === 0) {
		return undefined;
	}

	const loaded = await loadReviewGraphIndex(projectPath);
	if (loaded.index === null) {
		// The load error is already surfaced verbatim by the Impact panel's own query.
		// Repeating it inside a prompt tells the agent nothing it can act on.
		return undefined;
	}

	const lookups = lookupReviewGraphSymbols(loaded.index, names);
	// A bare token is a guess, so its absence is not news; a backticked name the
	// reviewer wrote is, because "the graph has no entry for it" is what stops the
	// agent going and grepping for it instead.
	const backtickedNames = new Set(
		(input.prompt.match(/`([^`\n]+)`/g) ?? []).map((span) => span.slice(1, -1).trim().toLowerCase()),
	);
	const reportable = lookups.filter(
		(lookup) => lookup.kind !== "absent" || backtickedNames.has(lookup.name.toLowerCase()),
	);
	if (reportable.length === 0) {
		return undefined;
	}

	return formatGraphSymbolsForPrompt({
		lookups: reportable,
		changedPaths: input.changedPaths,
		project: loaded.index.project,
		dataDir: loaded.index.dataDir,
	});
}
