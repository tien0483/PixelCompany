import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { Dialog, DialogBody, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeSavedPlan } from "@/runtime/types";

const AUTOSAVE_DEBOUNCE_MS = 500;

type SaveStatus = "idle" | "loading" | "saving" | "saved" | "error";

export function PlanEditorDialog({
	open,
	plan,
	workspaceId = null,
	onOpenChange,
}: {
	open: boolean;
	plan: RuntimeSavedPlan | null;
	workspaceId?: string | null;
	onOpenChange: (open: boolean) => void;
}): ReactElement {
	const [content, setContent] = useState("");
	const [status, setStatus] = useState<SaveStatus>("idle");
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
			const trpcClient = getRuntimeTrpcClient(workspaceId);
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

	useEffect(() => {
		if (!open || !planId) {
			return;
		}
		let cancelled = false;
		setStatus("loading");
		setErrorMessage(null);
		pendingContentRef.current = null;
		clearSaveTimer();
		void (async () => {
			try {
				const trpcClient = getRuntimeTrpcClient(workspaceId);
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
	}, [clearSaveTimer, open, planId, workspaceId]);

	useEffect(() => {
		return () => {
			clearSaveTimer();
		};
	}, [clearSaveTimer]);

	const handleOpenChange = useCallback(
		async (nextOpen: boolean) => {
			if (!nextOpen) {
				clearSaveTimer();
				if (pendingContentRef.current !== null) {
					await flushSave();
				}
				if (inFlightRef.current) {
					await inFlightRef.current.catch(() => undefined);
				}
			}
			onOpenChange(nextOpen);
		},
		[clearSaveTimer, flushSave, onOpenChange],
	);

	const statusLabel =
		status === "loading"
			? "Loading…"
			: status === "saving"
				? "Saving…"
				: status === "saved"
					? "Saved"
					: status === "error"
						? errorMessage ?? "Error"
						: "";

	return (
		<Dialog open={open} onOpenChange={(next) => void handleOpenChange(next)}>
			<DialogHeader title={plan?.name ?? "Plan"} />
			<DialogBody className="flex min-h-[420px] flex-col gap-2">
				<p className="text-[11px] text-text-tertiary truncate" title={plan?.path}>
					{plan?.path}
				</p>
				<div className="flex items-center justify-between text-[11px] text-text-secondary min-h-[16px]">
					<span>{statusLabel}</span>
					{status === "loading" || status === "saving" ? <Spinner size={12} /> : null}
				</div>
				<textarea
					value={content}
					onChange={(event) => {
						const next = event.currentTarget.value;
						setContent(next);
						scheduleSave(next);
					}}
					disabled={status === "loading" || !plan}
					spellCheck={false}
					className="min-h-[360px] flex-1 w-full resize-none rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[13px] leading-5 text-text-primary focus:border-border-focus focus:outline-none disabled:opacity-50"
					data-testid="plan-editor-textarea"
				/>
			</DialogBody>
		</Dialog>
	);
}
