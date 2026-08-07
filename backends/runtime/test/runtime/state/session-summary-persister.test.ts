import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import {
	createSessionSummaryPersister,
	durableSummaryFingerprint,
} from "../../../src/state/session-summary-persister";

function createSessionSummary(taskId: string, overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "idle",
		agentId: null,
		workspacePath: null,
		pid: null,
		startedAt: null,
		activeRunMs: 0,
		runningSince: null,
		pausedAt: null,
		pauseReason: null,
		updatedAt: Date.now(),
		lastOutputAt: null,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		...overrides,
	};
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("durableSummaryFingerprint", () => {
	it("changes when a fingerprinted field changes", () => {
		const base = createSessionSummary("task-1", { pausedAt: null });
		const paused = createSessionSummary("task-1", { pausedAt: 12345 });
		expect(durableSummaryFingerprint(base)).not.toBe(durableSummaryFingerprint(paused));
	});

	it("is stable across changes to non-fingerprinted churn fields", () => {
		const a = createSessionSummary("task-1", { updatedAt: 1, lastOutputAt: 1, lastHookAt: 1 });
		const b = createSessionSummary("task-1", {
			updatedAt: 999999,
			lastOutputAt: 999999,
			lastHookAt: 999999,
			warningMessage: "different",
			latestHookActivity: {
				activityText: "x",
				toolName: null,
				toolInputSummary: null,
				finalMessage: null,
				hookEventName: null,
				notificationType: null,
				source: null,
				planText: null,
			},
		});
		expect(durableSummaryFingerprint(a)).toBe(durableSummaryFingerprint(b));
	});
});

