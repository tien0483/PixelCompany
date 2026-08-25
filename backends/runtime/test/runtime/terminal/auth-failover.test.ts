import { describe, expect, it } from "vitest";

import { buildAuthFailoverRequest, buildSameSeatRecoveryRequest } from "../../../src/terminal/auth-failover";
import type { RestartableSessionRequest } from "../../../src/terminal/session-manager";

const TASK_REQUEST: RestartableSessionRequest = {
	kind: "task",
	request: {
		taskId: "task-1",
		agentId: "claude",
		binary: "claude",
		args: ["--dangerously-skip-permissions"],
		cwd: "/tmp/task-1",
		prompt: "Fix the bug",
		managerAccountId: 2,
		env: { CLAUDE_CONFIG_DIR: "/old/seat-2", EXTRA: "keep-me" },
	},
};

const SHELL_REQUEST: RestartableSessionRequest = {
	kind: "shell",
	request: { taskId: "task-1", cwd: "/tmp/task-1", binary: "bash" },
};

describe("buildSameSeatRecoveryRequest", () => {
	it("keeps the account pin and only refreshes the config dir", () => {
		const rebuilt = buildSameSeatRecoveryRequest(TASK_REQUEST, "/new/seat-2", "continue\r");

		expect(rebuilt?.managerAccountId).toBe(2);
		expect(rebuilt?.env).toEqual({ CLAUDE_CONFIG_DIR: "/new/seat-2", EXTRA: "keep-me" });
	});

	it("resumes the conversation and queues the continue keystrokes", () => {
		const rebuilt = buildSameSeatRecoveryRequest(TASK_REQUEST, "/new/seat-2", "continue\r");

		expect(rebuilt?.prompt).toBe("");
		expect(rebuilt?.resumeFromPersistence).toBe(true);
		expect(rebuilt?.postStartInput).toBe("continue\r");
		// The rest of the launch is replayed verbatim.
		expect(rebuilt?.args).toEqual(["--dangerously-skip-permissions"]);
		expect(rebuilt?.cwd).toBe("/tmp/task-1");
	});

	it("returns null for a shell session or a missing request", () => {
		expect(buildSameSeatRecoveryRequest(SHELL_REQUEST, "/new/seat-2", "continue\r")).toBeNull();
		expect(buildSameSeatRecoveryRequest(null, "/new/seat-2", "continue\r")).toBeNull();
	});

	it("differs from cross-seat failover only in the seat it targets", () => {
		const sameSeat = buildSameSeatRecoveryRequest(TASK_REQUEST, "/new/seat-2", "continue\r");
		const crossSeat = buildAuthFailoverRequest(TASK_REQUEST, 5, "/new/seat-5");

		expect(crossSeat?.managerAccountId).toBe(5);
		expect(sameSeat?.managerAccountId).toBe(2);
		expect(crossSeat?.postStartInput).toBeUndefined();
	});
});
