// Per-card bookkeeping for the "Login expired · Please run /login" screen, and the pure
// policy that decides what to do about it.
//
// The runtime already detects the login screen in live PTY output
// (`agent-auth-failure.ts`) and reports it once per session generation. This tracker is
// what turns those isolated reports into a per-card history, so the first pop can be
// answered the way a user answers it — restart the session on the *same* seat and type
// `continue` — while a card that pops again is handed to the pre-existing cross-seat
// failover instead of being restarted in a loop.
//
// Pure and timer-free: the daemon (`login-recovery-daemon.ts`) owns the I/O, the CLI owns
// the wiring. `now` is always passed in so tests never touch the clock.

/** What should happen for one login-expired report. */
export type LoginExpiredAction = "self_recover" | "failover";

/** How the last same-seat recovery attempt for a card ended. */
export type LoginRecoveryOutcome = "pending" | "restarted" | "failed" | "handed_to_failover";

export interface LoginExpiredRecord {
	taskId: string;
	/** Seat the card was on when the login screen appeared; null for an unresolvable pin. */
	accountId: number | null;
	firstDetectedAt: number;
	lastDetectedAt: number;
	/** How many times this card has shown the login screen. */
	popCount: number;
	/** How many same-seat restarts have been attempted for it. */
	sameSeatAttempts: number;
	lastOutcome: LoginRecoveryOutcome;
}

export interface LoginExpiredReport {
	taskId: string;
	accountId: number | null;
	/** False when the session has no replayable start request (nothing to relaunch). */
	canReplayRequest: boolean;
}

export interface LoginExpiredDecision {
	action: LoginExpiredAction;
	record: LoginExpiredRecord;
	/** Why `failover` was chosen, for the log line. Null for `self_recover`. */
	failoverReason: "no_account" | "no_replayable_request" | "attempt_spent" | null;
}

export interface LoginExpiredTracker {
	/** Records one pop and returns the action to take for it. */
	record: (report: LoginExpiredReport, nowMs: number) => LoginExpiredDecision;
	markAttempt: (taskId: string, nowMs: number) => void;
	markOutcome: (taskId: string, outcome: LoginRecoveryOutcome) => void;
	/** Every card that has ever popped the login screen, newest detection first. */
	list: () => LoginExpiredRecord[];
	get: (taskId: string) => LoginExpiredRecord | null;
	/** Forget a card, so a much later, unrelated pop is treated as its first again. */
	clear: (taskId: string) => void;
}

export function createLoginExpiredTracker(): LoginExpiredTracker {
	const records = new Map<string, LoginExpiredRecord>();

	return {
		record: (report, nowMs) => {
			const existing = records.get(report.taskId);
			const record: LoginExpiredRecord = existing
				? {
						...existing,
						// A pop can resolve to a different seat than the previous one (failover
						// moved the card), so the seat is always refreshed from the new report.
						accountId: report.accountId,
						lastDetectedAt: nowMs,
						popCount: existing.popCount + 1,
					}
				: {
						taskId: report.taskId,
						accountId: report.accountId,
						firstDetectedAt: nowMs,
						lastDetectedAt: nowMs,
						popCount: 1,
						sameSeatAttempts: 0,
						lastOutcome: "pending",
					};
			records.set(report.taskId, record);

			// One same-seat attempt per card, then hand over. Re-preparing the seat either
			// refreshed a stale token (in which case the relaunch works) or the seat really
			// does need an interactive /login — repeating it would only restart the PTY.
			if (record.accountId === null) {
				return { action: "failover", record, failoverReason: "no_account" };
			}
			if (!report.canReplayRequest) {
				return { action: "failover", record, failoverReason: "no_replayable_request" };
			}
			if (record.sameSeatAttempts > 0) {
				return { action: "failover", record, failoverReason: "attempt_spent" };
			}
			return { action: "self_recover", record, failoverReason: null };
		},

		markAttempt: (taskId, nowMs) => {
			const existing = records.get(taskId);
			if (!existing) {
				return;
			}
			records.set(taskId, {
				...existing,
				sameSeatAttempts: existing.sameSeatAttempts + 1,
				lastDetectedAt: Math.max(existing.lastDetectedAt, nowMs),
			});
		},

		markOutcome: (taskId, outcome) => {
			const existing = records.get(taskId);
			if (!existing) {
				return;
			}
			records.set(taskId, { ...existing, lastOutcome: outcome });
		},

		list: () =>
			Array.from(records.values())
				.map((record) => ({ ...record }))
				.sort((left, right) => right.lastDetectedAt - left.lastDetectedAt),

		get: (taskId) => {
			const record = records.get(taskId);
			return record ? { ...record } : null;
		},

		clear: (taskId) => {
			records.delete(taskId);
		},
	};
}
