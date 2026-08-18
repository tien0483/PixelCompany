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

export function buildChatPrompt(input: {
	prompt: string;
	title: string;
	sourceBranch: string;
	targetBranch: string;
	changedPaths: string[];
	activeDiff?: string;
}): string {
	// The reviewer's text goes first and verbatim: a leading `/understand-diff` or
	// `/security-review` has to be the start of the prompt to register as a slash
	// command, so context is appended below it rather than prepended.
	const context = [
		`Merge request under review: ${input.title} (${input.sourceBranch} → ${input.targetBranch})`,
		input.changedPaths.length > 0
			? `Changed files:\n${input.changedPaths.map((path) => `- ${path}`).join("\n")}`
			: null,
		input.activeDiff
			? `Diff of the file the reviewer is looking at:\n\n\`\`\`diff\n${input.activeDiff}\n\`\`\``
			: null,
	]
		.filter((part): part is string => part !== null)
		.join("\n\n");

	return `${input.prompt}

---

Context for the request above (the reviewer is reading a merge request, not editing files — do not modify anything):

${context}`;
}
