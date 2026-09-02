// Prompt builders for the three review one-shot agents.
//
// All three are `claude -p` runs whose stdout the frontend consumes as a stream,
// so two of them have to emit machine-readable JSON with nothing around it. The
// parsers in `review-rules.ts` are tolerant of a code fence and trailing prose
// anyway, but asking for clean output is what keeps the common case cheap.
import type { RuntimeReviewAnnotation, RuntimeReviewRule } from "../core/api-contract";
import { expandReviewCommand } from "./review-command-expansion";
import type { ReviewGraphFreshness, ReviewGraphImpact, ReviewGraphImpactComponent } from "./review-graph";

/** Budget for the rules text pasted into an audit prompt, in characters. */
const RULES_PROMPT_BUDGET = 24_000;
/** Budget for the patches pasted into an audit prompt, in characters. */
const DIFF_PROMPT_BUDGET = 60_000;
/** Budget for reviewer annotations pasted into prompts, in characters. */
export const ANNOTATIONS_PROMPT_BUDGET = 8_000;

/**
 * The knowledge-graph brief, rendered for a prompt.
 *
 * The point of handing this to the agent pre-computed is that the alternative —
 * letting it grep `.ua/knowledge-graph.json` — costs a search budget against a
 * 24 MB file for an answer that is a deterministic graph walk. So the brief has to
 * be *complete enough to be trusted*: it says what it looked at, what it could not
 * match, and how much it dropped, because an agent that suspects the list is
 * partial will go and grep anyway.
 */
function formatImpactComponent(component: ReviewGraphImpactComponent): string {
	const location = component.filePath ?? "(no file)";
	const label = component.name === location ? location : `${location} · ${component.name}`;
	const via = component.via ? ` — reached via \`${component.via}\`` : "";
	const summary = component.summary ? `\n  ${component.summary}` : "";
	// `related` is the one direction worth naming inline: it is in the dependents list
	// but the graph never said which way round it runs, so it deserves less weight.
	const uncertain = component.direction === "related" ? " (direction unknown)" : "";
	return `- [${component.type}] ${label}${via}${uncertain}${summary}`;
}

export function formatGraphImpactForPrompt(input: {
	impact: ReviewGraphImpact;
	freshness?: ReviewGraphFreshness | null;
}): string {
	const { impact, freshness } = input;
	const lines: string[] = [
		"## Knowledge-graph impact",
		"",
		`Derived from this project's Understand Anything knowledge graph (\`${impact.dataDir}\`) by walking one hop out from the changed files. It is already complete for one hop — do not search the repository or read the graph file to reproduce it.`,
		"",
	];

	if (impact.changed.length > 0) {
		lines.push("### Changed components", "", impact.changed.map(formatImpactComponent).join("\n"), "");
	}

	if (impact.affected.length > 0) {
		lines.push(
			"### Dependents (one hop out — these depend on the changed code, so these are what may break)",
			"",
			impact.affected.map(formatImpactComponent).join("\n"),
			"",
		);
		if (impact.affectedOmitted > 0) {
			lines.push(
				`(${impact.affectedOmitted} further dependents omitted, ranked lower by edge weight and complexity.)`,
				"",
			);
		}
	} else {
		lines.push("### Dependents", "", "None: nothing in the graph depends on the changed nodes.", "");
	}

	// Kept separate and shorter on purpose. A dependency is what the change relies
	// on, so it is background for reading the diff — listing it under "affected"
	// would put the change's own import list in the list of things to go and check.
	if (impact.dependencies.length > 0) {
		lines.push(
			"### Dependencies (what the changed code relies on — context, not blast radius)",
			"",
			impact.dependencies.map(formatImpactComponent).join("\n"),
			"",
		);
		if (impact.dependenciesOmitted > 0) {
			lines.push(`(${impact.dependenciesOmitted} further dependencies omitted.)`, "");
		}
	}

	if (impact.layers.length > 0) {
		lines.push(
			`### Layers touched`,
			"",
			impact.layers
				.map((layer) => `- ${layer.name}${layer.description ? ` — ${layer.description}` : ""}`)
				.join("\n"),
			"",
		);
	}

	const caveats: string[] = [];
	if (impact.unmatchedPaths.length > 0) {
		caveats.push(
			`The graph has no node for ${impact.unmatchedPaths.length} changed path(s), so nothing above covers them: ${impact.unmatchedPaths
				.slice(0, 12)
				.join(", ")}${impact.unmatchedPaths.length > 12 ? ", …" : ""}. New files are the usual reason.`,
		);
	}
	if (freshness?.isStale) {
		caveats.push(
			`The graph was built at ${freshness.graphCommit?.slice(0, 8) ?? "an unknown commit"} and ${
				freshness.changedSinceGraphCount
			} project file(s) have changed since, so the impact above may be incomplete.`,
		);
	} else if (freshness?.error) {
		caveats.push(`Graph freshness could not be checked: ${freshness.error}`);
	}
	if (caveats.length > 0) {
		lines.push("### Caveats", "", caveats.map((caveat) => `- ${caveat}`).join("\n"), "");
	}

	return lines.join("\n").trimEnd();
}

