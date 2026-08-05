import { Columns2, Eye, FileText, Sparkles, X } from "lucide-react";
import { type ReactElement, Suspense, lazy, useCallback, useMemo, useRef, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { insertAtCursor, type TextSelectionState } from "@/components/plan-editor/markdown-selection-commands";
import { PlanMarkdownPreview } from "@/components/plan-editor/plan-markdown-preview";
import { PlanMarkdownToolbar } from "@/components/plan-editor/plan-markdown-toolbar";
import { usePlanEditorDocument } from "@/components/plan-editor/use-plan-editor-document";
import { usePlanImagePaste } from "@/components/plan-editor/use-plan-image-paste";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { ResizeHandle } from "@/resize/resize-handle";
import { useResizeDrag } from "@/resize/use-resize-drag";
import type { RuntimeSavedPlan } from "@/runtime/types";

const PlanRichEditor = lazy(() => import("@/components/plan-editor/plan-rich-editor"));

type PlanEditorMode = "split" | "source" | "preview" | "rich";

const MODE_OPTIONS: Array<{ mode: PlanEditorMode; label: string; icon: ReactElement }> = [
	{ mode: "split", label: "Split", icon: <Columns2 size={13} /> },
	{ mode: "source", label: "Source", icon: <FileText size={13} /> },
	{ mode: "preview", label: "Preview", icon: <Eye size={13} /> },
	{ mode: "rich", label: "Rich", icon: <Sparkles size={13} /> },
];

const MIN_SOURCE_PANE_PERCENT = 20;
const MAX_SOURCE_PANE_PERCENT = 80;

export interface PlanEditorViewProps {
	plan: RuntimeSavedPlan;
	workspaceId: string | null;
	onClose: () => void;
}

export function PlanEditorView({ plan, workspaceId, onClose }: PlanEditorViewProps): ReactElement {
	const { content, updateContent, statusLabel, status, flush } = usePlanEditorDocument(plan, workspaceId);
	const [mode, setMode] = useState<PlanEditorMode>("split");
	const [sourcePanePercent, setSourcePanePercent] = useState(50);
	const hasWarnedAboutRichModeRef = useRef(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const { startDrag } = useResizeDrag();

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
			applyTextCommand((state) => insertAtCursor(state, `${markdown}\n`));
		},
		[applyTextCommand],
	);

	const { isUploading, uploadImageFile, handlePaste, handleDrop, handleDragOver } = usePlanImagePaste(
		plan.id,
		workspaceId,
		insertMarkdownAtCursor,
	);

	const handleSelectMode = useCallback((nextMode: PlanEditorMode) => {
		if (nextMode === "rich" && !hasWarnedAboutRichModeRef.current) {
			hasWarnedAboutRichModeRef.current = true;
			showAppToast({
				intent: "warning",
				message: "Rich mode may reformat parts of the markdown file when you save.",
			});
		}
		setMode(nextMode);
	}, []);

	const handleClose = useCallback(() => {
		void flush().then(onClose);
	}, [flush, onClose]);

	const handleSourceSeparatorMouseDown = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			const container = containerRef.current;
			if (!container) {
				return;
			}
			const containerRect = container.getBoundingClientRect();
			startDrag(event, {
				axis: "x",
				cursor: "ew-resize",
				onMove: (pointerX) => {
					const deltaPercent = ((pointerX - containerRect.left) / containerRect.width) * 100;
					const clamped = Math.min(MAX_SOURCE_PANE_PERCENT, Math.max(MIN_SOURCE_PANE_PERCENT, deltaPercent));
					setSourcePanePercent(clamped);
				},
			});
		},
		[startDrag],
	);

	const showToolbar = mode === "split" || mode === "source";
	const showSourcePane = mode === "split" || mode === "source";
	const showPreviewPane = mode === "split" || mode === "preview";

	const sourcePane = useMemo(
		() => (
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
		),
		[content, handleDragOver, handleDrop, handlePaste, status, updateContent],
	);

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
					<div className="flex items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5">
						{MODE_OPTIONS.map((option) => (
							<Tooltip key={option.mode} content={option.label}>
								<button
									type="button"
									aria-label={option.label}
									aria-pressed={mode === option.mode}
									onClick={() => handleSelectMode(option.mode)}
									className={cn(
										"flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium cursor-pointer",
										mode === option.mode
											? "bg-accent text-accent-fg"
											: "text-text-secondary hover:bg-surface-3 hover:text-text-primary",
									)}
								>
									{option.icon}
									{option.label}
								</button>
							</Tooltip>
						))}
					</div>
					<Button variant="ghost" size="sm" icon={<X size={14} />} aria-label="Close plan editor" onClick={handleClose} />
				</div>
			</div>

			{showToolbar ? (
				<PlanMarkdownToolbar disabled={status === "loading"} onCommand={applyTextCommand} onInsertImage={(file) => void uploadImageFile(file)} />
			) : null}

			<div ref={containerRef} className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
				{showSourcePane ? (
					<div
						className="flex min-h-0 min-w-0 flex-col"
						style={{ flex: mode === "split" ? `0 0 ${sourcePanePercent}%` : "1 1 0" }}
					>
						{sourcePane}
					</div>
				) : null}
				{mode === "split" ? (
					<ResizeHandle orientation="vertical" ariaLabel="Resize source and preview panes" onMouseDown={handleSourceSeparatorMouseDown} />
				) : null}
				{showPreviewPane ? (
					<div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-2">
						<PlanMarkdownPreview content={content} planId={plan.id} />
					</div>
				) : null}
				{mode === "rich" ? (
					<Suspense
						fallback={
							<div className="flex flex-1 items-center justify-center">
								<Spinner size={20} />
							</div>
						}
					>
						<PlanRichEditor content={content} onChange={updateContent} planId={plan.id} disabled={status === "loading"} />
					</Suspense>
				) : null}
			</div>
		</div>
	);
}
