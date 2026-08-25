// Prompt builders for the three review one-shot agents.
//
// All three are `claude -p` runs whose stdout the frontend consumes as a stream,
// so two of them have to emit machine-readable JSON with nothing around it. The
// parsers in `review-rules.ts` are tolerant of a code fence and trailing prose
// anyway, but asking for clean output is what keeps the common case cheap.
import type { RuntimeReviewRule } from "../core/api-contract";

/** Budget for the rules text pasted into an audit prompt, in characters. */
const RULES_PROMPT_BUDGET = 24_000;
/** Budget for the patches pasted into an audit prompt, in characters. */
const DIFF_PROMPT_BUDGET = 60_000;

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

export function buildAuditPrompt(input: {
	title: string;
	sourceBranch: string;
	targetBranch: string;
	rules: RuntimeReviewRule[];
	files: Array<{ newPath: string; diff: string }>;
}): string {
	const { text: diffText, omittedPaths } = formatDiffsForPrompt(input.files);
	const omittedNote =
		omittedPaths.length > 0
			? `\n\nNot included for length (do not report findings on these): ${omittedPaths.join(", ")}`
			: "";

	return `You are reviewing a merge request against the team's own rules. Report only what the diff actually shows.

Merge request: ${input.title}
Branch: ${input.sourceBranch} → ${input.targetBranch}

## Team rules

${formatRulesForPrompt(input.rules)}

## Changed files

${diffText}${omittedNote}

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
- One finding per problem. Do not restate the same issue per line of a block.`;
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
- Never produce a review unless you were asked for one. A slash command (/code-review, /security-review, /simplify, /understand-diff) IS being asked for one; a question is not.
- You are given the lines the reviewer is currently looking at. Prefer them. When a question is clearly about the selected lines, do not widen the answer to the whole file.
- Say when you do not know or cannot see the relevant code, rather than inferring from the diff alone.
- You are reading, not editing. Never modify, create or delete a file in the repository, and never run a command that would.`;

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
}): string {
	const screenBlock = formatScreenContext(input);

	// The reviewer's text goes first and verbatim: a leading `/understand-diff` or
	// `/security-review` has to be the start of the prompt to register as a slash
	// command, so context is appended below it rather than prepended.
	const parts: string[] = [input.prompt];

	if (input.isFirstTurn) {
		const context = [
			`Merge request under review: ${input.title} (${input.sourceBranch} → ${input.targetBranch})`,
			input.changedPaths.length > 0
				? `Changed files:\n${input.changedPaths.map((path) => `- ${path}`).join("\n")}`
				: null,
			// Only when nothing is selected: a selection is the more precise answer to
			// "what is the reviewer looking at", and sending both wastes the budget the
			// selection exists to save.
			input.activeDiff && !input.screen
				? `Diff of the file the reviewer is looking at:\n\n\`\`\`diff\n${input.activeDiff}\n\`\`\``
				: null,
			screenBlock,
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
