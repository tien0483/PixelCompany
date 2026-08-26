import { Network, ScanSearch } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
	REVIEW_CODE_REVIEW_DIFF_COMMAND,
	REVIEW_UNDERSTAND_CHANGES_COMMAND,
} from "@/components/review/review-chat-composer";

/**
 * The one-click passes above the composer. Both read the *whole* merge request, which
 * is why they are buttons and the chips beside them are scoped to what is on screen.
 *
 * Neither is a CLI slash command. A slash command is resolved by Claude Code from the
 * *reviewed* checkout's `.claude/commands`, or from a pinned seat's own config dir —
 * so one that exists for one project silently does not for the next, which is how a
 * repo's `/review` ends up being the only review affordance a reviewer can find, and
 * how `/understand-diff` answered `Unknown command` on a checkout without the stack's
 * skills. These names are expanded by the *runtime* instead
 * (`backends/runtime/src/review/review-command-expansion.ts`), which is also what
 * gives them their context: every patch in the merge request travels inline, the
 * project's rules bundle is attached where the pass asks for it, and the knowledge
 * graph brief is walked before the prompt is built.
 *
 * Sending a short name rather than the prose has a second benefit worth keeping: the
 * transcript shows `/code-review-diff` instead of forty lines of instruction, and the
 * run indicator on each button is just "is that message in this conversation".
 *
 * `expectSuggestions` is carried per entry rather than sniffed from the leading slash
 * the way `isReviewCommandPrompt` does it: whether an answer should come back as
 * triageable findings is a property of the pass, not of its spelling.
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

export const REVIEW_INLINE_PROMPTS: readonly ReviewInlinePrompt[] = [
	{
		id: "code-review-diff",
		label: "Code Review Diff",
		icon: ScanSearch,
		hint: "Senior review of every patch in this merge request — the project's own rules where they exist, only the lines it changed, ending in a merge verdict",
		prompt: REVIEW_CODE_REVIEW_DIFF_COMMAND,
		// Findings on diff lines are positionable by construction, which is the whole
		// reason this one asks for the block and "Understand changes" does not.
		expectSuggestions: true,
	},
	{
		id: "understand-changes",
		label: "Understand changes",
		icon: Network,
		hint: "What this merge request touches and what may break — read from the project's knowledge graph, searching only for the paths the graph has never heard of",
		prompt: REVIEW_UNDERSTAND_CHANGES_COMMAND,
		expectSuggestions: false,
	},
];
