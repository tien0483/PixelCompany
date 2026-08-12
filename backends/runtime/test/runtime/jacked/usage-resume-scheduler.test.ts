import { describe, expect, it, vi } from "vitest";

import type {
	RuntimeManagerPacing,
	RuntimeManagerSnapshot,
	RuntimeTaskSessionSummary,
} from "../../../src/core/api-contract";
import {
	createUsageResumeScheduler,
	evaluateSession,
	isUsageResumeCandidate,
	type PausableSession,
} from "../../../src/jacked/usage-resume-scheduler";

const NOW = 1_000_000_000_000;
const FUTURE = NOW + 3 * 60 * 60 * 1000;

function snapshot(pacing: RuntimeManagerPacing | null): RuntimeManagerSnapshot {
	return {
		version: null,
		accounts: [],
		activeAccountId: null,
		pressure: 0,
		swapPausedUntil: null,
		autoSwapEnabled: true,
		pacing,
		features: [],
		latestSwap: null,
		lessonsActive: null,
		fetchedAt: NOW,
		stale: false,
	};
}

function summary(partial: Partial<RuntimeTaskSessionSummary> & { taskId: string }): RuntimeTaskSessionSummary {
	return {
		state: "awaiting_review",
		mode: null,
		agentId: "claude",
		workspacePath: null,
		pid: null,
		startedAt: null,
		activeRunMs: 0,
		runningSince: null,
		pausedAt: null,
		pauseReason: null,
		updatedAt: NOW,
		lastOutputAt: null,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		warningMessage: null,
		managerAccountId: null,
		autoResumeOnUsageLimit: false,
		resumeAt: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
		...partial,
	};
}

const EXHAUSTED: RuntimeManagerPacing = { pauseUntil: FUTURE, worstWindowPct: 99, allExhausted: true };
const HEADROOM: RuntimeManagerPacing = { pauseUntil: null, worstWindowPct: 10, allExhausted: false };

describe("isUsageResumeCandidate", () => {
	it("selects opted-in errors and any paused task, ignores the rest", () => {
		expect(
			isUsageResumeCandidate(summary({ taskId: "a", reviewReason: "error", autoResumeOnUsageLimit: true })),
		).toBe(true);
		expect(
			isUsageResumeCandidate(summary({ taskId: "b", reviewReason: "error", autoResumeOnUsageLimit: false })),
		).toBe(false);
		expect(isUsageResumeCandidate(summary({ taskId: "c", reviewReason: "usage_paused", resumeAt: FUTURE }))).toBe(
			true,
		);
		expect(isUsageResumeCandidate(summary({ taskId: "d", state: "running", reviewReason: null }))).toBe(false);
	});

	it("selects an errored API-seat task even without the opt-in checkbox", () => {
		expect(
			isUsageResumeCandidate(
				summary({ taskId: "e", reviewReason: "error", autoResumeOnUsageLimit: false, providerId: "openrouter" }),
			),
		).toBe(true);
	});

	it("does not treat the built-in default seat as an API seat", () => {
		expect(
			isUsageResumeCandidate(
				summary({ taskId: "f", reviewReason: "error", autoResumeOnUsageLimit: false, providerId: "cline" }),
			),
		).toBe(false);
	});
});

describe("evaluateSession", () => {
	it("pauses an opted-in error when the fleet is exhausted", () => {
		const s = summary({ taskId: "a", reviewReason: "error", autoResumeOnUsageLimit: true });
		expect(evaluateSession(s, snapshot(EXHAUSTED), NOW)).toEqual({ action: "pause", resumeAt: FUTURE });
	});

	it("leaves an opted-in error alone when the fleet has headroom and no usage error text", () => {
		const s = summary({ taskId: "a", reviewReason: "error", autoResumeOnUsageLimit: true });
		expect(evaluateSession(s, snapshot(HEADROOM), NOW)).toEqual({ action: "none" });
	});

	it("does nothing for a paused task before its resume time", () => {
		const s = summary({ taskId: "a", reviewReason: "usage_paused", resumeAt: FUTURE });
		expect(evaluateSession(s, snapshot(EXHAUSTED), NOW)).toEqual({ action: "none" });
	});

	it("resumes a due paused task once the window has cleared", () => {
		const s = summary({ taskId: "a", reviewReason: "usage_paused", resumeAt: NOW - 1 });
		expect(evaluateSession(s, snapshot(HEADROOM), NOW)).toEqual({ action: "resume" });
	});

	it("reschedules a due paused task that is still walled", () => {
		const s = summary({ taskId: "a", reviewReason: "usage_paused", resumeAt: NOW - 1 });
		expect(evaluateSession(s, snapshot(EXHAUSTED), NOW)).toEqual({
			action: "reschedule",
			source: "reset",
			resumeAt: FUTURE,
		});
	});

	it("pauses an API-seat error on a transient (503) message without the opt-in checkbox", () => {
		const s = summary({
			taskId: "a",
			reviewReason: "error",
			autoResumeOnUsageLimit: false,
			providerId: "openrouter",
			warningMessage: "503 Service Unavailable",
		});
		expect(evaluateSession(s, snapshot(HEADROOM), NOW)).toEqual({
			action: "pause",
			resumeAt: NOW + 2 * 60_000,
		});
	});

	it("does not apply the broadened API-seat check to a Claude (non-API-seat) task", () => {
		const s = summary({
			taskId: "a",
			reviewReason: "error",
			autoResumeOnUsageLimit: false,
			providerId: "cline",
			warningMessage: "503 Service Unavailable",
		});
		expect(evaluateSession(s, snapshot(HEADROOM), NOW)).toEqual({ action: "none" });
	});
});

