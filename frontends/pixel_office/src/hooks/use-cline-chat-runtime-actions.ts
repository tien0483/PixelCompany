// Shared TRPC action hook for every native Cline chat surface.
// Detail view and home sidebar both use this to send messages, cancel turns,
// and load history through one runtime contract.
import { useCallback } from "react";

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeTaskChatMessage,
	RuntimeTaskImage,
	RuntimeTaskSessionMode,
	RuntimeTaskSessionSummary,
} from "@/runtime/types";

export interface ClineChatActionResult {
	ok: boolean;
	message?: string;
	chatMessage?: RuntimeTaskChatMessage | null;
}

export interface ClineChatModelActionResult extends ClineChatActionResult {
	/** false when the running session could not hot-swap and the model applies at next start. */
	applied?: boolean;
	warning?: string | null;
}

export interface SendClineChatMessageOptions {
	mode?: RuntimeTaskSessionMode;
	images?: RuntimeTaskImage[];
}

interface UseClineChatRuntimeActionsInput {
	currentProjectId: string | null;
	onSessionSummary?: (summary: RuntimeTaskSessionSummary) => void;
}

interface UseClineChatRuntimeActionsResult {
	sendTaskChatMessage: (
		taskId: string,
		text: string,
		options?: SendClineChatMessageOptions,
	) => Promise<ClineChatActionResult>;
	loadTaskChatMessages: (taskId: string) => Promise<RuntimeTaskChatMessage[] | null>;
	abortTaskChatTurn: (taskId: string) => Promise<ClineChatActionResult>;
	cancelTaskChatTurn: (taskId: string) => Promise<ClineChatActionResult>;
	setTaskChatModel: (taskId: string, modelId: string, providerId?: string) => Promise<ClineChatModelActionResult>;
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function useClineChatRuntimeActions({
	currentProjectId,
	onSessionSummary,
}: UseClineChatRuntimeActionsInput): UseClineChatRuntimeActionsResult {
	const sendTaskChatMessage = useCallback(
		async (taskId: string, text: string, options?: SendClineChatMessageOptions): Promise<ClineChatActionResult> => {
			if (!currentProjectId) {
				return { ok: false, message: "No project selected." };
			}
			try {
				const payload = await getRuntimeTrpcClient(currentProjectId).runtime.sendTaskChatMessage.mutate({
					taskId,
					text,
					...(options?.images && options.images.length > 0 ? { images: options.images } : {}),
					...(options?.mode ? { mode: options.mode } : {}),
				});
				if (!payload.ok) {
					return { ok: false, message: payload.error ?? "Task chat message failed." };
				}
				if (payload.summary) {
					onSessionSummary?.(payload.summary);
				}
				return {
					ok: true,
					chatMessage: payload.message ?? null,
				};
			} catch (error) {
				return { ok: false, message: toErrorMessage(error) };
			}
		},
		[currentProjectId, onSessionSummary],
	);

	const loadTaskChatMessages = useCallback(
		async (taskId: string): Promise<RuntimeTaskChatMessage[] | null> => {
			if (!currentProjectId) {
				return null;
			}
			try {
				const payload = await getRuntimeTrpcClient(currentProjectId).runtime.getTaskChatMessages.query({ taskId });
				return payload.ok ? payload.messages : null;
			} catch {
				return null;
			}
		},
		[currentProjectId],
	);

	const abortTaskChatTurn = useCallback(
		async (taskId: string): Promise<ClineChatActionResult> => {
			if (!currentProjectId) {
				return { ok: false, message: "No project selected." };
			}
			try {
				const payload = await getRuntimeTrpcClient(currentProjectId).runtime.abortTaskChatTurn.mutate({ taskId });
				if (!payload.ok) {
					return { ok: false, message: payload.error ?? "Could not abort chat turn." };
				}
				if (payload.summary) {
					onSessionSummary?.(payload.summary);
				}
				return { ok: true };
			} catch (error) {
				return { ok: false, message: toErrorMessage(error) };
			}
		},
		[currentProjectId, onSessionSummary],
	);

	const cancelTaskChatTurn = useCallback(
		async (taskId: string): Promise<ClineChatActionResult> => {
			if (!currentProjectId) {
				return { ok: false, message: "No project selected." };
			}
			try {
				const payload = await getRuntimeTrpcClient(currentProjectId).runtime.cancelTaskChatTurn.mutate({ taskId });
				if (!payload.ok) {
					return { ok: false, message: payload.error ?? "Could not cancel chat turn." };
				}
				if (payload.summary) {
					onSessionSummary?.(payload.summary);
				}
				return { ok: true };
			} catch (error) {
				return { ok: false, message: toErrorMessage(error) };
			}
		},
		[currentProjectId, onSessionSummary],
	);

	// Switches the model of the live session. The card-level pin is persisted separately by the
	// caller; this is what makes the choice take effect without restarting the conversation.
	const setTaskChatModel = useCallback(
		async (taskId: string, modelId: string, providerId?: string): Promise<ClineChatModelActionResult> => {
			if (!currentProjectId) {
				return { ok: false, message: "No project selected." };
			}
			try {
				const payload = await getRuntimeTrpcClient(currentProjectId).runtime.setTaskChatModel.mutate({
					taskId,
					modelId,
					...(providerId ? { providerId } : {}),
				});
				if (!payload.ok) {
					return { ok: false, applied: false, message: payload.error ?? "Could not switch the model." };
				}
				if (payload.summary) {
					onSessionSummary?.(payload.summary);
				}
				return { ok: true, applied: payload.applied, warning: payload.warning ?? null };
			} catch (error) {
				return { ok: false, applied: false, message: toErrorMessage(error) };
			}
		},
		[currentProjectId, onSessionSummary],
	);

	return {
		sendTaskChatMessage,
		loadTaskChatMessages,
		abortTaskChatTurn,
		cancelTaskChatTurn,
		setTaskChatModel,
	};
}
