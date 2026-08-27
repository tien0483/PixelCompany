import { describe, expect, it } from "vitest";

import {
	createLoginExpiredTracker,
	MAX_SAME_SEAT_ATTEMPTS,
} from "../../../src/terminal/login-expired-tracker";

const REPORT = { taskId: "task-1", accountId: 7, canReplayRequest: true };

describe("createLoginExpiredTracker", () => {
	it("self-recovers up to MAX_SAME_SEAT_ATTEMPTS times before handing to failover", () => {
		const tracker = createLoginExpiredTracker();

		// Every pop up to the cap self-recovers.
		for (let i = 1; i <= MAX_SAME_SEAT_ATTEMPTS; i++) {
			const decision = tracker.record(REPORT, i * 1_000);
			expect(decision.action).toBe("self_recover");
			expect(decision.record.popCount).toBe(i);
			expect(decision.failoverReason).toBeNull();
			tracker.markAttempt("task-1", i * 1_000 + 100);
		}

		// One pop past the cap: allowance exhausted → failover.
		const spent = tracker.record(REPORT, (MAX_SAME_SEAT_ATTEMPTS + 1) * 1_000);
		expect(spent.action).toBe("failover");
		expect(spent.failoverReason).toBe("attempt_spent");
		expect(spent.record.popCount).toBe(MAX_SAME_SEAT_ATTEMPTS + 1);
		expect(spent.record.sameSeatAttempts).toBe(MAX_SAME_SEAT_ATTEMPTS);
	});

	it("keeps self-recovering while no attempt has been spent", () => {
		const tracker = createLoginExpiredTracker();
		expect(tracker.record(REPORT, 1_000).action).toBe("self_recover");
		// No markAttempt: the enqueue never happened, so the allowance is still there.
		expect(tracker.record(REPORT, 2_000).action).toBe("self_recover");
	});

	it("fails over when there is no seat to re-prepare", () => {
		const tracker = createLoginExpiredTracker();
		const decision = tracker.record({ ...REPORT, accountId: null }, 1_000);
		expect(decision.action).toBe("failover");
		expect(decision.failoverReason).toBe("no_account");
	});

	it("fails over when the session has no replayable start request", () => {
		const tracker = createLoginExpiredTracker();
		const decision = tracker.record({ ...REPORT, canReplayRequest: false }, 1_000);
		expect(decision.action).toBe("failover");
		expect(decision.failoverReason).toBe("no_replayable_request");
	});

	it("refreshes the seat on a later pop after failover moved the card", () => {
		const tracker = createLoginExpiredTracker();
		tracker.record(REPORT, 1_000);
		const moved = tracker.record({ ...REPORT, accountId: 9 }, 2_000);
		expect(moved.record.accountId).toBe(9);
		expect(moved.record.firstDetectedAt).toBe(1_000);
		expect(moved.record.lastDetectedAt).toBe(2_000);
	});

	it("clear() makes a much later pop count as the first again", () => {
		const tracker = createLoginExpiredTracker();
		// Exhaust all attempts.
		for (let i = 1; i <= MAX_SAME_SEAT_ATTEMPTS; i++) {
			tracker.record(REPORT, i * 1_000);
			tracker.markAttempt("task-1", i * 1_000 + 100);
		}
		expect(tracker.record(REPORT, (MAX_SAME_SEAT_ATTEMPTS + 1) * 1_000).action).toBe("failover");

		tracker.clear("task-1");
		const afterClear = tracker.record(REPORT, 99_000);
		expect(afterClear.action).toBe("self_recover");
		expect(afterClear.record.popCount).toBe(1);
	});

	it("tracks every card that popped, newest detection first", () => {
		const tracker = createLoginExpiredTracker();
		tracker.record({ ...REPORT, taskId: "task-a" }, 1_000);
		tracker.record({ ...REPORT, taskId: "task-b" }, 3_000);
		tracker.record({ ...REPORT, taskId: "task-c" }, 2_000);

		expect(tracker.list().map((record) => record.taskId)).toEqual(["task-b", "task-c", "task-a"]);
	});

	it("records outcomes and ignores unknown tasks", () => {
		const tracker = createLoginExpiredTracker();
		tracker.record(REPORT, 1_000);
		tracker.markOutcome("task-1", "restarted");
		expect(tracker.get("task-1")?.lastOutcome).toBe("restarted");

		// No throw, no phantom record.
		tracker.markOutcome("missing", "failed");
		tracker.markAttempt("missing", 1_000);
		expect(tracker.get("missing")).toBeNull();
	});
});
