/**
 * The expander answers with two top-level sections — the user's plan, reorganized, then
 * the brief (see `buildBriefPrompt` in `backends/runtime/src/html/html-brief.ts`). The
 * editor writes the first half back over the plan file, so the split has to be exact:
 * a missed `# Brief` heading would mean pasting the brief into the plan section, and a
 * missed plan section must degrade to "append the brief" rather than overwrite anything.
 */
export interface BriefResult {
	/** The reorganized plan, or null when the model did not emit the `# Plan` section. */
	plan: string | null;
	/** The brief section, `# Brief` heading included. Falls back to the whole answer. */
	brief: string;
}

/** Matches the `# Brief` heading on its own line — the boundary between the two sections. */
const BRIEF_HEADING_PATTERN = /^[ \t]*#[ \t]+Brief[ \t]*$/m;
const PLAN_HEADING_PATTERN = /^[ \t]*#[ \t]+Plan[ \t]*$/m;

export function splitBriefResult(text: string): BriefResult {
	const briefHeading = BRIEF_HEADING_PATTERN.exec(text);
	if (!briefHeading || briefHeading.index === undefined) {
		return { plan: null, brief: text };
	}
	const planSection = text.slice(0, briefHeading.index);
	const brief = text.slice(briefHeading.index);
	// A `# Brief` with nothing above it is the old single-section answer, not a rewrite:
	// treating an empty plan half as authoritative would blank the user's file.
	if (!PLAN_HEADING_PATTERN.test(planSection) || planSection.trim() === "") {
		return { plan: null, brief: text };
	}
	return { plan: planSection.trim(), brief: brief.trim() };
}
