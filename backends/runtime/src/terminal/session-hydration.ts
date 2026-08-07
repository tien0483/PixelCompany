import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import { freezeRunTimingPatch } from "./session-run-timing";

/**
 * Reconcile a session summary that was persisted before the app closed, on boot.
 *
 * A summary that was manually/force-paused (`pausedAt != null`, regardless of which
 * state it was paused from — including `idle`/`failed`, e.g. a pause request racing a
 * process exit) should come back paused-with-no-process rather than stuck in whatever
 * run state it was in when the app closed: the "paused, no process" invariant
 * (`state:"idle"` + `pausedAt != null` + `pid:null`) holds universally whenever
 * `pausedAt` is set, not just for the states that would otherwise look "live". A
 * summary that was actually mid-run (`running`, unpaused) crashed along with the app
 * and should surface as `interrupted`. Everything else just loses its stale
 * `pid`/`runningSince` (no process survives a restart).
 *
 * Pure: summary in, summary out. Does not mutate `session-state-machine.ts` states.
 */
export function reconcileHydratedSessionSummary(
	summary: RuntimeTaskSessionSummary,
	nowTs: number,
): RuntimeTaskSessionSummary {
	// Freeze the stopwatch at the last durably-written timestamp, not the real reconcile-time
	// `nowTs` (which is the app's boot time and can be hours after the process actually died).
	// `updatedAt` is the last time this summary was known to be alive/ticking, so it bounds how
	// much of `runningSince -> now` was real running time vs. app-closed downtime. Defensive
	// `Math.min` guards against a corrupted/future `updatedAt` still using the real `nowTs`.
	const freezeTs = Math.min(nowTs, summary.updatedAt);

	if (summary.pausedAt != null) {
		return toParkedSessionSummary(summary, freezeTs);
	}

	if (summary.state === "running") {
		return {
			...summary,
			...freezeRunTimingPatch(summary, freezeTs),
			state: "interrupted",
			reviewReason: "interrupted",
			pid: null,
		};
	}

	if (summary.state === "awaiting_review") {
		return {
			...summary,
			...freezeRunTimingPatch(summary, freezeTs),
			pid: null,
			runningSince: null,
		};
	}

	return {
		...summary,
		...freezeRunTimingPatch(summary, freezeTs),
		pid: null,
		runningSince: null,
	};
}

/**
 * Transform a summary into its "parked" (paused-with-no-process) shape: `idle` with
 * `pid`/`runningSince`/`exitCode`/`reviewReason` cleared, while `pausedAt`, `pauseReason`,
 * and `workspacePath` are preserved. Extracted so the shutdown coordinator can park a
 * session directly without going through the full reconcile dispatch.
 */
export function toParkedSessionSummary(summary: RuntimeTaskSessionSummary, nowTs: number): RuntimeTaskSessionSummary {
	return {
		...summary,
		...freezeRunTimingPatch(summary, nowTs),
		state: "idle",
		reviewReason: null,
		pid: null,
		runningSince: null,
		exitCode: null,
	};
}