export function buildRulesExtractPrompt(input: { sourceRoots: string[] }): string {
	return `Read the team's engineering guidelines and lint configuration at these paths, then extract every enforceable rule you find.

Paths to read (some are files, some are directories — read every markdown file in a directory):
${input.sourceRoots.map((root) => `- ${root}`).join("\n")}

Output a single JSON array and NOTHING else — no prose before or after, no code fence. Each element:

{
  "id": "PY-NAMING-01",
  "title": "Do not abbreviate identifiers",
  "category": "Naming",
  "severity": "MEDIUM",
  "summary": "One or two sentences on what the rule requires and why.",
  "antiPattern": "the shortest code snippet that violates it",
  "bestPractice": "the shortest code snippet that satisfies it",
  "sourcePath": "/abs/path/to/the/file/it/came/from.md",
  "sourceAnchor": "## The heading, or the config key, the rule sits under"
}

Rules for the extraction itself:

- \`severity\` must be exactly one of CRITICAL, HIGH, MEDIUM, LOW. Reserve CRITICAL for security and data-loss rules.
- \`id\` must be unique, stable and readable: a short domain prefix plus a number.
- \`sourcePath\` and \`sourceAnchor\` are mandatory and must be real. A reviewer will cite this rule in a merge request, and a citation that cannot be traced back to the document reads as personal opinion. Never invent a path.
- \`antiPattern\` and \`bestPractice\` must be code, not description. If the source document gives no example, write the shortest one you can that is faithful to the rule.
- Lint configuration counts: a selected ruff/eslint rule with a per-file ignore is a real rule. Use the rule code as the id and the config file as the source.
- Skip anything that is not checkable against a diff — team process, meeting cadence, ticket hygiene.
- Prefer 20 sharp rules over 200 restatements of a style guide.`;
}

/**
 * Rules are trimmed to a budget before they reach the prompt. A 300-rule bundle
 * would crowd out the diff itself, and a review that cannot see the code is
 * worse than one that checks fewer rules.
 */
export function formatRulesForPrompt(rules: RuntimeReviewRule[], budget = RULES_PROMPT_BUDGET): string {
	const lines: string[] = [];
	let used = 0;
	let omitted = 0;
	for (const rule of rules) {
		const line = `- ${rule.id} [${rule.severity}] ${rule.title}: ${rule.summary} (anti-pattern: ${rule.antiPattern})`;
		if (used + line.length > budget) {
			omitted += 1;
			continue;
		}
		lines.push(line);
		used += line.length;
	}
	if (omitted > 0) {
		lines.push(`- (${omitted} further rules omitted for length)`);
	}
	return lines.join("\n");
}

export function formatDiffsForPrompt(
	files: Array<{ newPath: string; diff: string }>,
	budget = DIFF_PROMPT_BUDGET,
): { text: string; omittedPaths: string[] } {
	const blocks: string[] = [];
	const omittedPaths: string[] = [];
	let used = 0;
	for (const file of files) {
		const block = `### ${file.newPath}\n\n\`\`\`diff\n${file.diff}\n\`\`\``;
		if (used + block.length > budget) {
			omittedPaths.push(file.newPath);
			continue;
		}
		blocks.push(block);
		used += block.length;
	}
	return { text: blocks.join("\n\n"), omittedPaths };
}

