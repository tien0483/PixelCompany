import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import { freezeRunTimingPatch } from "./session-run-timing";

/**
 * Reconcile a session summary that was persisted before the app closed, on boot.
 *
 * A summary that was manually/force-paused (`pausedAt != null`) should come back
 * paused-with-no-process rather than stuck in whatever run state it was in when the
 * app closed. A summary that was actually mid-run (`running`, unpaused) crashed
 * along with the app and should surface as `interrupted`. Everything else just
 * loses its stale `pid`/`runningSince` (no process survives a restart).
 *
 * Pure: summary in, summary out. Does not mutate `session-state-machine.ts` states.
 */
export function reconcileHydratedSessionSummary(
	summary: RuntimeTaskSessionSummary,
	nowTs: number,
): RuntimeTaskSessionSummary {
	if (
		summary.pausedAt != null &&
		(summary.state === "running" || summary.state === "awaiting_review" || summary.state === "interrupted")
	) {
		return toParkedSessionSummary(summary, nowTs);
	}

	if (summary.state === "running") {
		return {
			...summary,
			...freezeRunTimingPatch(summary, nowTs),
			state: "interrupted",
			reviewReason: "interrupted",
			pid: null,
		};
	}

	if (summary.state === "awaiting_review") {
		return {
			...summary,
			...freezeRunTimingPatch(summary, nowTs),
			pid: null,
			runningSince: null,
		};
	}

	return {
		...summary,
		...freezeRunTimingPatch(summary, nowTs),
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
