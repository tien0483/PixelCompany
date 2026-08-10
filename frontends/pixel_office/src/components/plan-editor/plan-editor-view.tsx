import type { Editor } from "@tiptap/react";
import { AlertTriangle, X } from "lucide-react";
import {
	lazy,
	type MouseEvent as ReactMouseEvent,
	type ReactElement,
	type ReactNode,
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
import { PlanAiPromptBar, type PlanAiPromptMode } from "@/components/plan-editor/plan-ai-prompt-bar";
import { splitBriefResult } from "@/components/plan-editor/plan-brief-result";
import { PlanEditorErrorBoundary } from "@/components/plan-editor/plan-editor-error-boundary";
import { PlanHtmlGenerateBar } from "@/components/plan-editor/plan-html-generate-bar";
import {
	PlanHtmlPreviewFrame,
	type PlanHtmlPreviewMode,
} from "@/components/plan-editor/plan-html-preview-frame";
import { PlanImageButton } from "@/components/plan-editor/plan-image-button";
import { PlanMarkdownToolbar } from "@/components/plan-editor/plan-markdown-toolbar";
import { buildRefineDiff } from "@/components/plan-editor/plan-refine-diff";
import { insertMarkdownImage } from "@/components/plan-editor/plan-rich-markdown";
import { usePlanEditorDocument } from "@/components/plan-editor/use-plan-editor-document";
import { usePlanHtmlSibling } from "@/components/plan-editor/use-plan-html-sibling";
import { usePlanHtmlSource } from "@/components/plan-editor/use-plan-html-source";
import { usePlanImagePaste } from "@/components/plan-editor/use-plan-image-paste";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { HTML_LABELS } from "@/html/html-labels";
import { useHtmlBrief, useHtmlDraft, useHtmlGenerate } from "@/html/use-html-agent-stream";
import { ResizeHandle } from "@/resize/resize-handle";
import { usePlanEditorLayout } from "@/resize/use-plan-editor-layout";
import { useResizeDrag } from "@/resize/use-resize-drag";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeSavedPlan } from "@/runtime/types";

const PlanRichEditor = lazy(
	() => import("@/components/plan-editor/plan-rich-editor"),
);

/** Which file the split view is showing: the plan's markdown, or its generated HTML sibling. */
type PlanEditorSource = "md" | "html";
type PlanEditorPane = "raw" | "rendered";
type PlanFileKind = "markdown" | "html" | "text";

/** How long raw-pane typing is allowed to run ahead of the rendered pane. */
const RENDERED_SYNC_DEBOUNCE_MS = 250;

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

function SourceSwitch({
	value,
	htmlEnabled,
	disabled,
	onChange,
	testId,
}: {
	value: PlanEditorSource;
	htmlEnabled: boolean;
	disabled?: boolean;
	onChange: (next: PlanEditorSource) => void;
	testId: string;
}): ReactElement {
	const options: ReadonlyArray<{ id: PlanEditorSource; label: string }> = [
		{ id: "md", label: "MD" },
		{ id: "html", label: "HTML" },
	];
	return (
		<div
			className="inline-flex items-center gap-0.5 rounded-md border border-border bg-surface-3 p-0.5"
			data-testid={testId}
		>
			{options.map((option) => {
				const optionDisabled = disabled || (option.id === "html" && !htmlEnabled);
				return (
					<button
						key={option.id}
						type="button"
						aria-pressed={value === option.id}
						disabled={optionDisabled}
						title={
							option.id === "html" && !htmlEnabled
								? "Generate HTML first to enable this view."
								: undefined
						}
						onClick={() => onChange(option.id)}
						className={cn(
							"rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
							value === option.id
								? "bg-surface-1 text-text-primary"
								: "text-text-tertiary",
							optionDisabled
								? "cursor-not-allowed opacity-40"
								: "cursor-pointer hover:text-text-primary",
						)}
					>
						{option.label}
					</button>
				);
			})}
		</div>
	);
}

export interface PlanEditorViewProps {
	plan: RuntimeSavedPlan;
	workspaceId: string | null;
	onClose: () => void;
	/**
	 * Extra controls for the header, left of the save status. The standalone Plan
	 * Editor package puts its theme picker here — inside the full app that chrome
	 * belongs to Settings, so it passes nothing.
	 */
	headerActions?: ReactNode;
}

