import { describe, expect, it } from "vitest";

import { buildAuthFailoverRequest, createAuthFailoverGuard, pickAuthFailoverAccountId } from "./auth-failover";
import type { StartTaskSessionRequest } from "./session-manager";

describe("pickAuthFailoverAccountId", () => {
	it("excludes the broken account and picks the lowest 5h usage among the rest", () => {
		expect(
			pickAuthFailoverAccountId({
				brokenAccountId: 1,
				accounts: [
					{ id: 1, provider: "claude", fiveHourPercent: 5 },
					{ id: 2, provider: "claude", fiveHourPercent: 40 },
					{ id: 3, provider: "claude", fiveHourPercent: 10 },
				],
			}),
		).toBe(3);
	});

	it("returns null when no other Claude accounts exist", () => {
		expect(
			pickAuthFailoverAccountId({
				brokenAccountId: 1,
				accounts: [{ id: 1, provider: "claude" }],
			}),
		).toBeNull();
	});
});

describe("buildAuthFailoverRequest", () => {
	const baseRequest: StartTaskSessionRequest = {
		taskId: "task-1",
		agentId: "claude",
		binary: "claude",
		args: [],
		cwd: "/repo",
		prompt: "do the thing",
		env: { FOO: "bar" },
	};

	it("returns null when the retry request is missing", () => {
		expect(buildAuthFailoverRequest(null, 2, "/config/dir")).toBeNull();
	});

	it("returns null for a shell session's retry request", () => {
		expect(
			buildAuthFailoverRequest(
				{ kind: "shell", request: { taskId: "task-1", cwd: "/repo", binary: "bash" } },
				2,
				"/config/dir",
			),
		).toBeNull();
	});

	it("rebuilds the task request pinned to the new account with resumeFromPersistence", () => {
		const rebuilt = buildAuthFailoverRequest({ kind: "task", request: baseRequest }, 2, "/config/dir");
		expect(rebuilt).toMatchObject({
			taskId: "task-1",
			prompt: "",
			resumeFromPersistence: true,
			managerAccountId: 2,
			env: { FOO: "bar", CLAUDE_CONFIG_DIR: "/config/dir" },
		});
	});
});

describe("createAuthFailoverGuard", () => {
	it("allows up to 3 attempts per task within the window", () => {
		const guard = createAuthFailoverGuard();
		const start = 1_000;
		expect(guard.shouldAttempt("task-1", start)).toBe(true);
		guard.recordAttempt("task-1", start);
		expect(guard.shouldAttempt("task-1", start + 1)).toBe(true);
		guard.recordAttempt("task-1", start + 1);
		expect(guard.shouldAttempt("task-1", start + 2)).toBe(true);
		guard.recordAttempt("task-1", start + 2);
		expect(guard.shouldAttempt("task-1", start + 3)).toBe(false);
	});

	it("stops counting an attempt once it falls outside the trailing window", () => {
		const guard = createAuthFailoverGuard();
		const start = 1_000;
		guard.recordAttempt("task-1", start);
		guard.recordAttempt("task-1", start + 1);
		guard.recordAttempt("task-1", start + 2);
		expect(guard.shouldAttempt("task-1", start + 3)).toBe(false);
		expect(guard.shouldAttempt("task-1", start + 10 * 60_000 + 1)).toBe(true);
	});

	it("tracks each task independently", () => {
		const guard = createAuthFailoverGuard();
		guard.recordAttempt("task-1", 0);
		guard.recordAttempt("task-1", 0);
		guard.recordAttempt("task-1", 0);
		expect(guard.shouldAttempt("task-1", 0)).toBe(false);
		expect(guard.shouldAttempt("task-2", 0)).toBe(true);
	});
});
