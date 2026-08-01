// Pure decision logic for auto-pausing a task that hit the Claude usage limit and
// scheduling its --continue resume once the window resets.
//
// The runtime's exit paths (terminal PTY + native Cline) call classifyUsagePause with
// the task's opt-in flag, its optional pinned account, the last-known jacked snapshot,
// and any agent error text. When it returns a result, the session is parked as
// "usage_paused" with `resumeAt` instead of a plain error, and the usage-resume
// scheduler wakes it at that time (re-verifying jacked first).
//
// Source of truth for "walled" is jacked's usage snapshot; the error string is only a
// secondary signal for terminal agents that print a limit notice without a structured code.

import { isUsageLimitError } from "../cline-sdk/cline-session-state";
import type { RuntimeManagerAccount, RuntimeManagerSnapshot } from "../core/api-contract";

/** A window at/above this percent is treated as walled. Mirrors jacked usage_pacing's default. */
export const USAGE_WALLED_THRESHOLD = 90;

/**
 * Wake delay used when a task is usage-paused but no reset time is known (jacked snapshot
 * cold, or a walled window with no published reset). Deliberately short: the scheduler
 * re-checks jacked at wake and reschedules with its own backoff if still walled — this only
 * bounds how long we wait before the FIRST real check. Matches night-shift's "pause time
 * unknown → bounded backoff, never no-pause" rule.
 */
export const UNKNOWN_WAKE_BACKOFF_MS = 2 * 60_000;

export interface ClassifyUsagePauseInput {
	/** The card/session opt-in. When false, a usage-limit exit parks normally in Review. */
	autoResumeOnUsageLimit: boolean;
	/** The account this task is pinned to (jacked id), or null when it follows auto-swap. */
	managerAccountId: number | null;
	/** Last-known jacked snapshot (from the monitor). Null when jacked is unreachable. */
	snapshot: RuntimeManagerSnapshot | null;
	/** Agent error / output text captured at exit, if any. */
	errorText: string | null;
	/** Current time in epoch ms. */
	now: number;
}

export interface UsagePauseDecision {
	/** Epoch ms to auto-resume at. */
	resumeAt: number;
	/** "reset" when derived from a known window reset; "backoff" when the wake time is a fallback. */
	source: "reset" | "backoff";
}

function windowIsWalled(percent: number | null): boolean {
	return percent !== null && percent >= USAGE_WALLED_THRESHOLD;
}

/** Manager reports window resets as ISO-8601 strings; the pause math needs epoch ms. */
function resetToEpochMs(value: string | null): number | null {
	if (value === null || value.length === 0) {
		return null;
	}
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The account is workable only once its LAST constrained window resets, so among walled
 * windows with a known future reset we take the latest. Returns null when the account is
 * walled but no walled window has a known future reset (wake unknowable).
 */
function pinnedAccountResumeAt(account: RuntimeManagerAccount, now: number): number | null {
	const constrained: number[] = [];
	let walledButUnknown = false;
	const windows: Array<[number | null, number | null]> = [
		[account.fiveHourPercent, resetToEpochMs(account.fiveHourResetsAt)],
		[account.sevenDayPercent, resetToEpochMs(account.sevenDayResetsAt)],
	];
	for (const [percent, reset] of windows) {
		if (!windowIsWalled(percent)) {
			continue;
		}
		if (reset !== null && reset !== undefined && reset > now) {
			constrained.push(reset);
		} else {
			walledButUnknown = true;
		}
	}
	if (constrained.length === 0) {
		return null;
	}
	// A poisoning unknown window means the account is still walled after the known resets.
	if (walledButUnknown) {
		return null;
	}
	return Math.max(...constrained);
}

/**
 * Decide whether a session exit should pause-and-schedule-resume rather than park in Review.
 *
 * Returns null when: the task did not opt in, or the exit is not usage-caused (neither the
 * relevant jacked window is walled nor the error text reads as a usage limit). Otherwise a
 * decision with the resume time — a concrete reset when known, else a bounded backoff.
 */
export function classifyUsagePause(input: ClassifyUsagePauseInput): UsagePauseDecision | null {
	if (!input.autoResumeOnUsageLimit) {
		return null;
	}
	const { snapshot, managerAccountId, now } = input;
	const errorSaysUsage = isUsageLimitError(input.errorText);

	// Pinned task: its own account's window governs, regardless of fleet headroom elsewhere.
	if (managerAccountId !== null) {
		const account = snapshot?.accounts.find((candidate) => candidate.id === managerAccountId) ?? null;
		if (account) {
			const walled = windowIsWalled(account.fiveHourPercent) || windowIsWalled(account.sevenDayPercent);
			if (walled) {
				const reset = pinnedAccountResumeAt(account, now);
				return reset !== null
					? { resumeAt: reset, source: "reset" }
					: { resumeAt: now + UNKNOWN_WAKE_BACKOFF_MS, source: "backoff" };
			}
			// Account has headroom per jacked. Only the error string could still say otherwise.
			return errorSaysUsage ? { resumeAt: now + UNKNOWN_WAKE_BACKOFF_MS, source: "backoff" } : null;
		}
		// No snapshot data for the pinned account — fall back to the error string alone.
		return errorSaysUsage ? { resumeAt: now + UNKNOWN_WAKE_BACKOFF_MS, source: "backoff" } : null;
	}

	// Unpinned task: only the fleet being fully walled (no seat to swap to) is a pause;
	// otherwise jacked's auto-swap handles it and the task should just retry/park.
	const pacing = snapshot?.pacing ?? null;
	if (pacing?.allExhausted) {
		return pacing.pauseUntil !== null && pacing.pauseUntil > now
			? { resumeAt: pacing.pauseUntil, source: "reset" }
			: { resumeAt: now + UNKNOWN_WAKE_BACKOFF_MS, source: "backoff" };
	}
	// Fleet has headroom (or no data). An error string alone can still pause a cold-snapshot race.
	return errorSaysUsage ? { resumeAt: now + UNKNOWN_WAKE_BACKOFF_MS, source: "backoff" } : null;
}
