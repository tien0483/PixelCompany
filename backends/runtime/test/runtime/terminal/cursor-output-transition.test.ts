import { describe, expect, it, vi } from "vitest";

import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import {
	createCursorOutputTransitionDetector,
	CURSOR_IDLE_QUIET_MS,
} from "../../../src/terminal/cursor-output-transition";

function summary(state: RuntimeTaskSessionSummary["state"]): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state,
		agentId: "cursor",
		workspacePath: "/tmp/task-1",
		pid: 1,
		startedAt: 1,
		lastOutputAt: 1,
		reviewReason: state === "awaiting_review" ? "hook" : null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		warningMessage: null,
		managerAccountId: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
	};
}

describe("createCursorOutputTransitionDetector", () => {
	it("does not move to review while work signals still appear with the idle chrome", () => {
		const detect = createCursorOutputTransitionDetector({ quietMs: 1_000 });
		expect(detect("Thinking...\n", summary("running"))).toBeNull();
		expect(
			detect("Thinking...\nAdd a follow-up\n", summary("running")),
		).toBeNull();
		detect.dispose();
	});

	it("moves to review only after a quiet gap past the last work signal", () => {
		let nowMs = 1_000;
		const timers: Array<{ at: number; fn: () => void }> = [];
		const deferred = vi.fn();
		const detect = createCursorOutputTransitionDetector({
			quietMs: 1_000,
			now: () => nowMs,
			schedule: (fn, ms) => {
				const at = nowMs + ms;
				timers.push({ at, fn });
				return () => {
					const index = timers.findIndex((timer) => timer.fn === fn);
					if (index >= 0) {
						timers.splice(index, 1);
					}
				};
			},
		});
		detect.bindDeferredEmit(deferred);

		expect(detect("Thinking...\n", summary("running"))).toBeNull();
		nowMs += 100;
		expect(
			detect("Hello. How can I help?\nAdd a follow-up\n", summary("running")),
		).toBeNull();
		expect(deferred).not.toHaveBeenCalled();

		nowMs += 1_000;
		for (const timer of [...timers]) {
			if (timer.at <= nowMs) {
				timer.fn();
			}
		}
		expect(deferred).toHaveBeenCalledWith({ type: "hook.to_review" });
		detect.dispose();
	});

	it("can emit immediately when the quiet gap already elapsed", () => {
		let nowMs = 1_000;
		const detect = createCursorOutputTransitionDetector({
			quietMs: 500,
			now: () => nowMs,
		});
		expect(detect("Thinking...\n", summary("running"))).toBeNull();
		nowMs += 600;
		expect(
			detect("Done.\nAdd a follow-up\n", summary("running")),
		).toEqual({ type: "hook.to_review" });
		detect.dispose();
	});

	it("does not treat startup banner + idle placeholder as review before work", () => {
		const detect = createCursorOutputTransitionDetector();
		expect(
			detect("Cursor Agent\nv2026.07.23-e383d2b\nTip: Use /plan\nAdd a follow-up\n", summary("running")),
		).toBeNull();
		detect.dispose();
	});

	it("returns to in-progress from review when work resumes", () => {
		let nowMs = 1_000;
		const detect = createCursorOutputTransitionDetector({
			quietMs: 100,
			now: () => nowMs,
		});
		detect("Thinking...\n", summary("running"));
		nowMs += 200;
		detect("Done.\nAdd a follow-up\n", summary("running"));
		expect(detect("Thinking...\n", summary("awaiting_review"))).toEqual({ type: "hook.to_in_progress" });
		detect.dispose();
	});

	it("cancels a pending review when work resumes before the quiet gap ends", () => {
		let nowMs = 1_000;
		const timers: Array<{ at: number; fn: () => void }> = [];
		const deferred = vi.fn();
		const detect = createCursorOutputTransitionDetector({
			quietMs: CURSOR_IDLE_QUIET_MS,
			now: () => nowMs,
			schedule: (fn, ms) => {
				const at = nowMs + ms;
				timers.push({ at, fn });
				return () => {
					const index = timers.findIndex((timer) => timer.fn === fn);
					if (index >= 0) {
						timers.splice(index, 1);
					}
				};
			},
		});
		detect.bindDeferredEmit(deferred);
		detect("Thinking...\n", summary("running"));
		nowMs += 50;
		detect("Add a follow-up\n", summary("running"));
		expect(timers).toHaveLength(1);
		nowMs += 100;
		detect("Thinking...\n", summary("running"));
		expect(timers).toHaveLength(0);
		nowMs += CURSOR_IDLE_QUIET_MS;
		for (const timer of [...timers]) {
			timer.fn();
		}
		expect(deferred).not.toHaveBeenCalled();
		detect.dispose();
	});
});
