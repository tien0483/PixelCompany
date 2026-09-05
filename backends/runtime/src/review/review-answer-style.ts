/**
 * How the review chat *writes*, as opposed to what it is allowed to say.
 *
 * `REVIEW_CHAT_SYSTEM_PROMPT` is about restraint — whose job it is to decide what is
 * a problem — and it says nothing about form beyond "at the length the question
 * deserves". That turned out to be the whole readability complaint: a follow-up about
 * whether one reviewer comment held up came back as seven paragraphs that
 * re-litigated the assistant's own earlier position, with the verdict sixth.
 *
 * The obvious lever — the machine-wide caveman SessionStart hook in
 * `~/.claude/settings.json` — cannot reach this surface: the review spawn pins
 * `CLAUDE_CONFIG_DIR` to a Manager seat launch dir, so a different hook set applies,
 * and the hook is machine-local anyway. The style therefore lives here and rides the
 * `--append-system-prompt` string the runtime already passes.
 *
 * Deliberately scoped to the *chat* pass. The audit, rules-extraction and
 * comment-polish passes keep their own prompts: their output is either a parsed
 * payload or wording that gets published to other humans.
 */
import { REVIEW_CHAT_SYSTEM_PROMPT } from "./review-prompts";

/**
 * Appended when the reviewer has terse mode on (the default).
 *
 * The "never narrate revising yourself" rule is the one that does the most work. The
 * motivating answer spent three of its seven paragraphs on "I pitched it too high" /
 * "what I underweighted" — a correction addressed to the assistant's own previous
 * draft, which the reviewer never saw and does not care about.
 *
 * The carve-outs are not politeness. The `suggestions` fence becomes a published
 * review comment on someone else's merge request, and a security finding or a
 * multi-step instruction read with the conjunctions dropped is a different
 * instruction.
 */
export const REVIEW_TERSE_STYLE_PROMPT = `How to write, this session:

- Verdict first line. No preamble, no restating the question, no "great question", no closing summary.
- Compress: drop articles, filler and hedging. Sentence fragments are fine. Prefer \`[thing] [action] [reason].\` — "Comment holds. Line 199 needs Path. \`/\` on str is a TypeError."
- Never narrate revising yourself. No "I pitched it too high", "what I underweighted", "on reflection", "to be fair". The reviewer never saw your earlier draft. Give the answer you have now, once.
- Do not weigh both sides in prose. Say what holds, say what does not, in that order, and stop.
- Every claim about code carries \`path:line\`. A claim you cannot locate is a claim you should not make.
- Headings only past three distinct points. Two points are two lines.

Never compressed, in any mode:

- Code blocks, quoted error strings, command lines, file paths and identifiers. Reproduce them exactly.
- The \`suggestions\` fence, and inside it the \`message\` and \`reasoning\` fields. Those are published to other people as review comments, so they stay ordinary, complete English sentences. The compression is for the reviewer reading this panel, not for the merge request.
- Security findings, and any instruction with an order to it (do X, then Y). Write those as normal prose: a dropped conjunction there changes what was said.`;

/**
 * The `--append-system-prompt` string for a chat turn.
 *
 * Terse is a separate block rather than an edit to the persona because the two answer
 * different questions and the reviewer can turn only one of them off.
 */
export function buildReviewChatSystemPrompt(options: { terse: boolean }): string {
	if (!options.terse) {
		return REVIEW_CHAT_SYSTEM_PROMPT;
	}
	return `${REVIEW_CHAT_SYSTEM_PROMPT}\n\n${REVIEW_TERSE_STYLE_PROMPT}`;
}
