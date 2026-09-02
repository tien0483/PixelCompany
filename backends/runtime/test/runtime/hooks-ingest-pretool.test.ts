import { describe, expect, it } from "vitest";

import { CLAUDE_PRE_TOOL_ALLOW_ACK, isClaudePreToolUseHook } from "../../src/commands/hooks";

describe("isClaudePreToolUseHook", () => {
	it("matches PreToolUse hook-event-name", () => {
		expect(isClaudePreToolUseHook({ hookEventName: "PreToolUse" })).toBe(true);
	});

	it("ignores other hook events", () => {
		expect(isClaudePreToolUseHook({ hookEventName: "Stop" })).toBe(false);
		expect(isClaudePreToolUseHook({})).toBe(false);
	});
});

describe("CLAUDE_PRE_TOOL_ALLOW_ACK", () => {
	it("uses Claude PreToolUse hookSpecificOutput allow shape", () => {
		expect(JSON.parse(CLAUDE_PRE_TOOL_ALLOW_ACK)).toEqual({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "allow",
			},
		});
	});
});
