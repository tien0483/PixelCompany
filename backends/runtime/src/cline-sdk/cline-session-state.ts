// Pure state helpers for native Cline sessions.
// This module owns the in-memory summary and message shape plus the low-level
// mutations shared by the event adapter and the message repository.
import type { RuntimeTaskImage, RuntimeTaskSessionSummary } from "../core/api-contract";
import { computeRunTimingPatch } from "../terminal/session-run-timing";

const CLINE_USER_ATTENTION_TOOL_NAMES = new Set(["ask_followup_question", "plan_mode_respond"]);

/**
 * Detect credit-limit / insufficient-balance errors from an error message string.
 * Shared by the event adapter (for SDK agent events) and the session service (for
 * start/send failures) so the detection logic stays in one place.
 *
 * NOTE: This relies on string matching because the SDK does not yet expose a
 * structured error code for credit exhaustion. If the SDK adds one, prefer
 * checking that code and keep this as a fallback for older SDK versions.
 */
const CREDIT_LIMIT_PATTERNS = [
	"insufficient balance",
	"insufficient_credits",
	"insufficient credits",
	"credit limit",
	"credit_limit_exceeded",
	"credits exhausted",
	"out of credits",
	"no remaining credits",
	"402 payment required",
] as const;

export function isCreditLimitError(errorMessage: string | null): boolean {
	if (!errorMessage) {
		return false;
	}
	const normalized = errorMessage.toLowerCase();
	if (CREDIT_LIMIT_PATTERNS.some((pattern) => normalized.includes(pattern))) {
		return true;
	}
	return normalized.includes("402") && (normalized.includes("balance") || normalized.includes("credit"));
}

/**
 * Detect a Claude *usage-limit* (5h / 7d session-window) exhaustion from an error/output
 * string. Distinct from {@link isCreditLimitError}: a usage limit resets on a schedule
 * (so the task can auto-resume), whereas a credit limit is a balance problem that does not.
 *
 * This is a SECONDARY signal — the primary source of truth for "the window is walled" is
 * jacked's usage snapshot (see the usage-pause classifier). It exists mainly for terminal
 * (PTY) agents, where the CLI prints a limit notice and exits without a structured code.
 */
const USAGE_LIMIT_PATTERNS = [
	"usage limit reached",
	"reached your usage limit",
	"usage limit",
	"rate limit",
	"rate_limit",
	"resets at",
	"5-hour limit",
	"5 hour limit",
	"weekly limit",
	"try again after",
	"try again later",
	"too many request",
] as const;

export function isUsageLimitError(errorMessage: string | null): boolean {
	if (!errorMessage) {
		return false;
	}
	// A credit/balance problem is NOT a resettable usage limit — never misclassify it as one.
	if (isCreditLimitError(errorMessage)) {
		return false;
	}
	const normalized = errorMessage.toLowerCase();
	if (USAGE_LIMIT_PATTERNS.some((pattern) => normalized.includes(pattern))) {
		return true;
	}
	// A raw "429" status is only trustworthy alongside its usual wording — on its own it
	// collides with port numbers, line numbers, etc. in unrelated error text.
	return normalized.includes("429") && (normalized.includes("request") || normalized.includes("throughput"));
}

/**
 * Detect a transient failure worth auto-retrying for a 3rd-party (non-Claude) API seat:
 * rate limits (via {@link isUsageLimitError}), server overload / gateway errors, and network
 * blips. 3rd-party OpenAI-compatible endpoints format these very differently from Anthropic's
 * API, so this is intentionally broader than the Claude-specific usage-limit patterns above —
 * scoped to API-seat tasks only (see usage-pause.ts) and always bounded by a retry-attempt cap,
 * never trusted alone to retry forever.
 */
const TRANSIENT_SERVER_PATTERNS = [
	"502",
	"503",
	"504",
	"bad gateway",
	"service unavailable",
	"gateway timeout",
	"overloaded",
	"econnreset",
	"socket hang up",
	"fetch failed",
	"network error",
	"etimedout",
] as const;

/** Permanent failures that must never be retried, even if short. */
const PERMANENT_ERROR_PATTERNS = [
	"invalid api key",
	"unauthorized",
	"forbidden",
	"not found",
	"invalid_request_error",
] as const;

/** Catch-all length for an unrecognized-but-terse error message — see isRetryableApiSeatError. */
const SHORT_ERROR_MESSAGE_MAX_LENGTH = 80;

