import { describe, expect, it } from "vitest";

import { resolveDroidFinalMessageFromTranscriptText } from "../../src/commands/hook-events/droid-hook-events";
import { resolveGeminiFinalMessageFromTranscriptText } from "../../src/commands/hook-events/gemini-hook-events";
import { inferHookSourceFromPayload } from "../../src/commands/hooks";

describe("inferHookSourceFromPayload", () => {
	it("infers claude from unix transcript path", () => {
		expect(
			inferHookSourceFromPayload({
				transcript_path: "/Users/dev/.claude/projects/task/transcript.jsonl",
			}),
		).toBe("claude");
	});

	it("infers claude from windows transcript path", () => {
		expect(
			inferHookSourceFromPayload({
				transcript_path: "C:\\Users\\dev\\.claude\\projects\\task\\transcript.jsonl",
			}),
		).toBe("claude");
	});

	it("infers gemini/antigravity from transcript path", () => {
		expect(
			inferHookSourceFromPayload({
				transcript_path: "/home/ubuntu/.gemini/antigravity-cli/brain/123/.system_generated/logs/transcript.jsonl",
			}),
		).toBe("gemini");
	});

	it("infers droid from windows transcript path", () => {
		expect(
			inferHookSourceFromPayload({
				transcript_path: "C:\\Users\\dev\\.factory\\logs\\session.jsonl",
			}),
		).toBe("droid");
	});

	it("infers droid from camelCase transcript path", () => {
		expect(
			inferHookSourceFromPayload({
				transcriptPath: "/Users/dev/.factory/logs/session.jsonl",
			}),
		).toBe("droid");
	});

	it("infers kiro from transcript path", () => {
		expect(
			inferHookSourceFromPayload({
				transcript_path: "/Users/dev/.kiro/hooks/session.jsonl",
			}),
		).toBe("kiro");
	});

	it("falls back to codex event type when transcript path does not infer a source", () => {
		expect(
			inferHookSourceFromPayload({
				type: "agent-turn-complete",
			}),
		).toBe("codex");
	});

	it("prefers transcript source over codex type fallback", () => {
		expect(
			inferHookSourceFromPayload({
				transcript_path: "C:\\Users\\dev\\.claude\\projects\\task\\transcript.jsonl",
				type: "agent-turn-complete",
			}),
		).toBe("claude");
	});

	it("returns null when no source can be inferred", () => {
		expect(
			inferHookSourceFromPayload({
				transcript_path: "C:\\Users\\dev\\logs\\session.jsonl",
			}),
		).toBeNull();
	});
});

describe("resolveDroidFinalMessageFromTranscriptText", () => {
	it("returns the latest assistant text message", () => {
		const transcriptText = [
			JSON.stringify({
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "First response" }],
				},
			}),
			JSON.stringify({
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Final summary of changes" }],
				},
			}),
		].join("\n");

		expect(resolveDroidFinalMessageFromTranscriptText(transcriptText)).toBe("Final summary of changes");
	});

	it("ignores non-assistant lines when finding the final message", () => {
		const transcriptText = [
			JSON.stringify({
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Implemented feature." }],
				},
			}),
			JSON.stringify({
				type: "message",
				message: {
					role: "user",
					content: [{ type: "text", text: "thanks" }],
				},
			}),
		].join("\n");

		expect(resolveDroidFinalMessageFromTranscriptText(transcriptText)).toBe("Implemented feature.");
	});
});

describe("resolveGeminiFinalMessageFromTranscriptText", () => {
	it("returns the latest Antigravity PLANNER_RESPONSE content", () => {
		const transcriptText = [
			JSON.stringify({
				step_index: 1,
				source: "USER_EXPLICIT",
				type: "USER_INPUT",
				content: "hello",
			}),
			JSON.stringify({
				step_index: 2,
				source: "MODEL",
				type: "PLANNER_RESPONSE",
				status: "DONE",
				content: "Task completed successfully. All unit tests are passing.",
			}),
		].join("\n");

		expect(resolveGeminiFinalMessageFromTranscriptText(transcriptText)).toBe(
			"Task completed successfully. All unit tests are passing.",
		);
	});
});
