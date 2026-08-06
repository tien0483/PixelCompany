import { describe, expect, it } from "vitest";

import { normalizeHookMetadata } from "../../src/commands/hooks";

describe("normalizeHookMetadata ExitPlanMode", () => {
	it("extracts planText from tool_input.plan when toolName is ExitPlanMode", () => {
		const metadata = normalizeHookMetadata(
			"activity",
			{
				hook_event_name: "PreToolUse",
				tool_name: "ExitPlanMode",
				tool_input: {
					plan: "# Implementation Plan\n\nDo the thing.",
				},
				transcript_path: "/Users/dev/.claude/projects/task/transcript.jsonl",
			},
			{ source: "claude" },
		);

		expect(metadata?.toolName).toBe("ExitPlanMode");
		expect(metadata?.planText).toBe("# Implementation Plan\n\nDo the thing.");
		expect(metadata?.source).toBe("claude");
	});

	it("does not set planText for other tools", () => {
		const metadata = normalizeHookMetadata(
			"activity",
			{
				hook_event_name: "PreToolUse",
				tool_name: "Read",
				tool_input: {
					file_path: "src/index.ts",
					plan: "should be ignored",
				},
				transcript_path: "/Users/dev/.claude/projects/task/transcript.jsonl",
			},
			{ source: "claude" },
		);

		expect(metadata?.toolName).toBe("Read");
		expect(metadata?.planText).toBeUndefined();
	});
});
