import { X } from "lucide-react";
import {
	type ReactElement,
	Suspense,
	lazy,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type { Editor } from "@tiptap/react";

import { showAppToast } from "@/components/app-toaster";
import { insertAtCursor, type TextSelectionState } from "@/components/plan-editor/markdown-selection-commands";
import { PlanMarkdownToolbar } from "@/components/plan-editor/plan-markdown-toolbar";
import { insertMarkdownImage } from "@/components/plan-editor/plan-rich-markdown";
import { usePlanEditorDocument } from "@/components/plan-editor/use-plan-editor-document";
import { usePlanImagePaste } from "@/components/plan-editor/use-plan-image-paste";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { RuntimeSavedPlan } from "@/runtime/types";

const PlanRichEditor = lazy(() => import("@/components/plan-editor/plan-rich-editor"));

type PlanEditorMode = "rich" | "plain";

export interface PlanEditorViewProps {
	plan: RuntimeSavedPlan;
	workspaceId: string | null;
	onClose: () => void;
}

export function PlanEditorView({ plan, workspaceId, onClose }: PlanEditorViewProps): ReactElement {
	const { content, updateContent, statusLabel, status, flush } = usePlanEditorDocument(plan, workspaceId);
	const [mode, setMode] = useState<PlanEditorMode>("rich");
	const hasWarnedAboutRichModeRef = useRef(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const richEditorRef = useRef<Editor | null>(null);

	const applyTextCommand = useCallback(
		(transform: (state: TextSelectionState) => TextSelectionState) => {
			const textarea = textareaRef.current;
			const selectionStart = textarea?.selectionStart ?? content.length;
			const selectionEnd = textarea?.selectionEnd ?? content.length;
			const next = transform({ value: content, selectionStart, selectionEnd });
			updateContent(next.value);
			requestAnimationFrame(() => {
				textarea?.focus();
				textarea?.setSelectionRange(next.selectionStart, next.selectionEnd);
			});
		},
		[content, updateContent],
	);

	const insertMarkdownAtCursor = useCallback(
		(markdown: string) => {
			if (mode === "rich" && richEditorRef.current) {
				insertMarkdownImage(richEditorRef.current, markdown, plan.id);
				return;
			}
			applyTextCommand((state) => insertAtCursor(state, `${markdown}\n`));
		},
		[applyTextCommand, mode, plan.id],
	);

	const { isUploading, uploadImageFile, handlePaste, handleDrop, handleDragOver } = usePlanImagePaste(
		plan.id,
		workspaceId,
		insertMarkdownAtCursor,
	);

	const handleEditorReady = useCallback((editor: Editor | null) => {
		richEditorRef.current = editor;
	}, []);

	const handleSwitchToPlain = useCallback(() => {
		setMode("plain");
	}, []);

	const handleSwitchToRich = useCallback(() => {
		if (!hasWarnedAboutRichModeRef.current) {
			hasWarnedAboutRichModeRef.current = true;
			showAppToast({
				intent: "warning",
				message: "Rich mode may reformat parts of the markdown file when you save.",
			});
		}
		setMode("rich");
	}, []);

	// First open is already rich — warn once after mount so users know about possible reformatting.
	useEffect(() => {
		if (hasWarnedAboutRichModeRef.current) {
			return;
		}
		hasWarnedAboutRichModeRef.current = true;
		showAppToast({
			intent: "warning",
			message: "Rich mode may reformat parts of the markdown file when you save.",
		});
	}, []);

	const handleClose = useCallback(() => {
		void flush().then(onClose);
	}, [flush, onClose]);

	return (
		<div
			className="flex flex-1 min-h-0 min-w-0 flex-col"
			style={{ background: "var(--color-surface-0)" }}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					handleClose();
				}
			}}
		>
			<div className="flex items-center justify-between gap-3 border-b border-border bg-surface-1 px-3 py-2 shrink-0">
				<div className="flex min-w-0 flex-col gap-0.5">
					<span className="truncate text-sm font-semibold text-text-primary">{plan.name}</span>
					<span className="truncate text-[11px] text-text-tertiary" title={plan.path}>
						{plan.path}
					</span>
				</div>
				<div className="flex items-center gap-3">
					<div className="flex items-center gap-1.5 text-[11px] text-text-secondary min-w-[80px] justify-end">
						{status === "loading" || status === "saving" || isUploading ? <Spinner size={12} /> : null}
						<span>{isUploading ? "Uploading…" : statusLabel}</span>
					</div>
					<Button variant="ghost" size="sm" icon={<X size={14} />} aria-label="Close plan editor" onClick={handleClose} />
				</div>
			</div>

			{mode === "plain" ? (
				<PlanMarkdownToolbar
					disabled={status === "loading"}
					onCommand={applyTextCommand}
					onInsertImage={(file) => void uploadImageFile(file)}
				/>
			) : null}

			<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				{mode === "plain" ? (
					<textarea
						ref={textareaRef}
						value={content}
						onChange={(event) => updateContent(event.currentTarget.value)}
						onPaste={handlePaste}
						onDrop={handleDrop}
						onDragOver={handleDragOver}
						disabled={status === "loading"}
						spellCheck={false}
						className="min-h-0 flex-1 w-full resize-none border-0 bg-surface-1 px-3 py-2 font-mono text-[13px] leading-5 text-text-primary focus:outline-none disabled:opacity-50"
						data-testid="plan-editor-textarea"
					/>
				) : (
					<Suspense
						fallback={
							<div className="flex flex-1 items-center justify-center">
								<Spinner size={20} />
							</div>
						}
					>
						<PlanRichEditor
							content={content}
							onChange={updateContent}
							planId={plan.id}
							disabled={status === "loading"}
							onInsertImage={(file) => void uploadImageFile(file)}
							onPaste={handlePaste}
							onDrop={handleDrop}
							onDragOver={handleDragOver}
							onEditorReady={handleEditorReady}
						/>
					</Suspense>
				)}
			</div>

			<div className="flex items-center justify-between gap-3 border-t border-border bg-surface-1 px-3 py-1.5 shrink-0">
				{mode === "rich" ? (
					<button
						type="button"
						className="text-[12px] text-accent hover:underline cursor-pointer bg-transparent border-0 p-0"
						onClick={handleSwitchToPlain}
						data-testid="plan-editor-switch-to-plain"
					>
						Switch to plain text editing
					</button>
				) : (
					<button
						type="button"
						className="text-[12px] text-accent hover:underline cursor-pointer bg-transparent border-0 p-0"
						onClick={handleSwitchToRich}
						data-testid="plan-editor-switch-to-rich"
					>
						Switch to rich text editing
					</button>
				)}
				<span className="text-[11px] text-text-tertiary">Markdown</span>
			</div>
		</div>
	);
}