describe("createSessionSummaryPersister", () => {
	it("coalesces multiple rapid handleSummary calls into a single debounced write with all changed summaries", async () => {
		const writeSummaries = vi.fn().mockResolvedValue(undefined);
		const persister = createSessionSummaryPersister({
			workspaceId: "ws-1",
			writeSummaries,
			debounceMs: 400,
		});

		persister.handleSummary(createSessionSummary("task-1", { state: "running" }));
		await vi.advanceTimersByTimeAsync(100);
		persister.handleSummary(createSessionSummary("task-2", { state: "running" }));
		await vi.advanceTimersByTimeAsync(100);
		persister.handleSummary(createSessionSummary("task-1", { state: "running", pid: 42 }));

		expect(writeSummaries).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(400);

		expect(writeSummaries).toHaveBeenCalledTimes(1);
		const [workspaceId, summaries] = writeSummaries.mock.calls[0]!;
		expect(workspaceId).toBe("ws-1");
		expect(summaries).toHaveLength(2);
		const byTaskId = new Map<string, RuntimeTaskSessionSummary>(
			summaries.map((summary: RuntimeTaskSessionSummary) => [summary.taskId, summary]),
		);
		expect(byTaskId.get("task-1")?.pid).toBe(42);
		expect(byTaskId.get("task-2")?.state).toBe("running");
	});

	it("does not schedule a write when only lastOutputAt changes", async () => {
		const writeSummaries = vi.fn().mockResolvedValue(undefined);
		const persister = createSessionSummaryPersister({
			workspaceId: "ws-1",
			writeSummaries,
			debounceMs: 400,
		});

		const first = createSessionSummary("task-1", { state: "running", lastOutputAt: 1 });
		persister.handleSummary(first);
		await vi.advanceTimersByTimeAsync(400);
		expect(writeSummaries).toHaveBeenCalledTimes(1);

		writeSummaries.mockClear();

		const churnOnly = createSessionSummary("task-1", { state: "running", lastOutputAt: 999999999 });
		persister.handleSummary(churnOnly);
		await vi.advanceTimersByTimeAsync(1000);

		expect(writeSummaries).not.toHaveBeenCalled();
	});

	it("schedules a write when a fingerprinted field changes (e.g. pausedAt)", async () => {
		const writeSummaries = vi.fn().mockResolvedValue(undefined);
		const persister = createSessionSummaryPersister({
			workspaceId: "ws-1",
			writeSummaries,
			debounceMs: 400,
		});

		persister.handleSummary(createSessionSummary("task-1", { state: "running", pausedAt: null }));
		await vi.advanceTimersByTimeAsync(400);
		expect(writeSummaries).toHaveBeenCalledTimes(1);

		writeSummaries.mockClear();

		persister.handleSummary(createSessionSummary("task-1", { state: "running", pausedAt: 555 }));
		await vi.advanceTimersByTimeAsync(400);

		expect(writeSummaries).toHaveBeenCalledTimes(1);
		const [, summaries] = writeSummaries.mock.calls[0]!;
		expect(summaries[0].pausedAt).toBe(555);
	});

	it("flush() awaits a pending debounced write", async () => {
		const writeSummaries = vi.fn().mockResolvedValue(undefined);
		const persister = createSessionSummaryPersister({
			workspaceId: "ws-1",
			writeSummaries,
			debounceMs: 400,
		});

		persister.handleSummary(createSessionSummary("task-1", { state: "running" }));

		const flushPromise = persister.flush();
		await vi.runAllTimersAsync();
		await flushPromise;

		expect(writeSummaries).toHaveBeenCalledTimes(1);
	});

	it("flush() awaits an in-flight write", async () => {
		const writeControl: { resolveWrite: (() => void) | null } = { resolveWrite: null };
		const writeSummaries = vi.fn().mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					writeControl.resolveWrite = () => resolve();
				}),
		);
		const persister = createSessionSummaryPersister({
			workspaceId: "ws-1",
			writeSummaries,
			debounceMs: 400,
		});

		persister.handleSummary(createSessionSummary("task-1", { state: "running" }));
		await vi.advanceTimersByTimeAsync(400);
		expect(writeSummaries).toHaveBeenCalledTimes(1);

		let flushResolved = false;
		const flushPromise = persister.flush().then(() => {
			flushResolved = true;
		});

		await Promise.resolve();
		expect(flushResolved).toBe(false);

		writeControl.resolveWrite?.();
		await flushPromise;
		expect(flushResolved).toBe(true);
	});

	it("resolves flush() synchronously-ish when there is nothing pending or in flight", async () => {
		const writeSummaries = vi.fn().mockResolvedValue(undefined);
		const persister = createSessionSummaryPersister({
			workspaceId: "ws-1",
			writeSummaries,
		});

		await expect(persister.flush()).resolves.toBeUndefined();
		expect(writeSummaries).not.toHaveBeenCalled();
	});

	it("swallows writeSummaries errors (logs, does not throw) and keeps working on subsequent calls", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const writeSummaries = vi
			.fn()
			.mockRejectedValueOnce(new Error("disk hiccup"))
			.mockResolvedValueOnce(undefined);
		const persister = createSessionSummaryPersister({
			workspaceId: "ws-1",
			writeSummaries,
			debounceMs: 400,
		});

		persister.handleSummary(createSessionSummary("task-1", { state: "running" }));
		await vi.advanceTimersByTimeAsync(400);

		expect(writeSummaries).toHaveBeenCalledTimes(1);
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(String(warnSpy.mock.calls[0]?.[0])).toMatch(/disk hiccup/);

		persister.handleSummary(createSessionSummary("task-1", { state: "awaiting_review" }));
		await vi.advanceTimersByTimeAsync(400);

		expect(writeSummaries).toHaveBeenCalledTimes(2);
	});

	it("dispose() clears timers and does not itself attempt a final write", async () => {
		const writeSummaries = vi.fn().mockResolvedValue(undefined);
		const persister = createSessionSummaryPersister({
			workspaceId: "ws-1",
			writeSummaries,
			debounceMs: 400,
		});

		persister.handleSummary(createSessionSummary("task-1", { state: "running" }));
		persister.dispose();

		await vi.advanceTimersByTimeAsync(1000);

		expect(writeSummaries).not.toHaveBeenCalled();
	});
});
