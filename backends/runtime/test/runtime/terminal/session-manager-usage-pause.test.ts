import { describe, expect, it } from "vitest";

import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import { isUsageResumeCandidate } from "../../../src/jacked/usage-resume-scheduler";
import { TerminalSessionManager } from "../../../src/terminal/session-manager";

function erroredSummary(overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "awaiting_review",
		agentId: "claude",
		workspacePath: "/tmp/worktree",
		pid: null,
		startedAt: null,
		activeRunMs: 0,
		runningSince: null,
		pausedAt: null,
		pauseReason: null,
		updatedAt: Date.now(),
		lastOutputAt: null,
		reviewReason: "error",
		exitCode: 1,
		lastHookAt: null,
		latestHookActivity: null,
		warningMessage: "Claude usage limit reached",
		managerAccountId: null,
		autoResumeOnUsageLimit: true,
		resumeAt: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
		...overrides,
	};
}

describe("TerminalSessionManager.markUsagePaused", () => {
	const RESUME_AT = Date.now() + 60_000;

	it("parks a hydrated errored session as usage_paused with its resumeAt", () => {
		const manager = new TerminalSessionManager();
		manager.hydrateFromRecord({ "task-1": erroredSummary() });

		const updated = manager.markUsagePaused("task-1", RESUME_AT);
		expect(updated).not.toBeNull();
		expect(updated?.state).toBe("awaiting_review");
		expect(updated?.reviewReason).toBe("usage_paused");
		expect(updated?.resumeAt).toBe(RESUME_AT);

		// The parked summary is now a scheduler candidate and survives read-back (restart-safe path).
		const summary = manager.getSummary("task-1");
		expect(summary && isUsageResumeCandidate(summary)).toBe(true);
	});

	it("is idempotent for the same resumeAt but updates when the reset changes", () => {
		const manager = new TerminalSessionManager();
		manager.hydrateFromRecord({ "task-1": erroredSummary() });

		expect(manager.markUsagePaused("task-1", RESUME_AT)).not.toBeNull();
		expect(manager.markUsagePaused("task-1", RESUME_AT)).toBeNull(); // no-op: unchanged
		expect(manager.markUsagePaused("task-1", RESUME_AT + 30_000)).not.toBeNull(); // rescheduled
	});

	it("no-ops for an unknown task", () => {
		const manager = new TerminalSessionManager();
		expect(manager.markUsagePaused("missing", RESUME_AT)).toBeNull();
	});

	it("emits the paused summary to onSummary subscribers", () => {
		const manager = new TerminalSessionManager();
		manager.hydrateFromRecord({ "task-1": erroredSummary() });
		const seen: RuntimeTaskSessionSummary[] = [];
		manager.onSummary((summary) => seen.push(summary));

		manager.markUsagePaused("task-1", RESUME_AT);
		expect(seen.at(-1)?.reviewReason).toBe("usage_paused");
		expect(seen.at(-1)?.resumeAt).toBe(RESUME_AT);
	});
});