/** One line per annotation, budget-capped like `formatRulesForPrompt`. */
export function formatAnnotationsForPrompt(
	annotations: RuntimeReviewAnnotation[],
	currentHeadSha?: string | null,
	budget = ANNOTATIONS_PROMPT_BUDGET,
): string {
	const lines: string[] = [];
	let used = 0;
	let omitted = 0;
	for (const annotation of annotations) {
		const isOldSide = annotation.newLine === null && annotation.oldLine !== null;
		const end = isOldSide ? annotation.oldLine : annotation.newLine;
		const start = isOldSide ? annotation.lineRange?.startOldLine : annotation.lineRange?.startNewLine;
		const range = start != null && start !== end ? `${start}-${end}` : `${end}`;
		const side = isOldSide ? "old/deleted side" : "new side";
		const note = annotation.note.length > 0 ? ` — Note: "${annotation.note}"` : "";
		const stale =
			currentHeadSha && annotation.headSha && annotation.headSha !== currentHeadSha
				? " (added against an earlier revision — line numbers may have shifted)"
				: "";
		const line = `- [${annotation.id}] ${annotation.newPath}:${range} (${side}) — Tag: ${annotation.tag.label}${note}${stale}`;
		if (used + line.length > budget) {
			omitted += 1;
			continue;
		}
		lines.push(line);
		used += line.length;
	}
	if (omitted > 0) {
		lines.push(`- (${omitted} further annotations omitted for length)`);
	}
	return lines.join("\n");
}

export function buildAuditPrompt(input: {
	title: string;
	sourceBranch: string;
	targetBranch: string;
	rules: RuntimeReviewRule[];
	files: Array<{ newPath: string; diff: string }>;
	/**
	 * Pre-computed blast radius from the project's knowledge graph. Absent when the
	 * project has never been analyzed, which must read as "no graph", not "no impact".
	 */
	graphImpact?: string;
	annotations?: RuntimeReviewAnnotation[];
}): string {
	const { text: diffText, omittedPaths } = formatDiffsForPrompt(input.files);
	const omittedNote =
		omittedPaths.length > 0
			? `\n\nNot included for length (do not report findings on these): ${omittedPaths.join(", ")}`
			: "";
	// Placed after the patches and before the output contract: the diff is still the
	// evidence, and the graph is context for judging how much a violation costs.
	const graphSection = input.graphImpact ? `\n\n${input.graphImpact}` : "";
	const annotationsSection =
		input.annotations && input.annotations.length > 0
			? `\n\n## Reviewer annotations\n\nThe reviewer flagged these spots by hand before running this review. Each is a hunch, not a confirmed defect.\n\n${formatAnnotationsForPrompt(input.annotations)}`
			: "";
	const verdictContract =
		input.annotations && input.annotations.length > 0
			? `\n- In the SAME array, additionally include exactly one verdict element per reviewer annotation listed above, shaped {"annotationId": "<the id in brackets>", "verdict": "confirmed" | "not_an_issue" | "partial", "reasoning": "one or two sentences"}. Echo the annotationId exactly as given. A verdict element never replaces a normal finding: when you confirm an annotation, also emit the finding as usual.`
			: "";

	return `You are reviewing a merge request against the team's own rules. Report only what the diff actually shows.

Merge request: ${input.title}
Branch: ${input.sourceBranch} → ${input.targetBranch}

## Team rules

${formatRulesForPrompt(input.rules)}

## Changed files

${diffText}${omittedNote}${graphSection}${annotationsSection}

## Output

A single JSON array and NOTHING else — no prose, no code fence. Each element:

{
  "newPath": "src/services/payment_service.py",
  "newLine": 46,
  "ruleId": "RES-02",
  "severity": "HIGH",
  "message": "One or two sentences: what is wrong here and what to do instead."
}

Rules for the review itself:

- \`newLine\` must be a line number that appears on the RIGHT side of the diff above (an added or unchanged line). A finding on a line that no longer exists cannot be posted.
- \`ruleId\` must be an id from the rules list, or null when the problem is real but no listed rule covers it. Never invent an id.
- Report a rule violation only when the diff demonstrates it. Do not guess about code you were not shown, and do not report the absence of something outside these files.
- Correctness and security problems outrank style. If the diff is clean, return an empty array — a padded review is worse than a short one.
- One finding per problem. Do not restate the same issue per line of a block.
- The knowledge-graph section, when present, tells you what depends on the changed code. Use it to judge severity and to say *what* a change breaks, and cite the dependent by path in the message. It is not evidence of a defect on its own: a finding must still be anchored to a line in the diff above, never to an affected file you were not shown.${verdictContract}`;
}

