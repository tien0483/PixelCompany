import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import { stripAnsi } from "./output-utils";
import type { SessionTransitionEvent } from "./session-state-machine";
import type {
	AgentOutputTransitionDetector,
	AgentOutputTransitionInspectionPredicate,
} from "./agent-session-adapters";

const MAX_RECENT_CHARS = 8_192;

/** Cursor Agent TUI input chrome — often visible while a turn is still running. */
const IDLE_PROMPT_RE = /Add a follow-up/i;

/** Signals the agent is actively working on a turn. */
const WORK_RE =
	/\bThinking\b|\bGenerating\b|\bRunning\b|\bCalled\b|\bEditing\b|\bReading\b|\bPlanning\b|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/i;

/** Startup chrome that should not count as "the agent worked". */
const BANNER_RE = /Cursor Agent|Tip:\s*Use\s+\/|v\d{4}\.\d{2}\.\d{2}-[0-9a-f]+/i;

/**
 * Quiet time after the last work signal before trusting the idle prompt.
 * Cursor keeps "Add a follow-up" on screen during turns, so matching it
 * immediately would bounce the card to Review mid-run.
 */
export const CURSOR_IDLE_QUIET_MS = 3_500;

export type CursorDeferredEmit = (event: SessionTransitionEvent) => void;

export type CursorOutputTransitionDetector = AgentOutputTransitionDetector & {
	bindDeferredEmit: (emit: CursorDeferredEmit | null) => void;
	dispose: () => void;
};

export interface CreateCursorOutputTransitionDetectorOptions {
	quietMs?: number;
	now?: () => number;
	schedule?: (fn: () => void, ms: number) => () => void;
}

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

function defaultSchedule(fn: () => void, ms: number): () => void {
	const handle = setTimeout(fn, ms);
	return () => {
		clearTimeout(handle);
	};
}

/**
 * Cursor review transitions are driven from TUI output (not `.cursor/hooks.json`).
 * Baking absolute kanban/node paths into project hooks breaks WSL and shipped copies
 * on other machines.
 *
 * "Add a follow-up" alone is not enough — Cursor paints that chrome while still
 * working. Require a quiet gap after the last work signal, then confirm the idle
 * prompt is still present (via a deferred emit when no further PTY chunks arrive).
 */
export function createCursorOutputTransitionDetector(
	options: CreateCursorOutputTransitionDetectorOptions = {},
): CursorOutputTransitionDetector {
	const quietMs = options.quietMs ?? CURSOR_IDLE_QUIET_MS;
	const now = options.now ?? Date.now;
	const schedule = options.schedule ?? defaultSchedule;

	let recent = "";
	let sawWork = false;
	let lastWorkAt = 0;
	let cancelPending: (() => void) | null = null;
	let deferredEmit: CursorDeferredEmit | null = null;

	const cancelScheduledReview = () => {
		if (cancelPending !== null) {
			cancelPending();
			cancelPending = null;
		}
	};

	const tryEmitReview = (summary: RuntimeTaskSessionSummary): SessionTransitionEvent | null => {
		if (summary.state !== "running" || !sawWork) {
			return null;
		}
		if (!IDLE_PROMPT_RE.test(recent)) {
			return null;
		}
		if (now() - lastWorkAt < quietMs) {
			return null;
		}
		return { type: "hook.to_review" };
	};

	const scheduleReviewCheck = (summary: RuntimeTaskSessionSummary) => {
		cancelScheduledReview();
		if (summary.state !== "running" || !sawWork || !IDLE_PROMPT_RE.test(recent)) {
			return;
		}
		const elapsed = now() - lastWorkAt;
		const waitMs = Math.max(0, quietMs - elapsed);
		cancelPending = schedule(() => {
			cancelPending = null;
			const event = tryEmitReview(summary);
			if (event !== null) {
				deferredEmit?.(event);
			}
		}, waitMs);
	};

	const detect: CursorOutputTransitionDetector = ((
		data: string,
		summary: RuntimeTaskSessionSummary,
	): SessionTransitionEvent | null => {
		const plain = stripAnsi(data);
		if (plain.length > 0) {
			recent = `${recent}${plain}`.slice(-MAX_RECENT_CHARS);
		}

		// Only the current chunk can resume in-progress — `recent` still contains
		// older "Thinking..." text after the turn ends and would false-trigger.
		if (WORK_RE.test(plain)) {
			sawWork = true;
			lastWorkAt = now();
			cancelScheduledReview();
			if (summary.state === "awaiting_review") {
				return { type: "hook.to_in_progress" };
			}
			return null;
		}

		if (!sawWork && (WORK_RE.test(recent) || nonBannerTextLength(recent) >= 40)) {
			// Assistant reply text without an explicit spinner still counts as work.
			sawWork = true;
			lastWorkAt = now();
		}

		if (summary.state !== "running" || !sawWork || !IDLE_PROMPT_RE.test(recent)) {
			cancelScheduledReview();
			return null;
		}

		const immediate = tryEmitReview(summary);
		if (immediate !== null) {
			cancelScheduledReview();
			return immediate;
		}

		// Idle chrome is present but the quiet gap has not elapsed yet — wait.
		scheduleReviewCheck(summary);
		return null;
	}) as CursorOutputTransitionDetector;

	detect.bindDeferredEmit = (emit) => {
		deferredEmit = emit;
	};

	detect.dispose = () => {
		cancelScheduledReview();
		deferredEmit = null;
	};

	return detect;
}

export function shouldInspectCursorOutputForTransition(summary: RuntimeTaskSessionSummary): boolean {
	return summary.state === "running" || summary.state === "awaiting_review";
}

export const cursorOutputTransitionInspection: AgentOutputTransitionInspectionPredicate =
	shouldInspectCursorOutputForTransition;

export function isCursorOutputTransitionDetector(
	value: AgentOutputTransitionDetector | null | undefined,
): value is CursorOutputTransitionDetector {
	return (
		typeof value === "function" &&
		typeof (value as CursorOutputTransitionDetector).bindDeferredEmit === "function" &&
		typeof (value as CursorOutputTransitionDetector).dispose === "function"
	);
}