export function PlanEditorView({
	plan,
	workspaceId,
	onClose,
	headerActions,
}: PlanEditorViewProps): ReactElement {
	const kind = useMemo(() => planFileKind(plan.path), [plan.path]);
	/** The plan file itself is HTML — there is no markdown side to show or generate from. */
	const isHtmlPlan = kind === "html";

	const mdDoc = usePlanEditorDocument(plan, workspaceId);
	const { sibling, setSibling } = usePlanHtmlSibling(isHtmlPlan ? null : plan, workspaceId);
	const siblingDoc = usePlanEditorDocument(sibling, workspaceId);
	/** For an HTML plan the main document *is* the HTML; otherwise it's the generated sibling. */
	const htmlDoc = isHtmlPlan ? mdDoc : siblingDoc;

	const [sourceState, setSourceState] = useState<PlanEditorSource>("md");
	const source: PlanEditorSource = isHtmlPlan ? "html" : sourceState;
	/**
	 * Mirror of `sourceState` for the generation-completion effect, which needs the value it
	 * would revert to on a failed save but must not re-run when the user flips the MD/HTML
	 * switch — re-running it would re-save the same document.
	 */
	const sourceStateRef = useRef<PlanEditorSource>("md");
	useEffect(() => {
		sourceStateRef.current = sourceState;
	}, [sourceState]);
	const [focusedPane, setFocusedPane] = useState<PlanEditorPane>("raw");
	const [richFailed, setRichFailed] = useState(false);
	const [logOpen, setLogOpen] = useState(false);
	/**
	 * The raw pane's live selection, mirrored into state so the prompt bar can switch
	 * between "draft" and "rewrite this" as the user selects. Offsets only: the text is
	 * sliced out of the document at submit time, when it is guaranteed current.
	 */
	const [rawSelection, setRawSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });

	const generate = useHtmlGenerate();
	const brief = useHtmlBrief();
	const draft = useHtmlDraft();
	const savedHtmlRef = useRef<string | null>(null);
	/**
	 * The markdown the current `<stem>.html` was generated from, persisted as
	 * `<stem>.html.src.md`. Refine diffs against it, so it must be the text the agent actually
	 * saw — not whatever the user has typed since, and not something that evaporates on reload.
	 */
	const htmlSource = usePlanHtmlSource(isHtmlPlan ? null : plan.id, workspaceId);
	/**
	 * The markdown handed to the run that is in flight. Only promoted to the snapshot once the
	 * resulting HTML is actually saved — a cancelled or failed run must leave the base alone.
	 */
	const pendingSourceRef = useRef<string | null>(null);
	/**
	 * Whether the running pass is refining an accepted page (hold the old one on screen) or
	 * generating a new one (stream it in, throttled).
	 */
	const [previewMode, setPreviewMode] = useState<PlanHtmlPreviewMode>("debounce");
	const savedBriefRef = useRef<string | null>(null);
	const savedDraftRef = useRef<string | null>(null);
	/**
	 * Where a running prompt-bar answer is being spliced. Frozen when the run starts,
	 * because the text around the insertion point is what the streamed answer sits
	 * between — recomputing it from the textarea mid-stream would measure a document
	 * this very splice is rewriting.
	 */
	const draftSpliceRef = useRef<{
		before: string;
		after: string;
		previousContent: string;
		mode: PlanAiPromptMode;
	} | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const { rawPaneRatio, setRawPaneRatio } = usePlanEditorLayout();
	const { startDrag } = useResizeDrag();

	const activeDoc = source === "html" ? htmlDoc : mdDoc;
	const htmlAvailable = isHtmlPlan || sibling !== null;
	/** A document we could not read must stay read-only: saving would overwrite what we failed to load. */
	const activeDocReadOnly = activeDoc.status === "loading" || activeDoc.status === "error";

	useEffect(() => {
		setSourceState("md");
		setRichFailed(false);
		savedHtmlRef.current = null;
		pendingSourceRef.current = null;
		savedBriefRef.current = null;
		savedDraftRef.current = null;
		draftSpliceRef.current = null;
		setRawSelection({ start: 0, end: 0 });
		// Without this, a stale "done" stream from the previous plan survives the
		// switch and the completion effects below re-fire, writing plan A's brief/HTML
		// into plan B's files.
		brief.reset();
		generate.reset();
		draft.reset();
	}, [plan.id, brief.reset, draft.reset, generate.reset]);

	// Rendered pane trails raw-pane typing so TipTap isn't rebuilt on every keystroke.
	const [renderedMarkdown, setRenderedMarkdown] = useState(mdDoc.content);
	/** Plan whose freshly-loaded markdown has already reached the rendered pane. */
	const renderedPlanRef = useRef<string | null>(null);
	useEffect(() => {
		// A finished load is not typing: hand it over at once. Debouncing it would leave the
		// rich editor holding an empty document while the file on disk still has content.
		if (
			(mdDoc.status === "saved" || mdDoc.status === "error") &&
			renderedPlanRef.current !== plan.id
		) {
			renderedPlanRef.current = plan.id;
			setRenderedMarkdown(mdDoc.content);
			return;
		}
		if (focusedPane !== "raw") {
			setRenderedMarkdown(mdDoc.content);
			return;
		}
		const timer = setTimeout(() => setRenderedMarkdown(mdDoc.content), RENDERED_SYNC_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [focusedPane, mdDoc.content, mdDoc.status, plan.id]);

	/**
	 * Edits whichever document the raw pane is actually showing. Keyed off `activeDoc` rather
	 * than `mdDoc` because the textarea renders `activeDoc.content`: with the HTML source
	 * selected, cursor offsets belong to the HTML, so writing them back into the markdown
	 * would splice text at an unrelated position.
	 */
	const applyTextCommand = useCallback(
		(transform: (state: TextSelectionState) => TextSelectionState) => {
			const textarea = textareaRef.current;
			const value = activeDoc.content;
			const selectionStart = textarea?.selectionStart ?? value.length;
			const selectionEnd = textarea?.selectionEnd ?? value.length;
			const next = transform({ value, selectionStart, selectionEnd });
			activeDoc.updateContent(next.value);
			requestAnimationFrame(() => {
				textarea?.focus();
				textarea?.setSelectionRange(next.selectionStart, next.selectionEnd);
			});
		},
		[activeDoc],
	);

	const richEditorRef = useRef<Editor | null>(null);
	const handleEditorReady = useCallback((editor: Editor | null) => {
		richEditorRef.current = editor;
	}, []);

	/**
	 * The uploaded file always lands in the plan's own folder, so the *relative* path is
	 * what gets written to disk in both syntaxes — an absolute `/api/plans/...` URL would
	 * only resolve while the app is running and would break the exported HTML.
	 */
	const insertAssetAtCursor = useCallback(
		(relativePath: string, name: string) => {
			if (source === "html") {
				applyTextCommand((state) => insertAtCursor(state, `<img src="${relativePath}" alt="${name}">\n`));
				return;
			}
			const markdown = `![${name}](${relativePath})`;
			if (focusedPane === "rendered" && richEditorRef.current) {
				insertMarkdownImage(richEditorRef.current, markdown, plan.id);
				return;
			}
			applyTextCommand((state) => insertAtCursor(state, `${markdown}\n`));
		},
		[applyTextCommand, focusedPane, plan.id, source],
	);

	const {
		isUploading,
		uploadImageFile,
		handlePaste,
		handleDrop,
		handleDragOver,
	} = usePlanImagePaste(plan.id, workspaceId, insertAssetAtCursor);

	const handleRichEditorError = useCallback((error: Error) => {
		setRichFailed(true);
		setFocusedPane("raw");
		showAppToast({
			intent: "danger",
			message: error.message || "Rich editor failed. Keep editing in the raw pane.",
		});
	}, []);

	const handleClose = useCallback(() => {
		void Promise.all([mdDoc.flush(), siblingDoc.flush()]).then(onClose);
	}, [mdDoc, onClose, siblingDoc]);

	const handleGenerate = useCallback(
		(templateId: string) => {
			savedHtmlRef.current = null;
			setLogOpen(false);
			pendingSourceRef.current = mdDoc.content;
			setPreviewMode("debounce");
			void generate.run({
				templateId,
				content: mdDoc.content,
				format: kind === "text" ? "text" : "markdown",
				planId: plan.id,
			});
		},
		[generate, kind, mdDoc.content, plan.id],
	);

	/**
	 * Same endpoint, but carrying the accepted HTML plus a unified diff of the markdown against
	 * the version that HTML was generated from — which switches the prompt service to its
	 * diff-edit branch. Regenerating from scratch for a five-line change throws away a design
	 * the customer already signed off on, and sending the whole requirement makes the agent
	 * re-derive a delta the editor already knows exactly.
	 *
	 * Without a recorded base (or for a change large enough that the hunks are no smaller than
	 * the document) it falls back to the full-content edit prompt rather than refusing to run.
	 */
	const handleRefine = useCallback(
		(templateId: string) => {
			const currentHtml = htmlDoc.content;
			if (!currentHtml.trim()) {
				showAppToast({ intent: "warning", message: HTML_LABELS.refineNeedsHtml });
				return;
			}
			// An HTML plan has no markdown side, so there is no requirement to diff: the document
			// being edited *is* the HTML. It keeps the full-content edit path, without a toast
			// about a base that could never exist for it.
			const outcome = isHtmlPlan
				? ({ kind: "full", reason: "no-base" } as const)
				: buildRefineDiff(htmlSource.snapshot, mdDoc.content);
			if (outcome.kind === "unchanged") {
				showAppToast({ intent: "warning", message: HTML_LABELS.refineUnchanged });
				return;
			}
			if (outcome.kind === "full" && !isHtmlPlan) {
				showAppToast({
					intent: "warning",
					message: outcome.reason === "no-base" ? HTML_LABELS.refineNoBase : HTML_LABELS.refineWholeRewrite,
				});
			}
			savedHtmlRef.current = null;
			setLogOpen(false);
			pendingSourceRef.current = mdDoc.content;
			setPreviewMode("hold");
			void generate.run({
				templateId,
				content: mdDoc.content,
				format: kind === "text" ? "text" : "markdown",
				planId: plan.id,
				editFromHtml: currentHtml,
				...(outcome.kind === "diff"
					? { editDiff: outcome.diff }
					: { editFromContent: htmlSource.snapshot ?? mdDoc.content }),
			});
		},
		[generate, htmlDoc.content, htmlSource.snapshot, isHtmlPlan, kind, mdDoc.content, plan.id],
	);

	const handleExpand = useCallback(
		(templateId: string | null) => {
			savedBriefRef.current = null;
			setLogOpen(false);
			void brief.run({
				planId: plan.id,
				content: mdDoc.content,
				...(templateId ? { templateId } : {}),
			});
		},
		[brief, mdDoc.content, plan.id],
	);

	/**
	 * The excerpt the prompt bar would rewrite, or "" when it would draft instead.
	 * Derived from the mirrored offsets rather than the DOM so the bar's label and
	 * placeholder re-render as the selection changes.
	 */
	const draftSelectionText =
		source === "md" && !isHtmlPlan && focusedPane === "raw" && rawSelection.end > rawSelection.start
			? mdDoc.content.slice(rawSelection.start, rawSelection.end)
			: "";
	const promptMode: PlanAiPromptMode = draftSelectionText.trim() === "" ? "draft" : "edit";

	/**
	 * Runs one prompt-bar instruction. The selection is re-read from the textarea here
	 * rather than taken from `rawSelection`, so what gets replaced is what the browser
	 * says is selected at the moment of submit.
	 */
	const handleAiSubmit = useCallback(
		(instruction: string) => {
			const content = mdDoc.content;
			const textarea = textareaRef.current;
			const start = textarea?.selectionStart ?? 0;
			const end = textarea?.selectionEnd ?? 0;
			const selection = focusedPane === "raw" && end > start ? content.slice(start, end) : "";
			const isEdit = selection.trim() !== "";
			savedDraftRef.current = null;
			setLogOpen(false);
			draftSpliceRef.current = isEdit
				? {
						before: content.slice(0, start),
						after: content.slice(end),
						previousContent: content,
						mode: "edit",
					}
				: {
						// A draft lands below the notes, separated by one blank line — and by
						// nothing at all when the plan is still empty.
						before: content.trim() === "" ? "" : `${content.replace(/\s*$/, "")}\n\n`,
						after: "",
						previousContent: content,
						mode: "draft",
					};
			void draft.run({
				planId: plan.id,
				instruction,
				context: content,
				...(isEdit ? { selection } : {}),
			});
		},
		[draft, focusedPane, mdDoc.content, plan.id],
	);

	/** Stopping mid-stream must leave the file exactly as the user had it. */
	const handleAiCancel = useCallback(() => {
		draft.cancel();
		const splice = draftSpliceRef.current;
		if (splice) {
			mdDoc.updateContent(splice.previousContent);
			draftSpliceRef.current = null;
		}
	}, [draft, mdDoc.updateContent]);

	/**
	 * A compliant expansion returns the plan reorganized plus the brief, and that pair
	 * replaces the file — the whole point is that the messy input gets restructured. Because
	 * that is destructive, the previous bytes are copied to `<stem>.bak-<n>` first and the
	 * success toast carries an Undo. An answer without a `# Plan` section falls back to the
	 * old append behaviour: overwriting a file from a malformed response is never acceptable.
	 */
	const briefStatus = brief.status;
	const briefText = brief.text;
	useEffect(() => {
		if (briefStatus !== "done") {
			return;
		}
		if (briefText.trim() === "") {
			if (savedBriefRef.current === briefText) {
				return;
			}
			savedBriefRef.current = briefText;
			setLogOpen(true);
			showAppToast({ intent: "danger", message: HTML_LABELS.expandEmpty });
			return;
		}
		if (savedBriefRef.current === briefText) {
			return;
		}
		savedBriefRef.current = briefText;
		const { plan: reorganizedPlan, brief: briefSection } = splitBriefResult(briefText);
		if (reorganizedPlan === null) {
			mdDoc.updateContent(`${mdDoc.content.replace(/\s*$/, "")}\n\n---\n\n${briefSection.trim()}\n`);
			showAppToast({ intent: "success", message: HTML_LABELS.expandDone });
			return;
		}
		const previousContent = mdDoc.content;
		void (async () => {
			try {
				const backup = await getRuntimeTrpcClient(workspaceId).plans.writeBackup.mutate({ planId: plan.id });
				if (!backup.ok) {
					setLogOpen(true);
					showAppToast({ intent: "danger", message: backup.error ?? HTML_LABELS.expandBackupFailed });
					return;
				}
			} catch (error) {
				setLogOpen(true);
				showAppToast({
					intent: "danger",
					message: `${HTML_LABELS.expandBackupFailed} ${error instanceof Error ? error.message : String(error)}`,
				});
				return;
			}
			mdDoc.updateContent(`${reorganizedPlan}\n\n---\n\n${briefSection}\n`);
			showAppToast({
				intent: "success",
				message: HTML_LABELS.expandRewrote,
				action: { label: "Undo", onClick: () => mdDoc.updateContent(previousContent) },
			});
		})();
	}, [briefStatus, briefText, mdDoc, plan.id, workspaceId]);

	const briefError = brief.error;
	useEffect(() => {
		if (!briefError) {
			return;
		}
		setLogOpen(true);
		showAppToast({ intent: "danger", message: briefError });
	}, [briefError]);

	// The prompt bar's answer is spliced in as it streams, so the user watches the
	// paragraph appear (or change) in place instead of waiting for a finished blob.
	const draftStatus = draft.status;
	const draftText = draft.text;
	useEffect(() => {
		const splice = draftSpliceRef.current;
		if (!splice || draftStatus !== "running" || draftText === "") {
			return;
		}
		mdDoc.updateContent(splice.before + draftText + splice.after);
	}, [draftStatus, draftText, mdDoc.updateContent]);

	/**
	 * A finished run is already in the document — this only decides what the user is
	 * told about it. The Undo action carries the pre-run bytes because the splice is
	 * scoped and streamed: unlike brief expansion there is no `.bak` file to fall back
	 * on, and there does not need to be.
	 */
	useEffect(() => {
		if (draftStatus !== "done") {
			return;
		}
		const splice = draftSpliceRef.current;
		if (!splice || savedDraftRef.current === draftText) {
			return;
		}
		savedDraftRef.current = draftText;
		draftSpliceRef.current = null;
		if (draftText.trim() === "") {
			// Roll back the blank-line separator a draft run already wrote, so an empty
			// answer leaves the file byte-identical.
			mdDoc.updateContent(splice.previousContent);
			setLogOpen(true);
			showAppToast({ intent: "danger", message: HTML_LABELS.aiEmpty });
			return;
		}
		const previousContent = splice.previousContent;
		showAppToast({
			intent: "success",
			message: splice.mode === "edit" ? HTML_LABELS.aiEditDone : HTML_LABELS.aiDraftDone,
			action: { label: "Undo", onClick: () => mdDoc.updateContent(previousContent) },
		});
	}, [draftStatus, draftText, mdDoc.updateContent]);

	const draftError = draft.error;
	useEffect(() => {
		if (!draftError) {
			return;
		}
		const splice = draftSpliceRef.current;
		if (splice) {
			mdDoc.updateContent(splice.previousContent);
			draftSpliceRef.current = null;
		}
		setLogOpen(true);
		showAppToast({ intent: "danger", message: draftError });
	}, [draftError, mdDoc.updateContent]);

	// A finished stream is written straight to `<stem>.html`, which un-greys the HTML switch.
	const generateStatus = generate.status;
	const generatedHtml = generate.text;
	useEffect(() => {
		if (generateStatus !== "done") {
			return;
		}
		if (generatedHtml.trim() === "") {
			if (savedHtmlRef.current === generatedHtml) {
				return;
			}
			savedHtmlRef.current = generatedHtml;
			setLogOpen(true);
			showAppToast({ intent: "danger", message: HTML_LABELS.generateEmpty });
			return;
		}
		if (savedHtmlRef.current === generatedHtml) {
			return;
		}
		savedHtmlRef.current = generatedHtml;
		// Switched before the write, not after: leaving `source` on "md" until the save resolves
		// tore the finished page down and remounted the lazy rich editor behind its spinner, so
		// every run ended in a flash of markdown. Reverted below if the write actually fails.
		const previousSource = sourceStateRef.current;
		setSourceState("html");
		void (async () => {
			try {
				const result = await getRuntimeTrpcClient(workspaceId).plans.writeSibling.mutate({
					planId: plan.id,
					ext: ".html",
					content: generatedHtml,
				});
				if (!result.ok || !result.plan) {
					setSourceState(previousSource);
					showAppToast({
						intent: "danger",
						message: result.error ?? "Could not save the generated HTML.",
					});
					return;
				}
				setSibling(result.plan);
				// Only now is the recorded base true: this markdown is what the saved HTML came from.
				const pendingSource = pendingSourceRef.current;
				pendingSourceRef.current = null;
				if (pendingSource !== null) {
					void htmlSource.commit(pendingSource);
				}
				showAppToast({ intent: "success", message: HTML_LABELS.saveSibling });
			} catch (error) {
				setSourceState(previousSource);
				showAppToast({
					intent: "danger",
					message: error instanceof Error ? error.message : String(error),
				});
			}
		})();
	}, [generateStatus, generatedHtml, htmlSource.commit, plan.id, setSibling, workspaceId]);

	const generateError = generate.error;
	useEffect(() => {
		if (!generateError) {
			return;
		}
		setLogOpen(true);
		showAppToast({ intent: "danger", message: generateError });
	}, [generateError]);

	const handleResizeStart = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
			const container = containerRef.current;
			if (!container) {
				return;
			}
			startDrag(event, {
				axis: "x",
				cursor: "ew-resize",
				onMove: (pointer) => {
					const rect = container.getBoundingClientRect();
					if (rect.width <= 0) {
						return;
					}
					setRawPaneRatio((pointer - rect.left) / rect.width);
				},
			});
		},
		[setRawPaneRatio, startDrag],
	);

	const isStreaming = generate.status === "running";
	// One log panel for every pass — whichever ran last is what the user is debugging.
	const agentLog = useMemo(
		() => [...brief.log, ...generate.log, ...draft.log],
		[brief.log, draft.log, generate.log],
	);
	const agentError = generate.error ?? brief.error ?? draft.error;
	const showMarkdownTools = source === "md" && !isHtmlPlan;
	const htmlSizeBytes = useMemo(
		() => new TextEncoder().encode(generate.text).length,
		[generate.text],
	);

	const renderedPaneBody = (): ReactElement => {
		if (source === "html" || isStreaming) {
			return (
				<PlanHtmlPreviewFrame
					html={isStreaming ? generate.text : htmlDoc.content}
					fallbackHtml={htmlDoc.content}
					streaming={isStreaming}
					mode={previewMode}
					planId={plan.id}
				/>
			);
		}
		if (richFailed) {
			return (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-sm text-text-secondary">
					<AlertTriangle size={18} className="text-status-red" aria-hidden />
					<span>Rich rendering is unavailable. The raw pane still saves normally.</span>
					<Button variant="ghost" size="sm" onClick={() => setRichFailed(false)}>
						Try again
					</Button>
				</div>
			);
		}
		// Show loading skeleton while markdown content is being fetched
		if (activeDoc.status === "loading" && source === "md") {
			return (
				<div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
					<div className="kb-skeleton h-4 w-3/4" />
					<div className="kb-skeleton h-4 w-full" />
					<div className="kb-skeleton h-4 w-5/6" />
					<div className="kb-skeleton h-4 w-2/3" />
					<div className="kb-skeleton h-4 w-1/2" />
				</div>
			);
		}
		if (mdDoc.status === "saved" && mdDoc.content === "") {
			return (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center text-sm text-text-tertiary">
					<span>This plan file is empty.</span>
				</div>
			);
		}
		return (
			<PlanEditorErrorBoundary onError={handleRichEditorError}>
				<Suspense
					fallback={
						<div className="flex flex-1 items-center justify-center">
							<Spinner size={20} />
						</div>
					}
				>
					<PlanRichEditor
						content={renderedMarkdown}
						onChange={mdDoc.updateContent}
						planId={plan.id}
						disabled={mdDoc.status === "loading" || mdDoc.status === "error"}
						onInsertImage={(file) => void uploadImageFile(file)}
						onPaste={handlePaste}
						onDrop={handleDrop}
						onDragOver={handleDragOver}
						onEditorReady={handleEditorReady}
					/>
				</Suspense>
			</PlanEditorErrorBoundary>
		);
	};

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
					{headerActions}
					<div className="flex items-center gap-1.5 text-[11px] text-text-secondary min-w-[80px] justify-end">
						{activeDoc.status === "loading" || activeDoc.status === "saving" || isUploading ? (
							<Spinner size={12} />
						) : null}
						<span>{isUploading ? "Uploading…" : activeDoc.statusLabel}</span>
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

			<div ref={containerRef} className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
				<div
					className="flex min-h-0 min-w-0 flex-col overflow-hidden"
					style={{ width: `${rawPaneRatio * 100}%` }}
					onFocus={() => setFocusedPane("raw")}
					data-testid="plan-editor-raw-pane"
				>
					<div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-2 px-2 py-1">
						<span className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
							{HTML_LABELS.source}
						</span>
						<SourceSwitch
							value={source}
							htmlEnabled={htmlAvailable}
							disabled={isHtmlPlan || isStreaming}
							onChange={setSourceState}
							testId="plan-editor-raw-source-switch"
						/>
					</div>
					{showMarkdownTools ? (
						<PlanMarkdownToolbar
							disabled={mdDoc.status === "loading"}
							onCommand={applyTextCommand}
							onInsertImage={(file) => void uploadImageFile(file)}
						/>
					) : (
						// HTML has no markdown formatting to offer, but its images live in the same
						// `<stem>.assets/` folder, so the picker still belongs here.
						<div
							className="flex items-center gap-0.5 border-b border-border bg-surface-2 px-2 py-1"
							data-testid="plan-editor-html-tools"
						>
							<PlanImageButton
								disabled={activeDocReadOnly}
								onSelectFile={(file) => void uploadImageFile(file)}
							/>
						</div>
					)}
					{activeDoc.status === "loading" ? (
						<div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
							<div className="kb-skeleton h-4 w-3/4" />
							<div className="kb-skeleton h-4 w-full" />
							<div className="kb-skeleton h-4 w-5/6" />
							<div className="kb-skeleton h-4 w-2/3" />
							<div className="kb-skeleton h-4 w-1/2" />
						</div>
					) : (
						<textarea
							ref={textareaRef}
							value={activeDoc.content}
							onChange={(event) => activeDoc.updateContent(event.currentTarget.value)}
							onSelect={(event) =>
								setRawSelection({
									start: event.currentTarget.selectionStart,
									end: event.currentTarget.selectionEnd,
								})
							}
							onPaste={handlePaste}
							onDrop={handleDrop}
							onDragOver={handleDragOver}
							disabled={activeDocReadOnly}
							spellCheck={false}
							className="min-h-0 w-full flex-1 resize-none border-0 bg-surface-1 px-3 py-2 font-mono text-[13px] leading-5 text-text-primary focus:outline-none disabled:opacity-50"
							data-testid="plan-editor-textarea"
						/>
					)}
					{showMarkdownTools ? (
						<PlanAiPromptBar
							mode={promptMode}
							status={draft.status}
							error={draft.error}
							disabled={activeDocReadOnly || isStreaming}
							onSubmit={handleAiSubmit}
							onCancel={handleAiCancel}
							onAttachFile={(file) => void uploadImageFile(file)}
						/>
					) : null}
				</div>

				<ResizeHandle
					orientation="vertical"
					ariaLabel="Resize plan editor panes"
					onMouseDown={handleResizeStart}
				/>

				<div
					className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
					onFocus={() => setFocusedPane("rendered")}
					data-testid="plan-editor-rendered-pane"
				>
					<div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-2 py-1">
						<div className="flex items-center gap-2">
							<span className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
								{HTML_LABELS.preview}
							</span>
							<SourceSwitch
								value={source}
								htmlEnabled={htmlAvailable}
								disabled={isHtmlPlan || isStreaming}
								onChange={setSourceState}
								testId="plan-editor-rendered-source-switch"
							/>
						</div>
						{!isHtmlPlan && source === "md" ? (
							<PlanHtmlGenerateBar
								status={generate.status}
								briefStatus={brief.status}
								startedAt={generate.startedAt}
								firstByteAt={generate.firstByteAt}
								doneAt={generate.doneAt}
								htmlSizeBytes={htmlSizeBytes}
								canRefine={htmlAvailable && htmlDoc.content.trim().length > 0}
								canExpand={!plan.missing}
								disabled={mdDoc.status === "loading"}
								onExpand={handleExpand}
								onGenerate={handleGenerate}
								onRefine={handleRefine}
								onCancel={brief.status === "running" ? brief.cancel : generate.cancel}
							/>
						) : null}
					</div>
					{renderedPaneBody()}
				</div>
			</div>

			{agentLog.length > 0 || agentError ? (
				<div className="shrink-0 border-t border-border bg-surface-1" data-testid="plan-editor-generate-log">
					<button
						type="button"
						className="flex w-full items-center gap-2 px-3 py-1 text-left text-[11px] text-text-secondary cursor-pointer bg-transparent border-0"
						onClick={() => setLogOpen((open) => !open)}
					>
						<span>
							{logOpen ? "▾" : "▸"} {HTML_LABELS.log} ({agentLog.length})
						</span>
						{agentError ? (
							<span className="truncate text-status-red">{agentError}</span>
						) : null}
					</button>
					{logOpen ? (
						<div className="max-h-32 overflow-auto bg-surface-2 px-3 py-2 font-mono text-[11px] leading-relaxed text-text-secondary">
							{agentLog.length === 0 ? (
								<div className="text-text-tertiary">{HTML_LABELS.noLog}</div>
							) : (
								agentLog.map((line, index) => (
									// eslint-disable-next-line react/no-array-index-key
									<div key={index} className="whitespace-pre-wrap break-words">
										{line}
									</div>
								))
							)}
						</div>
					) : null}
				</div>
			) : null}

			<div className="flex items-center justify-between gap-3 border-t border-border bg-surface-1 px-3 py-1.5 shrink-0">
				<span className="text-[11px] text-text-tertiary">
					{source === "html" && !isHtmlPlan && sibling ? sibling.path : plan.path}
				</span>
				<span className="text-[11px] text-text-tertiary">
					{fileTypeLabel(source === "html" ? "html" : kind)}
				</span>
			</div>
		</div>
	);
}