/**
 * Persona for the review chat, passed as `--append-system-prompt`.
 *
 * This exists because the panel used to read as an autonomous reviewer: with the
 * merge request's diff stapled under every message and no role framing at all,
 * `hello` looked exactly like "review this" and got a full review back. The
 * instructions below are deliberately about *restraint* rather than capability —
 * the human is the reviewer, and an assistant that volunteers findings is doing
 * their job instead of helping with it.
 */
export const REVIEW_CHAT_SYSTEM_PROMPT = `You are a pair-reviewing assistant helping a human reviewer read a merge request. The human is the reviewer: they decide what is a problem, they write the verdict, they approve or request changes. You help them read faster.

How to answer:

- Answer exactly what was asked, at the length the question deserves. A greeting gets a greeting. A yes/no question gets a yes or no and one sentence. Do not open with a summary of the merge request.
- Never volunteer findings. Do not list issues, do not rate the change, do not append "a few things I noticed" to an answer about something else. If you see something alarming while answering, you may mention it in one short sentence — once, not as a list.
- Never produce a review unless you were asked for one. A slash command — /simplify, or one of the project's own commands from its \`.claude/commands\` — IS being asked for one; a question is not. So is a request that arrives already spelled out as a scoped review instruction: the panel expands its own /understand-diff, /security-review and /code-review into one before sending, because those three resolve against a working tree that does not have this branch checked out.
- When the reviewer runs a project command, or the panel sends an expanded one, follow that instruction's scope, not these. It was written for this repository or this diff and it outranks the restraint rules above; only the "never modify a file" rule still holds.
- The merge request branch is not checked out. Never run git to discover what changed — the diff you are given is the change — and never tell the reviewer to check a branch out to proceed.
- You are given the lines the reviewer is currently looking at. Prefer them. When a question is clearly about the selected lines, do not widen the answer to the whole file.
- Say when you do not know or cannot see the relevant code, rather than inferring from the diff alone.
- You are reading, not editing. Never modify, create or delete a file in the repository, and never run a command that would.

On "what else does this affect":

- When a knowledge-graph impact section is in your context, it is the answer. It was produced by walking the project's graph one hop out from the changed files, it is complete for that hop, and it names its own gaps. Answer from it directly.
- Do not grep or read the knowledge graph file yourself. It is tens of megabytes, the walk has already been done, and a search over it is the most expensive thing you can do in this panel.
- Do not fall back to a repository-wide search for callers either. If the graph section is absent or does not cover the path in question, say that the graph has no entry for it and offer to look at a specific file the reviewer names — one targeted read, not a sweep.
- Never present a graph-derived dependency as a confirmed defect. "\`x.py\` imports this and passes two arguments" needs a look at \`x.py\` before it becomes "this breaks \`x.py\`".`;

/** Fence the chat asks for structured suggestions in. Distinct from \`json\` so a
 * code sample in the prose can never be mistaken for the payload. */
export const REVIEW_SUGGESTIONS_FENCE = "suggestions";

/**
 * Appended when the reviewer runs one of the review slash commands. Those *are* a
 * request for findings, and findings the panel can position are worth far more
 * than prose: they become draft comments in one click.
 */
