// Classifies raw Cline SDK session events into the small set of things a terminal cares about.
//
// The envelope unwrapping is imported from `cline-sdk/cline-event-adapter.ts` rather than
// re-implemented: that module is the authoritative taxonomy for this SDK version, and the two
// would drift the first time a payload shape changed. What differs here is the *consumer* — a PTY
// has no chat entry to mutate, so this returns plain observations instead of summary patches.
import { readAgentEvent, readChunkEvent, readEndedEvent, readStatusEvent } from "../cline-sdk/cline-event-adapter";
import { isClineUserAttentionTool } from "../cline-sdk/cline-session-state";

export type ClineCliObservation =
	| { kind: "assistant-text"; text: string; accumulated: boolean }
	| { kind: "reasoning-text"; text: string; accumulated: boolean }
	| { kind: "tool-started"; toolName: string | null; toolInput: unknown; userAttention: boolean }
	| { kind: "tool-finished"; toolName: string | null; toolInput: unknown; error: string | null }
	| { kind: "notice"; text: string }
	| { kind: "stream"; text: string; stream: "stdout" | "stderr" | "agent" }
	| { kind: "error"; message: string; recoverable: boolean }
	| { kind: "turn-finished"; status: "completed" | "aborted" | "failed"; finalText: string | null }
	| { kind: "ended"; reason: string }
	| { kind: "status"; status: string };

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readErrorMessage(value: unknown): string | null {
	if (typeof value === "string") {
		return value.trim() || null;
	}
	if (value instanceof Error) {
		return value.message.trim() || null;
	}
	const record = asRecord(value);
	if (record && typeof record.message === "string") {
		return record.message.trim() || null;
	}
	return null;
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
	const value = record?.[key];
	return typeof value === "string" ? value : null;
}

/** Pulls the text out of an `assistant-message` content array (`text` or `reasoning` parts). */
function readMessagePartText(message: unknown, partType: "text" | "reasoning"): string | null {
	const content = asRecord(message)?.content;
	if (!Array.isArray(content)) {
		return null;
	}
	const text = content
		.map((part) => {
			const partRecord = asRecord(part);
			if (!partRecord || partRecord.type !== partType || typeof partRecord.text !== "string") {
				return "";
			}
			return partRecord.text;
		})
		.join("");
	return text.length > 0 ? text : null;
}

function readToolResultError(message: unknown): string | null {
	const content = asRecord(message)?.content;
	if (!Array.isArray(content)) {
		return null;
	}
	const result = content.map((part) => asRecord(part)).find((part) => part?.type === "tool-result");
	if (!result || result.isError !== true) {
		return null;
	}
	return readErrorMessage(result.output) ?? "Tool execution failed";
}

function normalizeRunStatus(value: string | null): "completed" | "aborted" | "failed" {
	if (value === "aborted") {
		return "aborted";
	}
	if (value === "failed" || value === "error") {
		return "failed";
	}
	return "completed";
}

/**
 * Returns null for events the terminal has nothing to say about (hook echoes, bookkeeping).
 * Tool input is carried through on `tool-started` so the caller can remember it for the matching
 * `tool-finished`, which in several SDK shapes does not repeat it.
 */
export function classifyClineCliEvent(event: unknown): ClineCliObservation | null {
	const agentEvent = readAgentEvent(event);
	if (agentEvent) {
		const record = asRecord(agentEvent);
		switch (agentEvent.type) {
			case "error": {
				const message =
					readErrorMessage(record?.error) ?? readString(record, "message")?.trim() ?? "Unknown agent error";
				const recoverable = record?.recoverable === true;
				return { kind: "error", message, recoverable };
			}
			case "run-failed": {
				const message = readErrorMessage(record?.error) ?? "Unknown agent error";
				return { kind: "error", message, recoverable: false };
			}
			case "assistant-text-delta": {
				const accumulated = readString(record, "accumulatedText");
				if (accumulated !== null) {
					return { kind: "assistant-text", text: accumulated, accumulated: true };
				}
				const text = readString(record, "text");
				return text ? { kind: "assistant-text", text, accumulated: false } : null;
			}
			case "assistant-reasoning-delta": {
				const text = readString(record, "text");
				return text ? { kind: "reasoning-text", text, accumulated: false } : null;
			}
			case "assistant-message": {
				const text = readMessagePartText(record?.message, "text");
				if (text) {
					return { kind: "assistant-text", text, accumulated: true };
				}
				const reasoning = readMessagePartText(record?.message, "reasoning");
				return reasoning ? { kind: "reasoning-text", text: reasoning, accumulated: true } : null;
			}
			case "notice": {
				const message = readString(record, "message")?.trim();
				return message ? { kind: "notice", text: message } : null;
			}
			case "tool-started": {
				const toolCall = asRecord(record?.toolCall);
				const toolName = readString(toolCall, "toolName");
				return {
					kind: "tool-started",
					toolName,
					toolInput: toolCall?.input,
					userAttention: isClineUserAttentionTool(toolName),
				};
			}
			case "tool-finished": {
				const toolCall = asRecord(record?.toolCall);
				return {
					kind: "tool-finished",
					toolName: readString(toolCall, "toolName"),
					toolInput: toolCall?.input,
					error: readToolResultError(record?.message),
				};
			}
			case "run-finished": {
				const result = asRecord(record?.result);
				const finalText = readString(result, "outputText")?.trim() ?? null;
				return {
					kind: "turn-finished",
					status: normalizeRunStatus(readString(result, "status")),
					finalText: finalText || null,
				};
			}
			case "done": {
				const finalText = readString(record, "text")?.trim() ?? null;
				return {
					kind: "turn-finished",
					status: normalizeRunStatus(readString(record, "reason")),
					finalText: finalText || null,
				};
			}
			case "content_start": {
				if (record?.contentType === "text") {
					const accumulated = readString(record, "accumulated");
					if (accumulated !== null) {
						return { kind: "assistant-text", text: accumulated, accumulated: true };
					}
					const text = readString(record, "text");
					return text ? { kind: "assistant-text", text, accumulated: false } : null;
				}
				if (record?.contentType === "reasoning") {
					const reasoning = readString(record, "reasoning");
					return reasoning ? { kind: "reasoning-text", text: reasoning, accumulated: true } : null;
				}
				if (record?.contentType === "tool") {
					const toolName = readString(record, "toolName");
					return {
						kind: "tool-started",
						toolName,
						toolInput: record?.input,
						userAttention: isClineUserAttentionTool(toolName),
					};
				}
				return null;
			}
			case "content_end": {
				if (record?.contentType === "tool") {
					return {
						kind: "tool-finished",
						toolName: readString(record, "toolName"),
						toolInput: undefined,
						error: readString(record, "error"),
					};
				}
				if (record?.contentType === "reasoning") {
					const reasoning = readString(record, "reasoning");
					return reasoning ? { kind: "reasoning-text", text: reasoning, accumulated: true } : null;
				}
				if (record?.contentType === "text") {
					const text = readString(record, "text");
					return text ? { kind: "assistant-text", text, accumulated: true } : null;
				}
				return null;
			}
			default:
				return null;
		}
	}

	const chunkEvent = readChunkEvent(event);
	if (chunkEvent) {
		return { kind: "stream", text: chunkEvent.payload.chunk, stream: chunkEvent.payload.stream };
	}

	const endedEvent = readEndedEvent(event);
	if (endedEvent) {
		return { kind: "ended", reason: endedEvent.payload.reason };
	}

	const statusEvent = readStatusEvent(event);
	if (statusEvent) {
		return { kind: "status", status: statusEvent.payload.status };
	}

	return null;
}
