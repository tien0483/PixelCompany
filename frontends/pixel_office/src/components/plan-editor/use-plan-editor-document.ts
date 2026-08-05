import { useCallback, useEffect, useRef, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeSavedPlan } from "@/runtime/types";

const AUTOSAVE_DEBOUNCE_MS = 500;

export type PlanSaveStatus = "idle" | "loading" | "saving" | "saved" | "error";

export interface UsePlanEditorDocumentResult {
	content: string;
	updateContent: (next: string) => void;
	status: PlanSaveStatus;
	statusLabel: string;
	/** Flushes any pending autosave immediately; call before navigating away. */
	flush: () => Promise<void>;
}

export function usePlanEditorDocument(
	plan: RuntimeSavedPlan | null,
	workspaceId: string | null | undefined,
): UsePlanEditorDocumentResult {
	const [content, setContent] = useState("");
	const [status, setStatus] = useState<PlanSaveStatus>("idle");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pendingContentRef = useRef<string | null>(null);
	const inFlightRef = useRef<Promise<void> | null>(null);
	const planId = plan?.id ?? null;

	const clearSaveTimer = useCallback(() => {
		if (saveTimerRef.current) {
			clearTimeout(saveTimerRef.current);
			saveTimerRef.current = null;
		}
	}, []);

	const flushSave = useCallback(async () => {
		if (!planId) {
			return;
		}
		const nextContent = pendingContentRef.current;
		if (nextContent === null) {
			return;
		}
		pendingContentRef.current = null;
		setStatus("saving");
		setErrorMessage(null);
		const writePromise = (async () => {
			const trpcClient = getRuntimeTrpcClient(workspaceId ?? null);
			const response = await trpcClient.plans.write.mutate({
				planId,
				content: nextContent,
			});
			if (!response.ok) {
				throw new Error(response.error ?? "Failed to save plan.");
			}
		})();
		inFlightRef.current = writePromise;
		try {
			await writePromise;
			if (pendingContentRef.current === null) {
				setStatus("saved");
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setStatus("error");
			setErrorMessage(message);
			showAppToast({ intent: "danger", message });
		} finally {
			inFlightRef.current = null;
			if (pendingContentRef.current !== null) {
				void flushSave();
			}
		}
	}, [planId, workspaceId]);

	const scheduleSave = useCallback(
		(nextContent: string) => {
			pendingContentRef.current = nextContent;
			clearSaveTimer();
			saveTimerRef.current = setTimeout(() => {
				void flushSave();
			}, AUTOSAVE_DEBOUNCE_MS);
		},
		[clearSaveTimer, flushSave],
	);

	const updateContent = useCallback(
		(next: string) => {
			setContent(next);
			scheduleSave(next);
		},
		[scheduleSave],
	);

	const flush = useCallback(async () => {
		clearSaveTimer();
		if (pendingContentRef.current !== null) {
			await flushSave();
		}
		if (inFlightRef.current) {
			await inFlightRef.current.catch(() => undefined);
		}
	}, [clearSaveTimer, flushSave]);

	useEffect(() => {
		if (!planId) {
			return;
		}
		let cancelled = false;
		setStatus("loading");
		setErrorMessage(null);
		pendingContentRef.current = null;
		clearSaveTimer();
		void (async () => {
			try {
				const trpcClient = getRuntimeTrpcClient(workspaceId ?? null);
				const response = await trpcClient.plans.read.query({ planId });
				if (cancelled) {
					return;
				}
				if (!response.ok || response.content === null) {
					setStatus("error");
					setErrorMessage(response.error ?? "Failed to load plan.");
					setContent("");
					return;
				}
				setContent(response.content);
				setStatus("saved");
			} catch (error) {
				if (cancelled) {
					return;
				}
				setStatus("error");
				setErrorMessage(error instanceof Error ? error.message : String(error));
				setContent("");
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [clearSaveTimer, planId, workspaceId]);

	useEffect(() => {
		return () => {
			clearSaveTimer();
		};
	}, [clearSaveTimer]);

	const statusLabel =
		status === "loading"
			? "Loading…"
			: status === "saving"
				? "Saving…"
				: status === "saved"
					? "Saved"
					: status === "error"
						? (errorMessage ?? "Error")
						: "";

	return { content, updateContent, status, statusLabel, flush };
}
