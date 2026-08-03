import type { RuntimeTaskSessionSummary } from "../core/api-contract";

/** Bytes written to a live session to pause it — ESC interrupts the agent's current turn (like the keyboard). */
export const PAUSE_INTERRUPT_INPUT = "\x1b";
/** Bytes written to a live session to resume it — a "continue" prompt submitted with a newline. */
export const PAUSE_RESUME_INPUT = "continue\n";

/**
 * Active-run stopwatch for a task session.
 *
 * A session accrues time only while it is actually running. `activeRunMs` holds
 * the sum of every completed running segment; `runningSince` is the epoch the
 * current segment started (null whenever the clock is frozen — awaiting review,
 * idle, done, or manually paused). Live elapsed is therefore:
 *   `activeRunMs + (runningSince != null ? now - runningSince : 0)`.
 *
 * The helpers below are pure so both session backends (terminal + Cline) and the
 * unit tests share one source of truth.
 */

type RunTiming = Pick<RuntimeTaskSessionSummary, "state" | "activeRunMs" | "runningSince">;

function accumulate(summary: RunTiming, nowTs: number): number {
	const since = summary.runningSince ?? nowTs;
	return (summary.activeRunMs ?? 0) + Math.max(0, nowTs - since);
}

/**
 * Derive the timing fields to merge into a `patch` when a summary's `state` changes.
 * Entering `running` starts the stopwatch; leaving it banks the elapsed segment.
 * Returns `{}` when the patch doesn't cross a running boundary, so callers can
 * spread it unconditionally. Explicit `patch` values still win (spread patch last).
 */
export function computeRunTimingPatch(
	summary: RuntimeTaskSessionSummary,
	patch: Partial<RuntimeTaskSessionSummary>,
	nowTs: number,
): Partial<RuntimeTaskSessionSummary> {
	if (patch.state === undefined || patch.state === summary.state) {
		return {};
	}
	const wasRunning = summary.state === "running";
	const willRun = patch.state === "running";
	if (wasRunning && !willRun) {
		return { activeRunMs: accumulate(summary, nowTs), runningSince: null };
	}
	if (!wasRunning && willRun) {
		return { runningSince: nowTs };
	}
	return {};
}

/**
 * Freeze the stopwatch without changing `state` — used by manual/force pause,
 * where the agent's turn is interrupted (Esc) but the session stays `running`.
 */
export function freezeRunTimingPatch(
	summary: RuntimeTaskSessionSummary,
	nowTs: number,
): Partial<RuntimeTaskSessionSummary> {
	return { activeRunMs: accumulate(summary, nowTs), runningSince: null };
}

/** Restart the stopwatch after a manual/force pause (resume). */
export function resumeRunTimingPatch(nowTs: number): Partial<RuntimeTaskSessionSummary> {
	return { runningSince: nowTs };
}

/** Live elapsed active-run time for display / max-runtime checks. */
export function liveElapsedMs(summary: RunTiming, nowTs: number): number {
	return (summary.activeRunMs ?? 0) + (summary.runningSince != null ? Math.max(0, nowTs - summary.runningSince) : 0);
}