describe("createUsageResumeScheduler runner", () => {
	function makeSession(s: RuntimeTaskSessionSummary): PausableSession & { paused: number[]; resumed: number } {
		const rec = {
			taskId: s.taskId,
			summary: s,
			paused: [] as number[],
			resumed: 0,
			markUsagePaused(resumeAt: number) {
				rec.paused.push(resumeAt);
			},
			async resume() {
				rec.resumed += 1;
				// Model the real resume path: the relaunch clears the paused state, so the
				// session stops being a due candidate on the next tick.
				rec.summary.reviewReason = "attention";
				rec.summary.resumeAt = null;
			},
		};
		return rec;
	}

	it("does not touch jacked when there are no candidates", async () => {
		const refreshSnapshot = vi.fn(async () => snapshot(EXHAUSTED));
		const scheduler = createUsageResumeScheduler({
			collectSessions: () => [makeSession(summary({ taskId: "idle", state: "running", reviewReason: null }))],
			refreshSnapshot,
			now: () => NOW,
		});
		await scheduler.tick();
		expect(refreshSnapshot).not.toHaveBeenCalled();
	});

	it("pauses an errored candidate at the fleet reset", async () => {
		const session = makeSession(summary({ taskId: "a", reviewReason: "error", autoResumeOnUsageLimit: true }));
		const scheduler = createUsageResumeScheduler({
			collectSessions: () => [session],
			refreshSnapshot: async () => snapshot(EXHAUSTED),
			now: () => NOW,
		});
		await scheduler.tick();
		expect(session.paused).toEqual([FUTURE]);
		expect(session.resumed).toBe(0);
	});

	it("resumes a due, now-clear paused task exactly once", async () => {
		const session = makeSession(summary({ taskId: "a", reviewReason: "usage_paused", resumeAt: NOW - 1 }));
		const scheduler = createUsageResumeScheduler({
			collectSessions: () => [session],
			refreshSnapshot: async () => snapshot(HEADROOM),
			now: () => NOW,
		});
		await scheduler.tick();
		await scheduler.tick();
		expect(session.resumed).toBe(1);
	});

	it("stops auto-retrying an API-seat task after 5 consecutive still-failing pauses", async () => {
		const session = makeSession(
			summary({
				taskId: "a",
				reviewReason: "error",
				autoResumeOnUsageLimit: false,
				providerId: "openrouter",
				warningMessage: "503 Service Unavailable",
			}),
		);
		const scheduler = createUsageResumeScheduler({
			collectSessions: () => [session],
			refreshSnapshot: async () => snapshot(HEADROOM),
			now: () => NOW,
		});
		// The fake markUsagePaused doesn't transition reviewReason, so each tick re-detects the
		// same "error" candidate — modeling a task whose retried call keeps failing.
		for (let i = 0; i < 5; i += 1) {
			await scheduler.tick();
		}
		expect(session.paused).toHaveLength(5);
		await scheduler.tick();
		expect(session.paused).toHaveLength(5);
	});

	it("escalates the backoff when a due paused task keeps finding the wall (unknown reset)", async () => {
		const walledNoReset: RuntimeManagerPacing = { pauseUntil: null, worstWindowPct: 99, allExhausted: true };
		const session = makeSession(summary({ taskId: "a", reviewReason: "usage_paused", resumeAt: NOW - 1 }));
		const scheduler = createUsageResumeScheduler({
			collectSessions: () => [session],
			refreshSnapshot: async () => snapshot(walledNoReset),
			now: () => NOW,
		});
		await scheduler.tick();
		await scheduler.tick();
		expect(session.paused).toEqual([NOW + 60_000, NOW + 120_000]);
		expect(session.resumed).toBe(0);
	});
});