export const REVIEW_SUGGESTIONS_OUTPUT_CONTRACT = `---

After your answer, if — and only if — you identified specific problems the reviewer could raise as comments, append one fenced block:

\`\`\`${REVIEW_SUGGESTIONS_FENCE}
[
  {
    "newPath": "src/services/payment_service.py",
    "newLine": 46,
    "severity": "HIGH",
    "message": "One or two sentences: what is wrong here and what to do instead."
  }
]
\`\`\`

- \`newLine\` must be a line that exists on the RIGHT side of the diff (added or unchanged). A suggestion on a line that no longer exists cannot be posted as a comment.
- \`severity\` is one of CRITICAL, HIGH, MEDIUM, LOW.
- Omit the block entirely when you have nothing positionable. An empty array and a padded list are both worse than no block.
- The block is for the reviewer to triage. It does not replace your answer, and nothing in it is published without them accepting it.`;

/** The lines the reviewer has selected in the diff pane, plus what is on screen. */
export interface ReviewScreenContext {
	path: string;
	side: "old" | "new";
	startLine: number;
	endLine: number;
	text: string;
}

export interface ReviewVisibleRange {
	path: string;
	startLine: number;
	endLine: number;
}

function formatScreenContext(input: { screen?: ReviewScreenContext; visible?: ReviewVisibleRange }): string | null {
	if (input.screen) {
		const { path, side, startLine, endLine, text } = input.screen;
		const range = startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
		return `The reviewer has selected ${path}:${range} (${side} side of the diff) and is asking about it:\n\n\`\`\`\n${text}\n\`\`\``;
	}
	if (input.visible) {
		const { path, startLine, endLine } = input.visible;
		return `The reviewer is scrolled to ${path}:${startLine}-${endLine}. Nothing is selected, so treat the question as being about the file unless it names something else.`;
	}
	return null;
}

