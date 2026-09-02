import { describe, expect, it } from "vitest";

import { resolveGeminiWorkspaceProbeDirs } from "../../src/commands/hook-events/gemini-hook-events";
import { buildGeminiNotifyArgs, mapGeminiHookEvent } from "../../src/commands/hooks";
import { hasHookRuntimeContext } from "../../src/terminal/hook-runtime-context";

function readFlag(args: string[], flag: string): string | undefined {
	const index = args.indexOf(flag);
	return index === -1 ? undefined : args[index + 1];
}

describe("mapGeminiHookEvent", () => {
	it.each([
		["Stop", "to_review"],
		["PostInvocation", "to_review"],
		["AfterAgent", "to_review"],
		["PreInvocation", "to_in_progress"],
		["BeforeAgent", "to_in_progress"],
		// The settings.json writer has always encoded the post-tool events as
		// to_in_progress; agy sends the native name, so the mapping has to agree.
		["PostToolUse", "to_in_progress"],
		["AfterTool", "to_in_progress"],
		["PreToolUse", "activity"],
		["BeforeTool", "activity"],
		["Notification", "activity"],
	])("maps %s to %s", (eventName, expected) => {
		expect(mapGeminiHookEvent(eventName)).toBe(expected);
	});

	it("passes already-mapped Kanban events through", () => {
		expect(mapGeminiHookEvent("to_review")).toBe("to_review");
		expect(mapGeminiHookEvent("to_in_progress")).toBe("to_in_progress");
		expect(mapGeminiHookEvent("activity")).toBe("activity");
	});

	it("returns null for an unknown event", () => {
		expect(mapGeminiHookEvent("SomethingElse")).toBeNull();
		expect(mapGeminiHookEvent("")).toBeNull();
	});
});

describe("buildGeminiNotifyArgs", () => {
	it("round-trips the payload so enrichment can still find the transcript", () => {
		const payload = { transcript_path: "/tmp/agy/transcript.jsonl", conversationId: "conv-1" };
		const args = buildGeminiNotifyArgs("to_review", { source: "gemini" }, payload);

		expect(args.slice(0, 4)).toEqual(["hooks", "notify", "--event", "to_review"]);
		expect(readFlag(args, "--source")).toBe("gemini");
		const encoded = readFlag(args, "--metadata-base64");
		expect(encoded).toBeDefined();
		expect(JSON.parse(Buffer.from(encoded ?? "", "base64").toString("utf8"))).toEqual(payload);
	});

	it("omits the payload flag when there is no payload", () => {
		const args = buildGeminiNotifyArgs("activity", { source: "gemini" }, null);
		expect(args).not.toContain("--metadata-base64");
	});

	it("drops an oversized payload rather than failing the spawn", () => {
		const payload = { blob: "x".repeat(256 * 1024) };
		const args = buildGeminiNotifyArgs("to_review", { source: "gemini" }, payload);

		expect(args).not.toContain("--metadata-base64");
		// The flat metadata flags still carry what the board renders.
		expect(readFlag(args, "--source")).toBe("gemini");
	});
});

describe("resolveGeminiWorkspaceProbeDirs", () => {
	it("also probes the parent when agy runs the hook from .agents", () => {
		expect(resolveGeminiWorkspaceProbeDirs("/repo/worktree/.agents")).toEqual([
			"/repo/worktree/.agents",
			"/repo/worktree",
		]);
	});

	it("probes only the cwd otherwise", () => {
		expect(resolveGeminiWorkspaceProbeDirs("/repo/worktree")).toEqual(["/repo/worktree"]);
		expect(resolveGeminiWorkspaceProbeDirs(undefined)).toEqual([]);
	});
});

describe("hasHookRuntimeContext", () => {
	it("is false when a stale hooks.json fires outside a Kanban session", () => {
		expect(hasHookRuntimeContext({})).toBe(false);
		expect(hasHookRuntimeContext({ KANBAN_HOOK_TASK_ID: "task-1" })).toBe(false);
		expect(hasHookRuntimeContext({ KANBAN_HOOK_TASK_ID: "task-1", KANBAN_HOOK_WORKSPACE_ID: "  " })).toBe(false);
	});

	it("is true once the launch env is present", () => {
		expect(hasHookRuntimeContext({ KANBAN_HOOK_TASK_ID: "task-1", KANBAN_HOOK_WORKSPACE_ID: "workspace-1" })).toBe(
			true,
		);
	});
});
