import { createTwoFilesPatch } from "diff";

/** Unified-diff context lines. Three is the `diff -u` default and reads the same to a model. */
const DIFF_CONTEXT_LINES = 3;

export type RefineDiffOutcome =
	/** The markdown changed; send `diff` and let the agent apply just that. */
	| { kind: "diff"; diff: string }
	/** Nothing changed since the HTML was generated, so there is nothing to refine. */
	| { kind: "unchanged" }
	/**
	 * Either no recorded base (nothing to diff against) or a change so large that the diff is
	 * no cheaper than the document — fall back to sending the full markdown pair.
	 */
	| { kind: "full"; reason: "no-base" | "rewrite" };

/**
 * What Refine should send to the prompt service.
 *
 * `base` is the markdown that the current HTML was generated from, as recorded in
 * `<stem>.html.src.md`; `next` is what the editor holds now. A diff is only worth sending when
 * there is a base *and* the diff is genuinely smaller than the document — for a wholesale
 * rewrite the hunks approach "delete everything, add everything", which is strictly worse than
 * handing over the two documents.
 */
export function buildRefineDiff(base: string | null, next: string): RefineDiffOutcome {
	if (base === null) {
		return { kind: "full", reason: "no-base" };
	}
	// Trailing whitespace is not a requirement change: autosave alone can move it, and asking
	// the agent to re-emit a whole page over a stray newline is worse than doing nothing.
	const trimmedBase = base.replace(/\s+$/, "");
	const trimmedNext = next.replace(/\s+$/, "");
	if (trimmedBase === trimmedNext) {
		return { kind: "unchanged" };
	}
	const patch = createTwoFilesPatch("requirement", "requirement", trimmedBase, trimmedNext, undefined, undefined, {
		context: DIFF_CONTEXT_LINES,
	});
	const diff = stripPatchHeader(patch);
	if (diff === "") {
		return { kind: "unchanged" };
	}
	// The full path sends both versions of the document; the diff is only worth having when it
	// is smaller than that. For a wholesale rewrite the hunks degenerate into "delete
	// everything, add everything", which is strictly more text than the two documents.
	if (diff.length >= trimmedBase.length + trimmedNext.length) {
		return { kind: "full", reason: "rewrite" };
	}
	return { kind: "diff", diff };
}

/**
 * Drops the `Index:` / `---` / `+++` preamble, keeping the `@@` hunks. The prompt labels the
 * payload itself, so filenames the agent cannot open are pure noise.
 */
function stripPatchHeader(patch: string): string {
	const hunkStart = patch.indexOf("@@");
	return (hunkStart === -1 ? "" : patch.slice(hunkStart)).trim();
}
