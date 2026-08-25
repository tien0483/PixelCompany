// Drives same-seat recovery for task cards that hit Claude Code's
// "Login expired · Please run /login" screen.
//
// Why a daemon rather than doing this inline in the auth-failure reporter: the report is
// raised from the PTY's `onData` path, and a recovery is three awaited round trips (prepare
// the seat, kill the PTY, relaunch it). Queueing them onto a tick keeps that work off the
// output path, gives every pop exactly one log line, and puts the "is a recovery already in
// flight for this card" question in one place.
//
// What one recovery does, in order:
//   1. Re-prepare the *same* seat's launch dir. This is the actual cure — Manager's
//      `prepare_account_dir` refreshes an expired Claude Code token while preparing the
//      directory, so no interactive login is needed for the common stale-token case.
//   2. Stop the session (the login-screen PTY is deliberately left alive by the detector,
//      so it has to be killed explicitly) and relaunch it on the same account with
//      `--continue`.
//   3. Queue `continue\r` as the session's post-start input, which the session manager types
//      once the restarted TUI settles.
//
// Anything that fails hands the card to `onRecoveryExhausted`, which the CLI wires to the
// pre-existing cross-seat failover.
import type { RuntimeAuthFailoverOutcome } from "../core/api-contract";
import { buildSameSeatRecoveryRequest } from "./auth-failover";
import type { RestartableSessionRequest, StartTaskSessionRequest } from "./session-manager";
import { PAUSE_RESUME_INPUT } from "./session-run-timing";

const DEFAULT_POLL_INTERVAL_MS = 2_000;

/**
 * The keystrokes a user sends after clicking "Restart session". Shared with the pause/resume
 * path rather than redeclared: `\r` is a real Enter (submits), while `\n` would be
 * Shift+Enter and would only insert a linebreak — see session-run-timing.ts.
 */
export const LOGIN_RECOVERY_CONTINUE_INPUT = PAUSE_RESUME_INPUT;

/** Why a same-seat recovery could not be completed. */
export type LoginRecoveryFailureReason = "seat_prep_failed" | "request_rebuild_failed" | "restart_failed";

/** One queued recovery, pre-bound by the caller to the manager that owns the session. */
export interface LoginRecoveryItem {
	taskId: string;
	/** The seat to re-prepare and relaunch on — deliberately the same one that failed. */
	accountId: number;
	/** The session's last start request, captured by the auth-failure detector. */
	retryRequest: RestartableSessionRequest;
	/** Kills the login-screen PTY and resolves once it has really exited. */
	stopSession: () => Promise<unknown>;
	/** Relaunches the session. The returned summary is not used; only a throw matters here. */
	startSession: (request: StartTaskSessionRequest) => Promise<unknown>;
	markOutcome: (outcome: RuntimeAuthFailoverOutcome, detail?: string | null) => void;
	/**
	 * Last resort for this card: the CLI binds it to the pre-existing cross-seat failover.
	 * Called whenever same-seat recovery cannot be completed.
	 */
	handoff: (reason: LoginRecoveryFailureReason) => void | Promise<void>;
}

export interface LoginRecoveryDaemonDeps {
	/**
	 * Re-prepares the seat's `CLAUDE_CONFIG_DIR` (refreshing its token) and returns the host
	 * path to it, or null when the seat cannot be prepared — which means it genuinely needs
	 * an interactive `/login`.
	 */
	prepareSeat: (accountId: number) => Promise<string | null>;
	pollIntervalMs?: number;
	log?: (message: string) => void;
}

export interface LoginRecoveryDaemon {
	/** Queue a card for same-seat recovery. Ignored when one is already in flight for it. */
	enqueue: (item: LoginRecoveryItem) => void;
	/** Drain the queue once (also the test entry point). */
	tick: () => Promise<void>;
	start: () => void;
	stop: () => void;
	/** Task ids currently being recovered. */
	inFlight: () => string[];
}

export function createLoginRecoveryDaemon(deps: LoginRecoveryDaemonDeps): LoginRecoveryDaemon {
	const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	const queue: LoginRecoveryItem[] = [];
	const inFlight = new Set<string>();
	let timer: NodeJS.Timeout | null = null;
	let draining = false;

	const fail = async (item: LoginRecoveryItem, reason: LoginRecoveryFailureReason, detail: string | null) => {
		item.markOutcome("login_recovery_failed", detail);
		deps.log?.(`login-recovery: ${item.taskId} could not recover on seat ${item.accountId} (${reason})`);
		try {
			await item.handoff(reason);
		} catch (error) {
			deps.log?.(
				`login-recovery: handing ${item.taskId} to failover failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	};

	const recover = async (item: LoginRecoveryItem): Promise<void> => {
		// Preparing the seat is what refreshes its token, so it has to happen before the
		// relaunch — a restart on the old config dir would land on the same login screen.
		let configDir: string | null;
		try {
			configDir = await deps.prepareSeat(item.accountId);
		} catch (error) {
			await fail(item, "seat_prep_failed", error instanceof Error ? error.message : String(error));
			return;
		}
		if (configDir === null || configDir.trim().length === 0) {
			await fail(item, "seat_prep_failed", null);
			return;
		}

		const request = buildSameSeatRecoveryRequest(item.retryRequest, configDir, LOGIN_RECOVERY_CONTINUE_INPUT);
		if (request === null) {
			await fail(item, "request_rebuild_failed", null);
			return;
		}

		try {
			// The detector keeps the login-screen PTY alive on purpose, so the relaunch has to
			// kill it first; stopSession awaits the real exit, not just the signal.
			await item.stopSession();
			await item.startSession(request);
		} catch (error) {
			await fail(item, "restart_failed", error instanceof Error ? error.message : String(error));
			return;
		}

		// After the start, never before: startTaskSession resets the outcome fields on the
		// fresh summary, which would wipe a mark written earlier.
		item.markOutcome("login_recovery_restarted");
		deps.log?.(
			`login-recovery: restarted ${item.taskId} on seat ${item.accountId} with --continue; "continue" queued`,
		);
	};

	const tick = async (): Promise<void> => {
		if (draining) {
			return;
		}
		draining = true;
		try {
			const batch = queue.splice(0, queue.length);
			await Promise.all(
				batch.map(async (item) => {
					try {
						await recover(item);
					} catch (error) {
						deps.log?.(
							`login-recovery: ${item.taskId} recovery threw: ${
								error instanceof Error ? error.message : String(error)
							}`,
						);
					} finally {
						inFlight.delete(item.taskId);
					}
				}),
			);
		} finally {
			draining = false;
		}
	};

	return {
		enqueue: (item) => {
			if (inFlight.has(item.taskId)) {
				deps.log?.(`login-recovery: ${item.taskId} already recovering, ignoring duplicate report`);
				return;
			}
			inFlight.add(item.taskId);
			queue.push(item);
		},
		tick,
		start: () => {
			if (timer !== null) {
				return;
			}
			const handle = setInterval(() => {
				void tick();
			}, pollIntervalMs);
			handle.unref?.();
			timer = handle;
		},
		stop: () => {
			if (timer !== null) {
				clearInterval(timer);
				timer = null;
			}
		},
		inFlight: () => Array.from(inFlight),
	};
}
