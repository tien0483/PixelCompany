import type { Editor } from "@tiptap/react";
import { FileCode2, X } from "lucide-react";
import {
	lazy,
	type ReactElement,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import { showAppToast } from "@/components/app-toaster";
import {
	insertAtCursor,
	type TextSelectionState,
} from "@/components/plan-editor/markdown-selection-commands";
import { PlanEditorErrorBoundary } from "@/components/plan-editor/plan-editor-error-boundary";
import { PlanMarkdownToolbar } from "@/components/plan-editor/plan-markdown-toolbar";
import { insertMarkdownImage } from "@/components/plan-editor/plan-rich-markdown";
import { usePlanEditorDocument } from "@/components/plan-editor/use-plan-editor-document";
import { usePlanImagePaste } from "@/components/plan-editor/use-plan-image-paste";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { HtmlGenerateDialog } from "@/html/html-generate-dialog";
import { HTML_LABELS } from "@/html/html-labels";
import type { RuntimeSavedPlan } from "@/runtime/types";

const PlanRichEditor = lazy(
	() => import("@/components/plan-editor/plan-rich-editor"),
);
const PlanRichPreview = lazy(
	() => import("@/components/plan-editor/plan-rich-preview"),
);

type PlanEditorMode = "rich" | "plain" | "preview";
type PlanFileKind = "markdown" | "html" | "text";

function planFileKind(path: string): PlanFileKind {
	const lower = path.toLowerCase();
	if (lower.endsWith(".html") || lower.endsWith(".htm")) {
		return "html";
	}
	if (lower.endsWith(".txt")) {
		return "text";
	}
	return "markdown";
}

function fileTypeLabel(kind: PlanFileKind): string {
	if (kind === "html") return "HTML";
	if (kind === "text") return "Text";
	return "Markdown";
}

export interface PlanEditorViewProps {
	plan: RuntimeSavedPlan;
	workspaceId: string | null;
	onClose: () => void;
}

export function PlanEditorView({
	plan,
	workspaceId,
	onClose,
}: PlanEditorViewProps): ReactElement {
	const kind = useMemo(() => planFileKind(plan.path), [plan.path]);
	const { content, updateContent, statusLabel, status, flush } =
		usePlanEditorDocument(plan, workspaceId);
	const [mode, setMode] = useState<PlanEditorMode>(kind === "html" ? "preview" : "rich");
	const [generateOpen, setGenerateOpen] = useState(false);
	const hasWarnedAboutRichModeRef = useRef(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const richEditorRef = useRef<Editor | null>(null);

	useEffect(() => {
		setMode(kind === "html" ? "preview" : "rich");
	}, [kind, plan.id]);

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

	const {
		isUploading,
		uploadImageFile,
		handlePaste,
		handleDrop,
		handleDragOver,
	} = usePlanImagePaste(plan.id, workspaceId, insertMarkdownAtCursor);

	const handleEditorReady = useCallback((editor: Editor | null) => {
		richEditorRef.current = editor;
	}, []);

	const handleSwitchToPlain = useCallback(() => {
		setMode("plain");
	}, []);

	const handleSwitchToPreview = useCallback(() => {
		setMode("preview");
	}, []);

	const handleSwitchToRich = useCallback(() => {
		if (kind === "html") {
			return;
		}
		if (!hasWarnedAboutRichModeRef.current) {
			hasWarnedAboutRichModeRef.current = true;
			showAppToast({
				intent: "warning",
				message:
					"Rich mode may reformat parts of the markdown file when you save.",
			});
		}
		setMode("rich");
	}, [kind]);

	const handleRichEditorError = useCallback((error: Error) => {
		setMode("plain");
		showAppToast({
			intent: "danger",
			message:
				error.message || "Rich editor failed. Switched to plain text editing.",
		});
	}, []);

	const handlePreviewError = useCallback((error: Error) => {
		setMode("plain");
		showAppToast({
			intent: "danger",
			message:
				error.message || "Preview failed to render. Switched to plain text editing.",
		});
	}, []);

	useEffect(() => {
		if (kind === "html" || hasWarnedAboutRichModeRef.current) {
			return;
		}
		hasWarnedAboutRichModeRef.current = true;
		showAppToast({
			intent: "warning",
			message:
				"Rich mode may reformat parts of the markdown file when you save.",
		});
	}, [kind]);

	const handleClose = useCallback(() => {
		void flush().then(onClose);
	}, [flush, onClose]);

	const showRich = kind !== "html" && mode === "rich";
	const showPreview = mode === "preview";
	const showPlain = mode === "plain" || (kind === "html" && mode !== "preview" && !showRich);

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
					<span className="truncate text-sm font-semibold text-text-primary">
						{plan.name}
					</span>
					<span
						className="truncate text-[11px] text-text-tertiary"
						title={plan.path}
					>
						{plan.path}
					</span>
				</div>
				<div className="flex items-center gap-3">
					{kind !== "html" ? (
						<Button
							variant="ghost"
							size="sm"
							icon={<FileCode2 size={14} />}
							onClick={() => setGenerateOpen(true)}
							data-testid="plan-editor-generate-html"
						>
							{HTML_LABELS.generate}
						</Button>
					) : null}
					<div className="flex items-center gap-1.5 text-[11px] text-text-secondary min-w-[80px] justify-end">
						{status === "loading" || status === "saving" || isUploading ? (
							<Spinner size={12} />
						) : null}
						<span>{isUploading ? "Uploading…" : statusLabel}</span>
					</div>
					<Button
						variant="ghost"
						size="sm"
						icon={<X size={14} />}
						aria-label="Close plan editor"
						onClick={handleClose}
					/>
				</div>
			</div>

			{showPlain && kind !== "html" ? (
				<PlanMarkdownToolbar
					disabled={status === "loading"}
					onCommand={applyTextCommand}
					onInsertImage={(file) => void uploadImageFile(file)}
				/>
			) : null}

			<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				{showPreview && kind === "html" ? (
					<iframe
						title={HTML_LABELS.preview}
						sandbox="allow-scripts"
						srcDoc={content}
						className="min-h-0 flex-1 w-full border-0 bg-white"
						data-testid="plan-editor-html-preview"
					/>
				) : showPreview ? (
					<div
						className="flex min-h-0 flex-1 flex-col overflow-auto bg-surface-1"
						data-testid="plan-editor-markdown-preview"
					>
						<PlanEditorErrorBoundary onError={handlePreviewError}>
							<Suspense
								fallback={
									<div className="flex flex-1 items-center justify-center">
										<Spinner size={20} />
									</div>
								}
							>
								<PlanRichPreview content={content} planId={plan.id} />
							</Suspense>
						</PlanEditorErrorBoundary>
					</div>
				) : showPlain ? (
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
					<PlanEditorErrorBoundary onError={handleRichEditorError}>
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
					</PlanEditorErrorBoundary>
				)}
			</div>

			<div className="flex items-center justify-between gap-3 border-t border-border bg-surface-1 px-3 py-1.5 shrink-0">
				<div className="flex items-center gap-3">
					{mode !== "plain" ? (
						<button
							type="button"
							className="text-[12px] text-accent hover:underline cursor-pointer bg-transparent border-0 p-0"
							onClick={handleSwitchToPlain}
							data-testid="plan-editor-switch-to-plain"
						>
							{kind === "html" ? "Edit source" : "Switch to plain text editing"}
						</button>
					) : null}
					{mode !== "preview" ? (
						<button
							type="button"
							className="text-[12px] text-accent hover:underline cursor-pointer bg-transparent border-0 p-0"
							onClick={handleSwitchToPreview}
							data-testid="plan-editor-switch-to-preview"
						>
							{HTML_LABELS.preview}
						</button>
					) : null}
					{kind !== "html" && mode !== "rich" ? (
						<button
							type="button"
							className="text-[12px] text-accent hover:underline cursor-pointer bg-transparent border-0 p-0"
							onClick={handleSwitchToRich}
							data-testid="plan-editor-switch-to-rich"
						>
							Switch to rich text editing
						</button>
					) : null}
				</div>
				<span className="text-[11px] text-text-tertiary">{fileTypeLabel(kind)}</span>
			</div>

			<HtmlGenerateDialog
				open={generateOpen}
				onOpenChange={setGenerateOpen}
				planId={plan.id}
				content={content}
				format={kind === "text" ? "text" : "markdown"}
				workspaceId={workspaceId}
			/>
		</div>
	);
}
