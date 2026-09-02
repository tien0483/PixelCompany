import { open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import type { RuntimeHookEvent, RuntimeTaskHookActivity } from "../../core/api-contract";
import { AGY_CUSTOMIZATION_DIR_NAME } from "../../terminal/agy-hooks-config";

const GEMINI_TRANSCRIPT_TAIL_SCAN_BYTES = 2 * 1024 * 1024;

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

function readStringField(record: Record<string, unknown>, key: string): string | null {
	const value = record[key];
	if (typeof value !== "string") {
		return null;
	}
	const normalized = normalizeWhitespace(value);
	return normalized.length > 0 ? normalized : null;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
	try {
		return asRecord(JSON.parse(value));
	} catch {
		return null;
	}
}

function readTranscriptPathFromPayload(payload: Record<string, unknown> | null): string | null {
	return payload ? (readStringField(payload, "transcript_path") ?? readStringField(payload, "transcriptPath")) : null;
}

function extractAssistantTextFromGeminiLine(lineRecord: Record<string, unknown>): string | null {
	// Standard Antigravity transcript format: {"source": "MODEL", "type": "PLANNER_RESPONSE", "content": "..."}
	const source = readStringField(lineRecord, "source");
	const type = readStringField(lineRecord, "type");
	if (source === "MODEL" || type === "PLANNER_RESPONSE" || type === "model") {
		const content = lineRecord.content;
		if (typeof content === "string" && content.trim().length > 0) {
			return normalizeWhitespace(content);
		}
	}

	// Message-wrapped format: {"type": "message", "message": {"role": "assistant", "content": "..."}}
	const messageRecord = asRecord(lineRecord.message);
	if (messageRecord && readStringField(messageRecord, "role") === "assistant") {
		const content = messageRecord.content;
		if (typeof content === "string" && content.trim().length > 0) {
			return normalizeWhitespace(content);
		}
		if (Array.isArray(content)) {
			const textSegments: string[] = [];
			for (const item of content) {
				const itemRecord = asRecord(item);
				if (!itemRecord) {
					continue;
				}
				const itemText = readStringField(itemRecord, "text") ?? readStringField(itemRecord, "content");
				if (itemText) {
					textSegments.push(itemText);
				}
			}
			if (textSegments.length > 0) {
				return normalizeWhitespace(textSegments.join("\n"));
			}
		}
	}

	// Direct content / text field fallback
	if (typeof lineRecord.content === "string" && lineRecord.content.trim().length > 0 && source !== "USER_EXPLICIT" && source !== "USER") {
		return normalizeWhitespace(lineRecord.content);
	}

	return null;
}

export function resolveGeminiFinalMessageFromTranscriptText(transcriptText: string): string | null {
	const lines = transcriptText.split(/\r?\n/);
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index]?.trim();
		if (!line) {
			continue;
		}
		const lineRecord = parseJsonObject(line);
		if (!lineRecord) {
			continue;
		}
		const assistantText = extractAssistantTextFromGeminiLine(lineRecord);
		if (assistantText) {
			return assistantText;
		}
	}
	return null;
}

async function readFileTail(filePath: string, maxBytes: number): Promise<string | null> {
	try {
		const fileStat = await stat(filePath);
		if (!fileStat.isFile() || fileStat.size <= 0 || maxBytes <= 0) {
			return null;
		}
		const byteLength = Math.min(fileStat.size, maxBytes);
		const start = Math.max(0, fileStat.size - byteLength);
		let handle: Awaited<ReturnType<typeof open>> | null = null;
		try {
			handle = await open(filePath, "r");
			const buffer = Buffer.alloc(byteLength);
			const readResult = await handle.read(buffer, 0, byteLength, start);
			return buffer.subarray(0, readResult.bytesRead).toString("utf8");
		} finally {
			await handle?.close();
		}
	} catch {
		return null;
	}
}

async function resolveGeminiReviewFinalMessageFromPayload(
	payload: Record<string, unknown> | null,
	cwd?: string,
): Promise<string | null> {
	const transcriptPath = readTranscriptPathFromPayload(payload);
	if (transcriptPath) {
		const transcriptTail = await readFileTail(transcriptPath, GEMINI_TRANSCRIPT_TAIL_SCAN_BYTES);
		if (transcriptTail) {
			const resolved = resolveGeminiFinalMessageFromTranscriptText(transcriptTail);
			if (resolved) {
				return resolved;
			}
		}
	}

	// Check conversationId location
	const conversationId = payload ? (readStringField(payload, "conversationId") ?? readStringField(payload, "conversation_id")) : null;
	if (conversationId) {
		const convTranscriptPath = join(homedir(), ".gemini", "antigravity-cli", "brain", conversationId, ".system_generated", "logs", "transcript.jsonl");
		const transcriptTail = await readFileTail(convTranscriptPath, GEMINI_TRANSCRIPT_TAIL_SCAN_BYTES);
		if (transcriptTail) {
			const resolved = resolveGeminiFinalMessageFromTranscriptText(transcriptTail);
			if (resolved) {
				return resolved;
			}
		}
	}

	// Check local project workspace transcript
	for (const workspaceDir of resolveGeminiWorkspaceProbeDirs(cwd)) {
		const localTranscriptPath = join(workspaceDir, ".gemini", "antigravity-cli", "transcript.jsonl");
		const transcriptTail = await readFileTail(localTranscriptPath, GEMINI_TRANSCRIPT_TAIL_SCAN_BYTES);
		if (transcriptTail) {
			const resolved = resolveGeminiFinalMessageFromTranscriptText(transcriptTail);
			if (resolved) {
				return resolved;
			}
		}
	}

	return null;
}

/**
 * agy runs a hook with its cwd set to the directory holding `hooks.json`, i.e.
 * `<worktree>/.agents` — one level below the workspace whose transcript we want.
 */
export function resolveGeminiWorkspaceProbeDirs(cwd?: string): string[] {
	if (!cwd) {
		return [];
	}
	if (basename(cwd) === AGY_CUSTOMIZATION_DIR_NAME) {
		return [cwd, dirname(cwd)];
	}
	return [cwd];
}

export async function enrichGeminiReviewMetadata<
	T extends {
		event: RuntimeHookEvent;
		metadata?: Partial<RuntimeTaskHookActivity>;
		payload?: Record<string, unknown> | null;
	},
>(args: T, cwd?: string): Promise<T> {
	if (args.event !== "to_review") {
		return args;
	}
	const metadata = args.metadata ?? {};
	const source = metadata.source?.toLowerCase();
	if (source !== "gemini" && source !== "antigravity") {
		return args;
	}
	const existingFinalMessage =
		typeof metadata.finalMessage === "string" && metadata.finalMessage.trim().length > 0
			? metadata.finalMessage
			: null;
	if (existingFinalMessage) {
		return {
			...args,
			metadata: {
				...metadata,
				activityText: metadata.activityText ?? `Final: ${existingFinalMessage}`,
			},
		};
	}

	const fallbackFinalMessage = await resolveGeminiReviewFinalMessageFromPayload(args.payload ?? null, cwd);
	if (!fallbackFinalMessage) {
		return args;
	}

	return {
		...args,
		metadata: {
			...metadata,
			finalMessage: fallbackFinalMessage,
			activityText: metadata.activityText ?? `Final: ${fallbackFinalMessage}`,
		},
	};
}
