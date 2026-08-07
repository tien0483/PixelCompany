import { describe, expect, it } from "vitest";
import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import { reconcileHydratedSessionSummary, toParkedSessionSummary } from "../../../src/terminal/session-hydration";

function summary(overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId: "t1",
		state: "idle",
		agentId: "claude",
		workspacePath: "/repo",
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

describe("reconcileHydratedSessionSummary", () => {
	it("interrupted + pausedAt -> idle + paused, preserving pausedAt/pauseReason/workspacePath", () => {
		const s = summary({
			state: "interrupted",
			pausedAt: 5_000,
			pauseReason: "manual",
			workspacePath: "/repo/task",
			pid: 42,
			runningSince: 1_000,
			exitCode: 1,
			reviewReason: "interrupted",
			activeRunMs: 2_000,
		});
		const result = reconcileHydratedSessionSummary(s, 20_000);
		expect(result.state).toBe("idle");
		expect(result.reviewReason).toBeNull();
		expect(result.pid).toBeNull();
		expect(result.runningSince).toBeNull();
		expect(result.exitCode).toBeNull();
		expect(result.pausedAt).toBe(5_000);
		expect(result.pauseReason).toBe("manual");
		expect(result.workspacePath).toBe("/repo/task");
	});

	it("running + pausedAt -> idle + paused", () => {
		const s = summary({
			state: "running",
			pausedAt: 3_000,
			pauseReason: "max_runtime",
			pid: 7,
			runningSince: 1_000,
		});
		const result = reconcileHydratedSessionSummary(s, 10_000);
		expect(result.state).toBe("idle");
		expect(result.reviewReason).toBeNull();
		expect(result.pid).toBeNull();
		expect(result.runningSince).toBeNull();
		expect(result.exitCode).toBeNull();
		expect(result.pausedAt).toBe(3_000);
		expect(result.pauseReason).toBe("max_runtime");
	});

	it("awaiting_review + pausedAt -> idle + paused", () => {
		const s = summary({
			state: "awaiting_review",
			reviewReason: "attention",
			pausedAt: 4_000,
			pauseReason: "manual",
			pid: 9,
			runningSince: null,
		});
		const result = reconcileHydratedSessionSummary(s, 15_000);
		expect(result.state).toBe("idle");
		expect(result.reviewReason).toBeNull();
		expect(result.pid).toBeNull();
		expect(result.runningSince).toBeNull();
		expect(result.exitCode).toBeNull();
		expect(result.pausedAt).toBe(4_000);
		expect(result.pauseReason).toBe("manual");
	});

	it("running, unpaused -> interrupted (unchanged crash semantics), pid cleared", () => {
		const s = summary({ state: "running", pid: 11, runningSince: 1_000, pausedAt: null });
		const result = reconcileHydratedSessionSummary(s, 30_000);
		expect(result.state).toBe("interrupted");
		expect(result.reviewReason).toBe("interrupted");
		expect(result.pid).toBeNull();
	});

	it("awaiting_review, unpaused -> unchanged state, pid/runningSince cleared", () => {
		const s = summary({
			state: "awaiting_review",
			reviewReason: "hook",
			pid: 13,
			runningSince: 500,
			pausedAt: null,
		});
		const result = reconcileHydratedSessionSummary(s, 25_000);
		expect(result.state).toBe("awaiting_review");
		expect(result.reviewReason).toBe("hook");
		expect(result.pid).toBeNull();
		expect(result.runningSince).toBeNull();
	});

	it("other states, unpaused -> pid/runningSince cleared only", () => {
		const s = summary({ state: "idle", pid: 21, runningSince: null, pausedAt: null });
		const result = reconcileHydratedSessionSummary(s, 40_000);
		expect(result.state).toBe("idle");
		expect(result.pid).toBeNull();
		expect(result.runningSince).toBeNull();
	});

	it("failed state, unpaused -> pid/runningSince cleared only, state unchanged", () => {
		const s = summary({ state: "failed", pid: 33, runningSince: null, pausedAt: null });
		const result = reconcileHydratedSessionSummary(s, 41_000);
		expect(result.state).toBe("failed");
		expect(result.pid).toBeNull();
	});

	it("pausedAt!=null + state:'failed' -> idle+paused, no process (invariant holds beyond the live-looking states)", () => {
		const s = summary({
			state: "failed",
			pausedAt: 6_000,
			pauseReason: "manual",
			pid: 44,
			runningSince: null,
			exitCode: 1,
			updatedAt: 6_000,
		});
		const result = reconcileHydratedSessionSummary(s, 20_000);
		expect(result.state).toBe("idle");
		expect(result.pid).toBeNull();
		expect(result.pausedAt).toBe(6_000);
	});

	it("pausedAt!=null + state:'idle' -> idle+paused, no process (invariant holds, not just a fallback no-op)", () => {
		const s = summary({
			state: "idle",
			pausedAt: 7_000,
			pauseReason: "manual",
			pid: 55,
			runningSince: null,
			updatedAt: 7_000,
		});
		const result = reconcileHydratedSessionSummary(s, 20_000);
		expect(result.state).toBe("idle");
		expect(result.pid).toBeNull();
		expect(result.pausedAt).toBe(7_000);
	});

	it("does not inflate activeRunMs by the offline gap when reconciling a paused+running session", () => {
		const s = summary({
			state: "running",
			pausedAt: 5_000,
			runningSince: 1_000,
			activeRunMs: 2_000,
			updatedAt: 5_000,
		});
		// App was closed for hours; now reconciled far in the future. The stopwatch should
		// freeze at `updatedAt` (last known-alive write), banking only the real running
		// segment (runningSince -> updatedAt), not the multi-hour app-closed gap.
		const result = reconcileHydratedSessionSummary(s, 5_000 + 3 * 60 * 60 * 1000);
		expect(result.runningSince).toBeNull();
		expect(result.activeRunMs).toBe(2_000 + (5_000 - 1_000));
	});

	it("does not inflate activeRunMs by the offline gap for an unpaused running->interrupted reconcile", () => {
		const s = summary({
			state: "running",
			runningSince: 1_000,
			activeRunMs: 500,
			pausedAt: null,
			updatedAt: 2_000,
		});
		// App crashed mid-run and stayed closed for 5 hours before this boot reconcile. Only
		// the runningSince -> updatedAt segment (1s) is real running time; the 5-hour offline
		// gap between updatedAt and the real reconcile-time nowTs must not be added.
		const result = reconcileHydratedSessionSummary(s, 1_000 + 5 * 60 * 60 * 1000);
		expect(result.activeRunMs).toBe(500 + (2_000 - 1_000));
		expect(result.runningSince).toBeNull();
	});

	it("does not inflate activeRunMs for awaiting_review, unpaused reconcile (already frozen)", () => {
		const s = summary({
			state: "awaiting_review",
			reviewReason: "exit",
			runningSince: null,
			activeRunMs: 1_234,
			pausedAt: null,
		});
		const result = reconcileHydratedSessionSummary(s, 1_000 + 5 * 60 * 60 * 1000);
		expect(result.activeRunMs).toBe(1_234);
	});

	it("does not inflate activeRunMs for other/idle unpaused reconcile", () => {
		const s = summary({ state: "idle", runningSince: null, activeRunMs: 777, pausedAt: null });
		const result = reconcileHydratedSessionSummary(s, 999_999);
		expect(result.activeRunMs).toBe(777);
	});
});

describe("toParkedSessionSummary", () => {
	it("produces the same result as the paused branch of reconcileHydratedSessionSummary", () => {
		const s = summary({
			state: "running",
			pausedAt: 3_000,
			pauseReason: "manual",
			workspacePath: "/repo/task-2",
			pid: 55,
			runningSince: 1_000,
			exitCode: 2,
			reviewReason: "error",
			activeRunMs: 1_000,
			updatedAt: 50_000,
		});
		const nowTs = 50_000;
		expect(toParkedSessionSummary(s, nowTs)).toEqual(reconcileHydratedSessionSummary(s, nowTs));
	});
});