export function buildChatPrompt(input: {
	prompt: string;
	title: string;
	sourceBranch: string;
	targetBranch: string;
	changedPaths: string[];
	activeDiff?: string;
	/**
	 * Every changed file's patch. Only the merge-request-scoped commands get this, and
	 * when they do it replaces `activeDiff` and the selection — a pass told to read the
	 * whole change should not also be handed "but look here first".
	 */
	allDiffs?: Array<{ newPath: string; diff: string }>;
	/**
	 * The project's extracted rules, for the whole-merge-request review. Empty or
	 * absent has to read as "this project has no rules bundle", which the expansion
	 * turns into "do not invent a house style" rather than silence.
	 */
	rules?: RuntimeReviewRule[];
	screen?: ReviewScreenContext;
	visible?: ReviewVisibleRange;
	/**
	 * False on a resumed turn. The merge request context is in the session already,
	 * so repeating it costs the whole diff again per message — and it was that
	 * per-message diff dump that made the panel read as a reviewer rather than an
	 * assistant in the first place.
	 */
	isFirstTurn: boolean;
	/** Ask for the machine-readable suggestions block (slash commands only). */
	expectSuggestions?: boolean;
	annotations?: RuntimeReviewAnnotation[];
	/**
	 * Pre-computed blast radius from the project's knowledge graph. First turn for the
	 * same reason the diff is — on a resumed turn it is already in the session — plus
	 * any turn running a command that is meant to answer *from* it, since by then the
	 * session's copy was walked for whichever file was on screen at the start. Its
	 * absence also changes the wording of an expanded command, so that a command is
	 * never told to read a section it was not given.
	 */
	graphImpact?: string;
}): string {
	const screenBlock = formatScreenContext(input);

	// `/understand-diff`, `/security-review` and `/code-review` are expanded here
	// rather than sent for the CLI to expand — see `review-command-expansion.ts` for
	// why all three had to be. Everything else (a question, `/simplify`, a command
	// from the project's own `.claude/commands`) still goes first and verbatim,
	// because a slash command has to open the prompt to register as one, which is why
	// context is appended below the reviewer's text rather than prepended.
	const expansion = expandReviewCommand(input.prompt, {
		hasGraphImpact: input.graphImpact !== undefined,
		hasRules: (input.rules?.length ?? 0) > 0,
	});
	const parts: string[] = [expansion?.text ?? input.prompt];

	// An expanded command re-sends the context even mid-conversation. Its whole
	// instruction is "answer from what is below", and on a resumed turn the diff and
	// the brief in the session belong to whichever file was on screen when the
	// conversation started — not the one the reviewer is now looking at.
	if (input.isFirstTurn || expansion !== null) {
		// The two whole-merge-request passes read every patch, and deliberately drop the
		// selection with it: handing "read all of this" a pointer at twenty lines is how
		// a full review quietly turns into a review of one hunk.
		const isMergeRequestScope = expansion?.scope === "merge-request" && (input.allDiffs?.length ?? 0) > 0;
		const allDiffs = isMergeRequestScope ? formatDiffsForPrompt(input.allDiffs ?? []) : null;

		const context = [
			`Merge request under review: ${input.title} (${input.sourceBranch} → ${input.targetBranch})`,
			input.changedPaths.length > 0
				? `Changed files:\n${input.changedPaths.map((path) => `- ${path}`).join("\n")}`
				: null,
			// Rules only where the expansion asked for them, and only when the project has
			// some: an empty "Team rules" heading reads as "this project has no standards"
			// rather than "nobody has extracted them yet".
			isMergeRequestScope && expansion?.needsRules && (input.rules?.length ?? 0) > 0
				? `## Team rules\n\n${formatRulesForPrompt(input.rules ?? [])}`
				: null,
			allDiffs
				? `## Changed files (every patch in this merge request)\n\n${allDiffs.text}${
						allDiffs.omittedPaths.length > 0
							? `\n\nNot included for length, so do not report findings on these: ${allDiffs.omittedPaths.join(", ")}`
							: ""
					}`
				: null,
			// Only when nothing is selected: a selection is the more precise answer to
			// "what is the reviewer looking at", and sending both wastes the budget the
			// selection exists to save.
			!isMergeRequestScope && input.activeDiff && !input.screen
				? `Diff of the file the reviewer is looking at:\n\n\`\`\`diff\n${input.activeDiff}\n\`\`\``
				: null,
			isMergeRequestScope ? null : screenBlock,
			(input.annotations?.length ?? 0) > 0
				? `## Reviewer-flagged spots\n\nThe reviewer marked these places as suspect before this run. Pay extra attention to them and address them where relevant to this request. They are hunches, not confirmed defects — it is fine to conclude one is not a problem, but say so.\n\n${formatAnnotationsForPrompt(input.annotations ?? [])}`
				: null,
			input.graphImpact ?? null,
		]
			.filter((part): part is string => part !== null)
			.join("\n\n");

		parts.push(
			`---

Context for the request above (the reviewer is reading a merge request, not editing files — do not modify anything):

${context}`,
		);
	} else if (screenBlock !== null) {
		parts.push(`---

${screenBlock}`);
	}

	if (input.expectSuggestions) {
		parts.push(REVIEW_SUGGESTIONS_OUTPUT_CONTRACT);
	}

	return parts.join("\n\n");
}

/**
 * Rewrites something the assistant said into a comment the reviewer can publish.
 *
 * The raw text is an answer in a conversation — it says "this could overflow if
 * the caller passes a negative count", which reads oddly as a review note. This
 * pass turns it into the note. It is a separate run rather than part of the chat
 * turn because the reviewer triggers it *after* reading the answer, on the part
 * they chose, and because a failure here has to be able to fall back to the raw
 * text without disturbing the conversation.
 */
export function buildSuggestionRewritePrompt(input: {
	rawText: string;
	newPath: string;
	line: number;
	diffExcerpt?: string;
}): string {
	const excerpt = input.diffExcerpt ? `\n\nThe line it is anchored to:\n\n\`\`\`\n${input.diffExcerpt}\n\`\`\`` : "";

	return `Rewrite the note below as a merge-request review comment on ${input.newPath}:${input.line}.

Note to rewrite:

"""
${input.rawText}
"""${excerpt}

Rules:

- Output the comment text and nothing else. No preamble, no quotes around it, no markdown heading.
- Address the author directly and say what to change. Not "this could overflow" but "guard against a negative \`count\` here — it currently underflows the buffer".
- One issue. If the note covers several, keep the one anchored to this line.
- Two or three sentences at most. A reviewer's comment is read in a narrow column next to the code.
- Do not invent a cause, a severity or a rule citation that is not in the note.
- Keep any code identifier exactly as written, in backticks.`;
}
