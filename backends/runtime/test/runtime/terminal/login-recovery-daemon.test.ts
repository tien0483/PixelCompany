import { describe, expect, it, vi } from "vitest";

import {
	createLoginRecoveryDaemon,
	LOGIN_RECOVERY_CONTINUE_INPUT,
	type LoginRecoveryFailureReason,
	type LoginRecoveryItem,
} from "../../../src/terminal/login-recovery-daemon";
import type { RestartableSessionRequest, StartTaskSessionRequest } from "../../../src/terminal/session-manager";

const RETRY_REQUEST: RestartableSessionRequest = {
	kind: "task",
	request: {
		taskId: "task-1",
		agentId: "claude",
		binary: "claude",
		args: [],
		cwd: "/tmp/task-1",
		prompt: "Fix the bug",
		managerAccountId: 3,
		env: { CLAUDE_CONFIG_DIR: "/old/seat-3" },
	},
};

function createItem(overrides?: Partial<LoginRecoveryItem>) {
	const calls: string[] = [];
	const started: StartTaskSessionRequest[] = [];
	const outcomes: Array<{ outcome: string | null; detail?: string | null }> = [];
	const handoffs: LoginRecoveryFailureReason[] = [];
	const item: LoginRecoveryItem = {
		taskId: "task-1",
		accountId: 3,
		retryRequest: RETRY_REQUEST,
		stopSession: async () => {
			calls.push("stop");
		},
		startSession: async (request) => {
			calls.push("start");
			started.push(request);
		},
		markOutcome: (outcome, detail) => {
			calls.push(`outcome:${String(outcome)}`);
			outcomes.push({ outcome, detail });
		},
		handoff: (reason) => {
			calls.push("handoff");
			handoffs.push(reason);
		},
		...overrides,
	};
	return { item, calls, started, outcomes, handoffs };
}

describe("createLoginRecoveryDaemon", () => {
	it("prepares the same seat, then restarts it with --continue and queued input", async () => {
		const prepareSeat = vi.fn(async () => "/new/seat-3");
		const daemon = createLoginRecoveryDaemon({ prepareSeat });
		const { item, calls, started, outcomes } = createItem();

		daemon.enqueue(item);
		await daemon.tick();

		expect(prepareSeat).toHaveBeenCalledWith(3);
		// Order matters: a restart before the seat is re-prepared lands on the same login screen.
		expect(calls).toEqual(["stop", "start", "outcome:login_recovery_restarted"]);
		expect(started[0]?.managerAccountId).toBe(3);
		expect(started[0]?.resumeFromPersistence).toBe(true);
		expect(started[0]?.postStartInput).toBe(LOGIN_RECOVERY_CONTINUE_INPUT);
		expect(started[0]?.env?.CLAUDE_CONFIG_DIR).toBe("/new/seat-3");
		expect(outcomes).toEqual([{ outcome: "login_recovery_restarted", detail: undefined }]);
	});

	it("submits the continue keystrokes with a real Enter, not Shift+Enter", () => {
		expect(LOGIN_RECOVERY_CONTINUE_INPUT).toBe("continue\r");
	});

	it("hands off without restarting when the seat cannot be prepared", async () => {
		const daemon = createLoginRecoveryDaemon({ prepareSeat: async () => null });
		const { item, calls, handoffs } = createItem();

		daemon.enqueue(item);
		await daemon.tick();

		expect(calls).toEqual(["outcome:login_recovery_failed", "handoff"]);
		expect(handoffs).toEqual(["seat_prep_failed"]);
	});

	it("hands off when preparing the seat throws, recording the reason", async () => {
		const daemon = createLoginRecoveryDaemon({
			prepareSeat: async () => {
				throw new Error("manager offline");
			},
		});
		const { item, outcomes, handoffs } = createItem();

		daemon.enqueue(item);
		await daemon.tick();

		expect(outcomes).toEqual([{ outcome: "login_recovery_failed", detail: "manager offline" }]);
		expect(handoffs).toEqual(["seat_prep_failed"]);
	});

	it("hands off when the relaunch itself fails", async () => {
		const daemon = createLoginRecoveryDaemon({ prepareSeat: async () => "/new/seat-3" });
		const { item, outcomes, handoffs } = createItem({
			startSession: async () => {
				throw new Error("spawn ENOENT");
			},
		});

		daemon.enqueue(item);
		await daemon.tick();

		expect(outcomes).toEqual([{ outcome: "login_recovery_failed", detail: "spawn ENOENT" }]);
		expect(handoffs).toEqual(["restart_failed"]);
	});

	it("hands off a shell session instead of rebuilding an impossible request", async () => {
		const daemon = createLoginRecoveryDaemon({ prepareSeat: async () => "/new/seat-3" });
		const { item, calls, handoffs } = createItem({
			retryRequest: { kind: "shell", request: { taskId: "task-1", cwd: "/tmp/task-1", binary: "bash" } },
		});

		daemon.enqueue(item);
		await daemon.tick();

		expect(calls).not.toContain("start");
		expect(handoffs).toEqual(["request_rebuild_failed"]);
	});

	it("ignores a duplicate report while a recovery is in flight", async () => {
		let releaseStop = (): void => {};
		const gate = new Promise<void>((resolve) => {
			releaseStop = resolve;
		});
		const daemon = createLoginRecoveryDaemon({ prepareSeat: async () => "/new/seat-3" });
		const first = createItem({ stopSession: async () => await gate });

		daemon.enqueue(first.item);
		const inFlightTick = daemon.tick();
		expect(daemon.inFlight()).toEqual(["task-1"]);

		const duplicate = createItem();
		daemon.enqueue(duplicate.item);
		releaseStop();
		await inFlightTick;
		await daemon.tick();

		expect(duplicate.calls).toEqual([]);
		expect(daemon.inFlight()).toEqual([]);
	});

	it("recovers the same card again once the previous attempt finished", async () => {
		const daemon = createLoginRecoveryDaemon({ prepareSeat: async () => "/new/seat-3" });
		const first = createItem();
		daemon.enqueue(first.item);
		await daemon.tick();

		const second = createItem();
		daemon.enqueue(second.item);
		await daemon.tick();

		expect(second.calls).toContain("start");
	});

	it("start()/stop() drive the queue on an interval", async () => {
		vi.useFakeTimers();
		try {
			const daemon = createLoginRecoveryDaemon({ prepareSeat: async () => "/new/seat-3", pollIntervalMs: 50 });
			const { item, calls } = createItem();

			daemon.enqueue(item);
			daemon.start();
			await vi.advanceTimersByTimeAsync(60);
			expect(calls).toContain("start");

			daemon.stop();
			const afterStop = createItem();
			daemon.enqueue(afterStop.item);
			await vi.advanceTimersByTimeAsync(500);
			expect(afterStop.calls).toEqual([]);
		} finally {
			vi.useRealTimers();
		}
	});
});