export function isRetryableApiSeatError(errorMessage: string | null): boolean {
	if (!errorMessage) {
		return false;
	}
	if (isCreditLimitError(errorMessage)) {
		return false;
	}
	if (isUsageLimitError(errorMessage)) {
		return true;
	}
	const normalized = errorMessage.toLowerCase();
	if (TRANSIENT_SERVER_PATTERNS.some((pattern) => normalized.includes(pattern))) {
		return true;
	}
	if (PERMANENT_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern))) {
		return false;
	}
	// Unrecognized but short messages are cheap to give a bounded number of retries — the
	// caller's attempt cap is what keeps this from spamming a gated 3rd-party endpoint.
	return errorMessage.trim().length > 0 && errorMessage.trim().length <= SHORT_ERROR_MESSAGE_MAX_LENGTH;
}

const WINDOWS_INVALID_SESSION_ID_CHARS = /[<>:"/\\|?*]/g;

export interface ClineTaskSessionEntry {
	summary: RuntimeTaskSessionSummary;
	messages: ClineTaskMessage[];
	activeAssistantMessageId: string | null;
	activeReasoningMessageId: string | null;
	toolMessageIdByToolCallId: Map<string, string>;
	toolInputByToolCallId: Map<string, unknown>;
}

export interface ClineTaskMessage {
	id: string;
	role: "user" | "assistant" | "system" | "tool" | "reasoning" | "status";
	content: string;
	images?: RuntimeTaskImage[];
	createdAt: number;
	meta?: {
		toolName?: string | null;
		hookEventName?: string | null;
		toolCallId?: string | null;
		streamType?: string | null;
		messageKind?: string | null;
		displayRole?: string | null;
		reason?: string | null;
	} | null;
}

export function now(): number {
	return Date.now();
}

export function cloneSummary(summary: RuntimeTaskSessionSummary): RuntimeTaskSessionSummary {
	return {
		...summary,
		latestHookActivity: summary.latestHookActivity ? { ...summary.latestHookActivity } : null,
		latestTurnCheckpoint: summary.latestTurnCheckpoint ? { ...summary.latestTurnCheckpoint } : null,
		previousTurnCheckpoint: summary.previousTurnCheckpoint ? { ...summary.previousTurnCheckpoint } : null,
	};
}

export function cloneMessage(message: ClineTaskMessage): ClineTaskMessage {
	return {
		...message,
		images: message.images ? message.images.map((image) => ({ ...image })) : message.images,
		meta: message.meta ? { ...message.meta } : message.meta,
	};
}

export function createDefaultSummary(taskId: string): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "idle",
		mode: null,
		agentId: "cline",
		providerId: null,
		modelId: null,
		workspacePath: null,
		pid: null,
		startedAt: null,
		updatedAt: now(),
		activeRunMs: 0,
		runningSince: null,
		pausedAt: null,
		pauseReason: null,
		lastOutputAt: null,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		warningMessage: null,
		resumeAt: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
	};
}

export function updateSummary(
	entry: ClineTaskSessionEntry,
	patch: Partial<RuntimeTaskSessionSummary>,
): RuntimeTaskSessionSummary {
	const nowTs = now();
	entry.summary = {
		...entry.summary,
		...computeRunTimingPatch(entry.summary, patch, nowTs),
		...patch,
		updatedAt: nowTs,
	};
	return cloneSummary(entry.summary);
}

export function createMessage(
	taskId: string,
	role: ClineTaskMessage["role"],
	content: string,
	images?: RuntimeTaskImage[],
): ClineTaskMessage {
	return {
		id: `${taskId}-${now()}-${Math.random().toString(36).slice(2, 8)}`,
		role,
		content,
		images: images && images.length > 0 ? images.map((image) => ({ ...image })) : undefined,
		createdAt: now(),
	};
}

export function createMessageWithMeta(
	taskId: string,
	role: ClineTaskMessage["role"],
	content: string,
	meta: ClineTaskMessage["meta"],
	images?: RuntimeTaskImage[],
): ClineTaskMessage {
	return {
		...createMessage(taskId, role, content, images),
		meta,
	};
}

