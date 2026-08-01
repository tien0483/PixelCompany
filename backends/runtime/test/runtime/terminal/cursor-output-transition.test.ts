import { describe, expect, it } from "vitest";

import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import { createCursorOutputTransitionDetector } from "../../../src/terminal/cursor-output-transition";

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
		jackedAccountId: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
	};
}

describe("createCursorOutputTransitionDetector", () => {
	it("moves to review after work when the idle follow-up prompt appears", () => {
		const detect = createCursorOutputTransitionDetector();
		expect(detect("Cursor Agent\nv2026.07.23-e383d2b\n", summary("running"))).toBeNull();
		expect(detect("Thinking...\n", summary("running"))).toBeNull();
		expect(
			detect("Hello. How can I help with PixelOffice today?\nAdd a follow-up\n", summary("running")),
		).toEqual({ type: "hook.to_review" });
	});

	it("does not treat startup banner + idle placeholder as review before work", () => {
		const detect = createCursorOutputTransitionDetector();
		expect(
			detect("Cursor Agent\nv2026.07.23-e383d2b\nTip: Use /plan\nAdd a follow-up\n", summary("running")),
		).toBeNull();
	});

	it("returns to in-progress from review when work resumes", () => {
		const detect = createCursorOutputTransitionDetector();
		detect("Thinking...\n", summary("running"));
		detect("Done.\nAdd a follow-up\n", summary("running"));
		expect(detect("Thinking...\n", summary("awaiting_review"))).toEqual({ type: "hook.to_in_progress" });
	});
});
