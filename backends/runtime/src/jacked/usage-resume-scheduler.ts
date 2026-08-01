// Watches task sessions that hit the Claude usage limit and drives their --continue resume
// once the window resets. Two responsibilities, both evaluated at every poll tick so the
// loop is restart-safe (state lives on the persisted session summaries, never in memory):
//
//   1. Reclassify: a task that exited into awaiting_review/error AND opted into
//      autoResumeOnUsageLimit is re-checked against the live jacked snapshot; if its window
//      is walled it is parked as "usage_paused" with the reset time.
//   2. Wake: a usage_paused task whose resumeAt has passed is re-verified against jacked —
//      resumed if the window cleared, or rescheduled with escalating backoff if still walled
//      (never resume straight into another wall).
//
// The pure per-session decision is `evaluateSession`; the runner binds it to the terminal /
// cline services the host provides.
import type { RuntimeJackedSnapshot, RuntimeTaskSessionSummary } from "../core/api-contract";
import { classifyUsagePause } from "./usage-pause";

/** Escalating backoff for a wake that finds the window still walled. */
const RESCHEDULE_BASE_MS = 60_000;
const RESCHEDULE_CAP_MS = 30 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 15_000;

export type UsageResumeAction =
	| { action: "none" }
	| { action: "pause"; resumeAt: number }
	| { action: "resume" }
	| { action: "reschedule"; source: "reset" | "backoff"; resumeAt: number };

/** True for summaries the scheduler needs to look at (opted-in errors, or already paused). */
export function isUsageResumeCandidate(summary: RuntimeTaskSessionSummary): boolean {
	if (summary.state !== "awaiting_review") {
		return false;
	}
	if (summary.reviewReason === "usage_paused") {
		return true;
	}
	return summary.reviewReason === "error" && summary.autoResumeOnUsageLimit === true;
}

/**
 * Decide what to do with one candidate session given the current jacked snapshot and time.
 * Pure — the runner applies the returned action through service-bound callbacks.
 */
export function evaluateSession(
	summary: RuntimeTaskSessionSummary,
	snapshot: RuntimeJackedSnapshot | null,
	now: number,
): UsageResumeAction {
	const jackedAccountId = summary.jackedAccountId ?? null;

	// A freshly errored, opted-in task: pause it only if the exit is usage-caused.
	if (summary.reviewReason === "error") {
		const decision = classifyUsagePause({
			autoResumeOnUsageLimit: summary.autoResumeOnUsageLimit === true,
			jackedAccountId,
			snapshot,
			errorText: summary.warningMessage ?? summary.latestHookActivity?.finalMessage ?? null,
			now,
		});
		return decision ? { action: "pause", resumeAt: decision.resumeAt } : { action: "none" };
	}

	// An already-paused task: nothing to do until its resume time arrives.
	if (summary.reviewReason === "usage_paused") {
		if (summary.resumeAt === null || summary.resumeAt === undefined || summary.resumeAt > now) {
			return { action: "none" };
		}
		// Wake: re-verify against jacked with no error text (the error is stale by now).
		const decision = classifyUsagePause({
			autoResumeOnUsageLimit: true,
			jackedAccountId,
			snapshot,
			errorText: null,
			now,
		});
		if (!decision) {
			return { action: "resume" };
		}
		return { action: "reschedule", source: decision.source, resumeAt: decision.resumeAt };
	}

	return { action: "none" };
}

/** One candidate session, pre-bound by the host to the service that owns it. */
export interface PausableSession {
	taskId: string;
	summary: RuntimeTaskSessionSummary;
	/** Park this session as usage_paused at the given epoch-ms resume time. */
	markUsagePaused: (resumeAt: number) => void;
	/** Relaunch with --continue (resumeFromTrash). Rejects are swallowed by the runner. */
	resume: () => Promise<void>;
}

export interface UsageResumeSchedulerDeps {
	/** Gather every candidate session across all workspaces, bound to its owning service. */
	collectSessions: () => Promise<PausableSession[]> | PausableSession[];
	/** Force-refresh and return the jacked snapshot (monitor.refresh). */
	refreshSnapshot: () => Promise<RuntimeJackedSnapshot | null>;
	now: () => number;
	pollIntervalMs?: number;
	log?: (message: string) => void;
}

export interface UsageResumeScheduler {
	/** Run one poll tick immediately (also used by tests). */
	tick: () => Promise<void>;
	start: () => void;
	stop: () => void;
}

export function createUsageResumeScheduler(deps: UsageResumeSchedulerDeps): UsageResumeScheduler {
	const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	// Per-task consecutive still-walled wakes, for escalating reschedule backoff.
	const rescheduleAttempts = new Map<string, number>();
	// Tasks with a resume in flight, so a slow relaunch is not kicked off twice.
	const resuming = new Set<string>();
	let timer: NodeJS.Timeout | null = null;
	let running = false;

	const escalatedBackoff = (taskId: string, now: number): number => {
		const attempt = (rescheduleAttempts.get(taskId) ?? 0) + 1;
		rescheduleAttempts.set(taskId, attempt);
		const delay = Math.min(RESCHEDULE_BASE_MS * 2 ** (attempt - 1), RESCHEDULE_CAP_MS);
		return now + delay;
	};

	const tick = async (): Promise<void> => {
		if (running) {
			return;
		}
		running = true;
		try {
			const sessions = await deps.collectSessions();
			const candidates = sessions.filter((session) => isUsageResumeCandidate(session.summary));
			if (candidates.length === 0) {
				// Nothing quota-bound is waiting — don't poll jacked while idle.
				return;
			}
			const snapshot = await deps.refreshSnapshot();
			const now = deps.now();
			for (const session of candidates) {
				const action = evaluateSession(session.summary, snapshot, now);
				switch (action.action) {
					case "pause": {
						rescheduleAttempts.delete(session.taskId);
						session.markUsagePaused(action.resumeAt);
						break;
					}
					case "reschedule": {
						// A known future reset is trustworthy; only guessed wakes escalate.
						let resumeAt: number;
						if (action.source === "reset") {
							// Reset the escalation counter so a later backoff starts fresh, not carried over.
							rescheduleAttempts.delete(session.taskId);
							resumeAt = action.resumeAt;
						} else {
							resumeAt = escalatedBackoff(session.taskId, now);
						}
						session.markUsagePaused(resumeAt);
						break;
					}
					case "resume": {
						if (resuming.has(session.taskId)) {
							break;
						}
						rescheduleAttempts.delete(session.taskId);
						resuming.add(session.taskId);
						void Promise.resolve(session.resume())
							.catch((error: unknown) => {
								deps.log?.(
									`usage-resume: failed to resume ${session.taskId}: ${
										error instanceof Error ? error.message : String(error)
									}`,
								);
							})
							.finally(() => {
								resuming.delete(session.taskId);
							});
						break;
					}
					default:
						break;
				}
			}
		} catch (error) {
			deps.log?.(`usage-resume: tick failed: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			running = false;
		}
	};

	return {
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
	};
}