export function createSessionId(taskId: string): string {
	return `${toSessionIdTaskPrefix(taskId)}-${now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildSessionIdPrefix(taskId: string): string {
	return `${toSessionIdTaskPrefix(taskId)}-`;
}

function toSessionIdTaskPrefix(taskId: string): string {
	const normalized = taskId.replace(WINDOWS_INVALID_SESSION_ID_CHARS, "_").trim();
	return normalized.length > 0 ? normalized : "session";
}

export function isClineUserAttentionTool(toolName: string | null): boolean {
	if (!toolName) {
		return false;
	}
	return CLINE_USER_ATTENTION_TOOL_NAMES.has(toolName.trim().toLowerCase());
}

export function canReturnToRunning(reviewReason: RuntimeTaskSessionSummary["reviewReason"]): boolean {
	return reviewReason === "attention" || reviewReason === "hook" || reviewReason === "error";
}

export function latestAssistantMessageMatches(entry: ClineTaskSessionEntry, content: string): boolean {
	const latestAssistant = getLatestAssistantMessage(entry);
	if (!latestAssistant) {
		return false;
	}
	return latestAssistant.content.trim() === content.trim();
}

export function clearActiveTurnState(entry: ClineTaskSessionEntry): void {
	entry.activeAssistantMessageId = null;
	entry.activeReasoningMessageId = null;
	entry.toolMessageIdByToolCallId.clear();
	entry.toolInputByToolCallId.clear();
}

export function appendAssistantChunk(entry: ClineTaskSessionEntry, taskId: string, chunk: string): ClineTaskMessage {
	const existingMessageId = entry.activeAssistantMessageId;
	if (existingMessageId) {
		const updatedMessage = updateMessageInEntry(entry, existingMessageId, (currentMessage) => ({
			...currentMessage,
			content: `${currentMessage.content}${chunk}`,
		}));
		if (updatedMessage) {
			return updatedMessage;
		}
	}
	return createAssistantMessage(entry, taskId, chunk);
}

export function setOrCreateAssistantMessage(
	entry: ClineTaskSessionEntry,
	taskId: string,
	content: string,
): ClineTaskMessage | null {
	if (!entry.activeAssistantMessageId) {
		return null;
	}
	const updatedMessage = updateMessageInEntry(entry, entry.activeAssistantMessageId, (currentMessage) => ({
		...currentMessage,
		content,
	}));
	if (updatedMessage) {
		return updatedMessage;
	}
	return createAssistantMessage(entry, taskId, content);
}

export function appendReasoningChunk(entry: ClineTaskSessionEntry, taskId: string, chunk: string): ClineTaskMessage {
	const existingMessageId = entry.activeReasoningMessageId;
	if (existingMessageId) {
		const updatedMessage = updateMessageInEntry(entry, existingMessageId, (currentMessage) => ({
			...currentMessage,
			content: `${currentMessage.content}${chunk}`,
			meta: {
				...(currentMessage.meta ?? {}),
				hookEventName: "reasoning_delta",
				streamType: "reasoning",
			},
		}));
		if (updatedMessage) {
			return updatedMessage;
		}
	}
	return createReasoningMessage(entry, taskId, chunk, "reasoning_delta");
}

export function setOrCreateReasoningMessage(
	entry: ClineTaskSessionEntry,
	taskId: string,
	content: string,
): ClineTaskMessage | null {
	if (!entry.activeReasoningMessageId) {
		return null;
	}
	const updatedMessage = updateMessageInEntry(entry, entry.activeReasoningMessageId, (currentMessage) => ({
		...currentMessage,
		content,
		meta: {
			...(currentMessage.meta ?? {}),
			hookEventName: "reasoning_end",
			streamType: "reasoning",
		},
	}));
	if (updatedMessage) {
		return updatedMessage;
	}
	return createReasoningMessage(entry, taskId, content, "reasoning_end");
}

export function createAssistantMessage(
	entry: ClineTaskSessionEntry,
	taskId: string,
	content: string,
): ClineTaskMessage {
	const message = createMessage(taskId, "assistant", content);
	entry.messages.push(message);
	entry.activeAssistantMessageId = message.id;
	return message;
}

export function createReasoningMessage(
	entry: ClineTaskSessionEntry,
	taskId: string,
	content: string,
	hookEventName: string,
): ClineTaskMessage {
	const message = createMessageWithMeta(taskId, "reasoning", content, {
		hookEventName,
		streamType: "reasoning",
	});
	entry.messages.push(message);
	entry.activeReasoningMessageId = message.id;
	return message;
}

export function startToolCallMessage(
	entry: ClineTaskSessionEntry,
	taskId: string,
	input: {
		toolName: string | null;
		toolCallId: string | null;
		input: unknown;
	},
): ClineTaskMessage {
	const toolContent = buildToolCallContent({
		toolName: input.toolName,
		input: input.input,
	});
	const message = createMessageWithMeta(taskId, "tool", toolContent, {
		toolName: input.toolName,
		hookEventName: "tool_call_start",
		toolCallId: input.toolCallId,
		streamType: "tool",
	});
	entry.messages.push(message);
	if (input.toolCallId) {
		entry.toolMessageIdByToolCallId.set(input.toolCallId, message.id);
		entry.toolInputByToolCallId.set(input.toolCallId, input.input);
	}
	return message;
}

export function finishToolCallMessage(
	entry: ClineTaskSessionEntry,
	taskId: string,
	input: {
		toolName: string | null;
		toolCallId: string | null;
		output: unknown;
		error: string | null;
		durationMs: number | null;
	},
): ClineTaskMessage {
	const existingMessageId = input.toolCallId ? (entry.toolMessageIdByToolCallId.get(input.toolCallId) ?? null) : null;
	const toolInput = input.toolCallId ? entry.toolInputByToolCallId.get(input.toolCallId) : undefined;
	const content = buildToolCallContent({
		toolName: input.toolName,
		input: toolInput,
		output: input.output,
		error: input.error,
		durationMs: input.durationMs,
	});
	if (existingMessageId) {
		const updatedMessage = updateMessageInEntry(entry, existingMessageId, (currentMessage) => ({
			...currentMessage,
			content,
			meta: {
				...(currentMessage.meta ?? {}),
				toolName: input.toolName,
				hookEventName: "tool_call_end",
				toolCallId: input.toolCallId,
				streamType: "tool",
			},
		}));
		if (updatedMessage) {
			if (input.toolCallId) {
				entry.toolMessageIdByToolCallId.delete(input.toolCallId);
				entry.toolInputByToolCallId.delete(input.toolCallId);
			}
			return updatedMessage;
		}
	}
	const message = createMessageWithMeta(taskId, "tool", content, {
		toolName: input.toolName,
		hookEventName: "tool_call_end",
		toolCallId: input.toolCallId,
		streamType: "tool",
	});
	if (input.toolCallId) {
		entry.toolMessageIdByToolCallId.delete(input.toolCallId);
		entry.toolInputByToolCallId.delete(input.toolCallId);
	}
	entry.messages.push(message);
	return message;
}

function stringifyPayload(payload: unknown): string {
	if (payload === undefined || payload === null) {
		return "";
	}
	if (typeof payload === "string") {
		return payload;
	}
	try {
		return JSON.stringify(payload, null, 2);
	} catch {
		return String(payload);
	}
}

function buildToolCallContent(input: {
	toolName: string | null;
	input: unknown;
	output?: unknown;
	error?: string | null;
	durationMs?: number | null;
}): string {
	const lines: string[] = [];
	lines.push(`Tool: ${input.toolName ?? "unknown"}`);
	const inputText = stringifyPayload(input.input);
	if (inputText) {
		lines.push("Input:");
		lines.push(inputText);
	}
	if (input.error) {
		lines.push("Error:");
		lines.push(input.error);
	} else if (input.output !== undefined) {
		const outputText = stringifyPayload(input.output);
		if (outputText) {
			lines.push("Output:");
			lines.push(outputText);
		}
	}
	if (typeof input.durationMs === "number" && Number.isFinite(input.durationMs)) {
		lines.push(`Duration: ${Math.max(0, Math.round(input.durationMs))}ms`);
	}
	return lines.join("\n");
}

function updateMessageInEntry(
	entry: ClineTaskSessionEntry,
	messageId: string,
	updater: (currentMessage: ClineTaskMessage) => ClineTaskMessage,
): ClineTaskMessage | null {
	const messageIndex = entry.messages.findIndex((message) => message.id === messageId);
	if (messageIndex < 0) {
		return null;
	}
	const currentMessage = entry.messages[messageIndex];
	if (!currentMessage) {
		return null;
	}
	const nextMessage = updater(currentMessage);
	entry.messages[messageIndex] = nextMessage;
	return nextMessage;
}

function getLatestAssistantMessage(entry: ClineTaskSessionEntry): ClineTaskMessage | null {
	for (let index = entry.messages.length - 1; index >= 0; index -= 1) {
		const message = entry.messages[index];
		if (message?.role === "assistant") {
			return message;
		}
	}
	return null;
}
