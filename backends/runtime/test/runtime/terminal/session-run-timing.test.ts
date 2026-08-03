import { describe, expect, it } from "vitest";
import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import {
	computeRunTimingPatch,
	freezeRunTimingPatch,
	liveElapsedMs,
	resumeRunTimingPatch,
} from "../../../src/terminal/session-run-timing";

function summary(overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId: "t1",
		state: "idle",
		agentId: "claude",
		workspacePath: null,
		pid: null,
		startedAt: null,
		updatedAt: 0,
		activeRunMs: 0,
		runningSince: null,
		pausedAt: null,
		pauseReason: null,
		lastOutputAt: null,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		warningMessage: null,
		resumeAt: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
		...overrides,
	};
}

/** Apply a timing patch the way updateSummary does: derived timing first, explicit patch wins. */
function applyState(
	current: RuntimeTaskSessionSummary,
	patch: Partial<RuntimeTaskSessionSummary>,
	nowTs: number,
): RuntimeTaskSessionSummary {
	return { ...current, ...computeRunTimingPatch(current, patch, nowTs), ...patch, updatedAt: nowTs };
}

describe("session run timing", () => {
	it("starts the stopwatch when entering running", () => {
		const s = applyState(summary(), { state: "running" }, 1_000);
		expect(s.runningSince).toBe(1_000);
		expect(s.activeRunMs).toBe(0);
	});

	it("banks elapsed and freezes when leaving running", () => {
		let s = applyState(summary(), { state: "running" }, 1_000);
		s = applyState(s, { state: "awaiting_review" }, 4_000);
		expect(s.activeRunMs).toBe(3_000);
		expect(s.runningSince).toBeNull();
	});

	it("does not accrue while awaiting review, resumes on next run", () => {
		let s = applyState(summary(), { state: "running" }, 0);
		s = applyState(s, { state: "awaiting_review" }, 2_000); // banked 2s
		s = applyState(s, { state: "running" }, 10_000); // idle gap not counted
		expect(s.activeRunMs).toBe(2_000);
		expect(liveElapsedMs(s, 12_000)).toBe(2_000 + 2_000);
	});

	it("freezes then resumes on manual pause without a state change", () => {
		let s = applyState(summary(), { state: "running" }, 0);
		// pause at 5s: state stays running, stopwatch frozen
		s = { ...s, pausedAt: 5_000, ...freezeRunTimingPatch(s, 5_000) };
		expect(s.activeRunMs).toBe(5_000);
		expect(s.runningSince).toBeNull();
		expect(liveElapsedMs(s, 60_000)).toBe(5_000); // frozen while paused
		// resume at 60s
		s = { ...s, pausedAt: null, ...resumeRunTimingPatch(60_000) };
		expect(liveElapsedMs(s, 61_000)).toBe(6_000); // 5s banked + 1s new
	});

	it("banks a paused (runningSince=null) session on process exit without double counting", () => {
		let s = applyState(summary(), { state: "running" }, 0);
		s = { ...s, pausedAt: 5_000, ...freezeRunTimingPatch(s, 5_000) };
		s = applyState(s, { state: "awaiting_review", reviewReason: "exit" }, 9_000);
		expect(s.activeRunMs).toBe(5_000); // no time added while paused
	});
});
