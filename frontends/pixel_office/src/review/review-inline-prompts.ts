import { Network, ScanSearch } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The one-click prompts above the composer.
 *
 * Deliberately not slash commands. A slash command is resolved by the CLI from the
 * *reviewed* checkout's `.claude/commands`, or from a pinned seat's own config dir —
 * so one that exists for one project silently does not for the next, which is exactly
 * how a repo's `/review` ends up being the only review affordance a reviewer can find.
 * These travel with the panel and work on every project.
 *
 * `expectSuggestions` is carried per entry rather than sniffed from a leading slash the
 * way `isReviewCommandPrompt` does it: there is no slash here to sniff, and whether an
 * answer should come back as triageable findings is a property of the prompt.
 */
export interface ReviewInlinePrompt {
	id: string;
	label: string;
	icon: LucideIcon;
	/** Tooltip text. */
	hint: string;
	prompt: string;
	/** Append the machine-readable suggestions contract, so findings become draft comments. */
	expectSuggestions: boolean;
}

/**
 * A review that stays inside the diff.
 *
 * The scope rules are the substance of this prompt, not preamble. A general review
 * command — `/code-review`, or a project's own `/review` — reads the changed files at
 * their full content, which is how a diff-scoped request turns into a whole-file audit
 * that reports pre-existing problems the author never touched. Every clause below
 * exists to close one of the routes back out of the diff: `git show <ref>:<path>`,
 * reading the file with the file tool, following an import, or flagging an untouched
 * line the hunk happens to display.
 */
const DIFF_ONLY_REVIEW_PROMPT = `Review this merge request, and review ONLY the diff.

Scope. This is the point of the request, so do not widen it:

- Work from the diff between the branches named in the context below: \`git merge-base <target> <source>\` for the base, then \`git diff --stat <base>...<source>\` for the file list and \`git diff <base>...<source> -- <path>\` per file. Never check anything out.
- Read only those hunks and the context lines git already prints around them. Do not read a changed file at its full content — not with \`git show <ref>:<path>\`, not by opening the file — and do not go exploring unchanged files.
- Report problems only on lines this merge request added or modified. A pre-existing problem on an untouched line is out of scope even when a hunk puts it on screen; say it exists if it is severe, but do not raise it as a finding on this change.
- When a hunk cannot be judged without context the diff does not contain, say so and name what you would need. Do not fetch it, and do not guess.
- If git is not usable here — no local checkout, or those branches are not present — review the diff already in your context, and open by naming the changed files you therefore could not see. Do not substitute a full-file read for the missing diff.

What to look for, in this order:

1. Bugs the change introduces — logic errors, off-by-one, null/undefined paths, unhandled errors, a broken invariant, a leaked resource.
2. Security — untrusted input reaching a query, command, path or template; a secret in the diff; an authorization check the change moves or removes.
3. Contract breaks — a signature, return shape, thrown error or default the diff changes without updating what depends on it. Name the dependents you can see in the diff; do not sweep the repository for more.
4. Adherence to guidance that is already in front of you: a CLAUDE.md or AGENTS.md that is itself part of this diff, and comments in the hunks you are reading.

Skip: formatting, naming preferences, missing test coverage, anything a linter or typechecker would catch, and speculative "this could be refactored" notes.

Be brief. One finding per real problem, and no finding at all rather than a padded list.`;

/**
 * Why the blast-radius prompt says "without relying on any pre-built knowledge graph":
 * the runtime already appends a graph-derived impact section when the project has one,
 * and this button is what a reviewer presses when it did not. Grep is the fallback.
 */
const UNDERSTAND_CHANGES_PROMPT = `Analyze how the changes in this merge request affect the broader codebase — without relying on any pre-built knowledge graph.

For each changed file:
1. Use Grep to find all files that import or require it (search for the filename and any exported symbols that were modified).
2. Use Grep to find callers of any functions or classes that were changed.
3. Note which modules are downstream consumers and whether the changes are breaking, additive, or purely internal.

Summarize: which parts of the codebase are affected, what the risk surface is, and whether any callers need updates.`;

export const REVIEW_INLINE_PROMPTS: readonly ReviewInlinePrompt[] = [
	{
		id: "review-diff",
		label: "Review diff only",
		icon: ScanSearch,
		hint: "Review just the added and modified lines — no full-file reads, no pre-existing issues",
		prompt: DIFF_ONLY_REVIEW_PROMPT,
		// Findings on diff lines are positionable by construction, which is the whole
		// reason this one asks for the block and "Understand changes" does not.
		expectSuggestions: true,
	},
	{
		id: "understand-changes",
		label: "Understand changes",
		icon: Network,
		hint: "Explain how these changes affect the broader codebase",
		prompt: UNDERSTAND_CHANGES_PROMPT,
		expectSuggestions: false,
	},
];
