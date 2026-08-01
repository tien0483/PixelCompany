import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import { stripAnsi } from "./output-utils";
import type { SessionTransitionEvent } from "./session-state-machine";
import type {
	AgentOutputTransitionDetector,
	AgentOutputTransitionInspectionPredicate,
} from "./agent-session-adapters";

const MAX_RECENT_CHARS = 8_192;

/** Cursor Agent TUI idle prompt after a turn finishes (waiting for the user). */
const IDLE_PROMPT_RE = /Add a follow-up/i;

/** Signals the agent is actively working on a turn. */
const WORK_RE =
	/\bThinking\b|\bGenerating\b|\bRunning\b|\bCalled\b|\bEditing\b|\bReading\b|\bPlanning\b|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/i;

/** Startup chrome that should not count as "the agent worked". */
const BANNER_RE = /Cursor Agent|Tip:\s*Use\s+\/|v\d{4}\.\d{2}\.\d{2}-[0-9a-f]+/i;

function nonBannerTextLength(sample: string): number {
	let total = 0;
	for (const line of sample.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed.length === 0 || BANNER_RE.test(trimmed)) {
			continue;
		}
		total += trimmed.length;
	}
	return total;
}

/**
 * Cursor Agent CLI only partially supports `.cursor/hooks.json` lifecycle hooks
 * (`stop` / `afterAgentResponse` are unreliable in the TUI). Detect turn completion
 * from the idle prompt so Kanban can move the card to Review like Claude Stop hooks.
 */
export function createCursorOutputTransitionDetector(): AgentOutputTransitionDetector {
	let recent = "";
	let sawWork = false;

	return (data: string, summary: RuntimeTaskSessionSummary): SessionTransitionEvent | null => {
		const plain = stripAnsi(data);
		if (plain.length > 0) {
			recent = `${recent}${plain}`.slice(-MAX_RECENT_CHARS);
		}

		// Only the current chunk can resume in-progress — `recent` still contains
		// older "Thinking..." text after the turn ends and would false-trigger.
		if (WORK_RE.test(plain)) {
			sawWork = true;
			if (summary.state === "awaiting_review") {
				return { type: "hook.to_in_progress" };
			}
		} else if (!sawWork && (WORK_RE.test(recent) || nonBannerTextLength(recent) >= 40)) {
			// Assistant reply text without an explicit spinner still counts as work.
			sawWork = true;
		}

		if (summary.state === "running" && sawWork && IDLE_PROMPT_RE.test(recent)) {
			return { type: "hook.to_review" };
		}

		return null;
	};
}

export function shouldInspectCursorOutputForTransition(summary: RuntimeTaskSessionSummary): boolean {
	return summary.state === "running" || summary.state === "awaiting_review";
}

export const cursorOutputTransitionInspection: AgentOutputTransitionInspectionPredicate =
	shouldInspectCursorOutputForTransition;
