import type { Editor } from "@tiptap/react";
import { AlertTriangle, X } from "lucide-react";
import {
	lazy,
	type ReactElement,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import { showAppToast } from "@/components/app-toaster";
import { insertAtCursor, type TextSelectionState } from "@/components/plan-editor/markdown-selection-commands";
import { PlanAiPromptBar, type PlanAiPromptMode } from "@/components/plan-editor/plan-ai-prompt-bar";
import { splitBriefResult } from "@/components/plan-editor/plan-brief-result";
import { PlanEditorErrorBoundary } from "@/components/plan-editor/plan-editor-error-boundary";
import { PlanHistoryControls } from "@/components/plan-editor/plan-history-controls";
import { PlanHtmlGenerateBar } from "@/components/plan-editor/plan-html-generate-bar";
import { PlanHtmlPreviewFrame, type PlanHtmlPreviewMode } from "@/components/plan-editor/plan-html-preview-frame";
import { PlanImageButton } from "@/components/plan-editor/plan-image-button";
import { PlanMarkdownToolbar } from "@/components/plan-editor/plan-markdown-toolbar";
import { buildRefineDiff } from "@/components/plan-editor/plan-refine-diff";
import { insertMarkdownImage } from "@/components/plan-editor/plan-rich-markdown";
import { PlanTemplateRail } from "@/components/plan-editor/plan-template-rail";
import { usePlanEditorDocument } from "@/components/plan-editor/use-plan-editor-document";
import { usePlanHistory } from "@/components/plan-editor/use-plan-history";
import { usePlanHtmlSibling } from "@/components/plan-editor/use-plan-html-sibling";
import { usePlanHtmlSource } from "@/components/plan-editor/use-plan-html-source";
import { usePlanImagePaste } from "@/components/plan-editor/use-plan-image-paste";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { HTML_LABELS } from "@/html/html-labels";
import { importTemplateFile } from "@/html/import-template";
import { useHtmlBrief, useHtmlDraft, useHtmlGenerate } from "@/html/use-html-agent-stream";
import { useHtmlTemplates } from "@/html/use-html-templates";
import { ResizeHandle } from "@/resize/resize-handle";
import { usePlanEditorLayout } from "@/resize/use-plan-editor-layout";
import { useResizeDrag } from "@/resize/use-resize-drag";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeSavedPlan } from "@/runtime/types";

const PlanRichEditor = lazy(() => import("@/components/plan-editor/plan-rich-editor"));

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
						title={option.id === "html" && !htmlEnabled ? "Generate HTML first to enable this view." : undefined}
						onClick={() => onChange(option.id)}
						className={cn(
							"rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
							value === option.id ? "bg-surface-1 text-text-primary" : "text-text-tertiary",
							optionDisabled ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:text-text-primary",
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

export function PlanEditorView({ plan, workspaceId, onClose, headerActions }: PlanEditorViewProps): ReactElement {
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
	const [rawSelection, setRawSelection] = useState<{
		start: number;
		end: number;
	}>({ start: 0, end: 0 });

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
	 * Version history for whichever document is on screen. Keyed on the *markdown* plan even for an
	 * HTML plan's own id, since that is how the store groups a document and its generated page.
	 */
	const history = usePlanHistory(plan.id, workspaceId, isHtmlPlan ? "html" : sourceState);
	/**
	 * The markdown handed to the run that is in flight. Only promoted to the snapshot once the
	 * resulting HTML is actually saved — a cancelled or failed run must leave the base alone.
	 */
	const pendingSourceRef = useRef<string | null>(null);
	/** Whether the run in flight is a fresh generation or a Refine, for the history entry's label. */
	const pendingHistoryLabelRef = useRef<"generate" | "refine">("generate");
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
	const paneRowRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const {
		rawPaneRatio,
		setRawPaneRatio,
		templatePaneWidth,
		setTemplatePaneWidth,
		templatePaneCollapsed,
		toggleTemplatePaneCollapsed,
	} = usePlanEditorLayout();
	const { startDrag } = useResizeDrag();
	/**
	 * Owned here, not in the generate bar: the rail picks the template and the bar acts
	 * on it, so the selection has to live above both.
	 */
	const {
		online: templatesOnline,
		templates,
		loading: templatesLoading,
		refresh: refreshTemplates,
	} = useHtmlTemplates();
	const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
	const [importingTemplate, setImportingTemplate] = useState(false);

	/**
	 * Installing a zip writes a folder under `agent-data/templates/skills/`, so the rail has to be
	 * re-read afterwards; the freshly installed template is then selected, since importing one is
	 * how you say you want to use it.
	 */
	const handleImportTemplate = useCallback(
		(file: File) => {
			setImportingTemplate(true);
			void (async () => {
				try {
					const imported = await importTemplateFile(file);
					await refreshTemplates();
					setSelectedTemplateId(imported.id);
					showAppToast({
						intent: "success",
						message: imported.replaced ? HTML_LABELS.importTemplateReplaced : HTML_LABELS.importTemplateDone,
					});
				} catch (error) {
					showAppToast({
						intent: "danger",
						message: error instanceof Error ? error.message : String(error),
					});
				} finally {
					setImportingTemplate(false);
				}
			})();
		},
		[refreshTemplates],
	);

	/**
	 * Whether the registry's default has already been offered. Without it, clearing the
	 * selection (clicking the selected card, i.e. asking for a template-free run) would be
	 * undone by this effect on its very next pass.
	 */
	const templateDefaultAppliedRef = useRef(false);
	useEffect(() => {
		if (templateDefaultAppliedRef.current || templates.length === 0 || selectedTemplateId !== null) {
			return;
		}
		templateDefaultAppliedRef.current = true;
		// `templates` arrives ranked by `recommended`, so this lands on the registry's
		// own first choice rather than whatever sorted first on disk.
		setSelectedTemplateId(templates[0]?.id ?? null);
	}, [templates, selectedTemplateId]);

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
		if ((mdDoc.status === "saved" || mdDoc.status === "error") && renderedPlanRef.current !== plan.id) {
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

	const { isUploading, uploadImageFile, handlePaste, handleDrop, handleDragOver } = usePlanImagePaste(
		plan.id,
		workspaceId,
		insertAssetAtCursor,
	);

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

	/**
	 * `templateId === null` is a first-class mode, not a missing argument: the runtime then
	 * builds the prompt from this plan's own markdown (and its images) instead of asking the
	 * sidecar for a template's.
	 */
	const handleGenerate = useCallback(
		(templateId: string | null) => {
			savedHtmlRef.current = null;
			setLogOpen(false);
			pendingSourceRef.current = mdDoc.content;
			pendingHistoryLabelRef.current = "generate";
			setPreviewMode("debounce");
			void generate.run({
				...(templateId ? { templateId } : {}),
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
		(templateId: string | null) => {
			const currentHtml = htmlDoc.content;
			if (!currentHtml.trim()) {
				showAppToast({
					intent: "warning",
					message: HTML_LABELS.refineNeedsHtml,
				});
				return;
			}
			// An HTML plan has no markdown side, so there is no requirement to diff: the document
			// being edited *is* the HTML. It keeps the full-content edit path, without a toast
			// about a base that could never exist for it.
			const outcome = isHtmlPlan
				? ({ kind: "full", reason: "no-base" } as const)
				: buildRefineDiff(htmlSource.snapshot, mdDoc.content);
			if (outcome.kind === "unchanged") {
				showAppToast({
					intent: "warning",
					message: HTML_LABELS.refineUnchanged,
				});
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
			pendingHistoryLabelRef.current = "refine";
			setPreviewMode("hold");
			void generate.run({
				...(templateId ? { templateId } : {}),
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

	/**
	 * Puts a restored version on screen. The runtime has already written it to disk, so the document
	 * is *adopted* rather than saved back — writing it again would record a duplicate version.
	 *
	 * Restoring a page also restores the requirement it was generated from (the store keeps them
	 * paired), so the Refine base is re-read rather than left pointing at a newer requirement.
	 */
	const applyRestoredVersion = useCallback(
		(restored: { target: "md" | "html"; content: string } | null, emptyMessage: string) => {
			if (restored === null) {
				showAppToast({ intent: "warning", message: emptyMessage });
				return;
			}
			if (restored.target === "html") {
				htmlDoc.adopt(restored.content);
				setSourceState("html");
				void htmlSource.reload();
			} else {
				mdDoc.adopt(restored.content);
				setSourceState("md");
			}
			showAppToast({ intent: "success", message: HTML_LABELS.historyRestored });
		},
		[htmlDoc.adopt, htmlSource.reload, mdDoc.adopt],
	);

	const runHistoryAction = useCallback(
		(action: () => Promise<{ target: "md" | "html"; content: string } | null>, emptyMessage: string) => {
			void (async () => {
				try {
					applyRestoredVersion(await action(), emptyMessage);
				} catch (error) {
					showAppToast({
						intent: "danger",
						message: error instanceof Error ? error.message : String(error),
					});
				}
			})();
		},
		[applyRestoredVersion],
	);

	/**
	 * Records a milestone version of the notes. Flushes first: markdown edits reach disk through a
	 * debounced autosave, and snapshotting before that lands would capture the *previous* text.
	 */
	const markMdMilestone = useCallback(
		(label: "expand" | "ai-edit") => {
			void (async () => {
				await mdDoc.flush();
				await history.mark("md", label);
			})();
		},
		[history.mark, mdDoc.flush],
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
			markMdMilestone("expand");
			showAppToast({ intent: "success", message: HTML_LABELS.expandDone });
			return;
		}
		const previousContent = mdDoc.content;
		void (async () => {
			try {
				const backup = await getRuntimeTrpcClient(workspaceId).plans.writeBackup.mutate({
					planId: plan.id,
				});
				if (!backup.ok) {
					setLogOpen(true);
					showAppToast({
						intent: "danger",
						message: backup.error ?? HTML_LABELS.expandBackupFailed,
					});
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
			markMdMilestone("expand");
			showAppToast({
				intent: "success",
				message: HTML_LABELS.expandRewrote,
				action: {
					label: "Undo",
					onClick: () => mdDoc.updateContent(previousContent),
				},
			});
		})();
	}, [briefStatus, briefText, markMdMilestone, mdDoc, plan.id, workspaceId]);

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
		markMdMilestone("ai-edit");
		showAppToast({
			intent: "success",
			message: splice.mode === "edit" ? HTML_LABELS.aiEditDone : HTML_LABELS.aiDraftDone,
			action: {
				label: "Undo",
				onClick: () => mdDoc.updateContent(previousContent),
			},
		});
	}, [draftStatus, draftText, markMdMilestone, mdDoc.updateContent]);

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
					historyLabel: pendingHistoryLabelRef.current,
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
				// The sibling's plan id does not change when its file is rewritten, so the document
				// hook would never re-read it: without this the pane keeps showing the *first* page it
				// ever loaded, and the next Refine sends that stale HTML as `editFromHtml`.
				htmlDoc.adopt(generatedHtml);
				// Only now is the recorded base true: this markdown is what the saved HTML came from.
				const pendingSource = pendingSourceRef.current;
				pendingSourceRef.current = null;
				if (pendingSource !== null) {
					// Awaited so the version just recorded for this page picks up the requirement it came
					// from — that pairing is what lets a restore put both files back together.
					await htmlSource.commit(pendingSource);
				}
				void history.refresh();
				showAppToast({ intent: "success", message: HTML_LABELS.saveSibling });
			} catch (error) {
				setSourceState(previousSource);
				showAppToast({
					intent: "danger",
					message: error instanceof Error ? error.message : String(error),
				});
			}
		})();
	}, [
		generateStatus,
		generatedHtml,
		history.refresh,
		htmlDoc.adopt,
		htmlSource.commit,
		plan.id,
		setSibling,
		workspaceId,
	]);

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
			// `containerRef` is the source/preview split only — the template rail sits
			// outside it, so its width never skews this ratio.
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

	const handleTemplateRailResizeStart = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
			// The rail is flush with the left edge of the pane row, so its width is
			// simply how far right of that edge the pointer has travelled.
			const row = paneRowRef.current;
			if (!row) {
				return;
			}
			const left = row.getBoundingClientRect().left;
			startDrag(event, {
				axis: "x",
				cursor: "ew-resize",
				onMove: (pointer) => {
					setTemplatePaneWidth(pointer - left);
				},
			});
		},
		[setTemplatePaneWidth, startDrag],
	);

	const isStreaming = generate.status === "running";
	// One log panel for every pass — whichever ran last is what the user is debugging.
	const agentLog = useMemo(() => [...brief.log, ...generate.log, ...draft.log], [brief.log, draft.log, generate.log]);
	const agentError = generate.error ?? brief.error ?? draft.error;
	const showMarkdownTools = source === "md" && !isHtmlPlan;
	const htmlSizeBytes = useMemo(() => new TextEncoder().encode(generate.text).length, [generate.text]);

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
						// The pane header owns undo/redo whenever versions are recorded; only a
						// git-less runtime falls back to the in-editor pair.
						showUndoRedo={!history.available}
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
					<span className="truncate text-sm font-semibold text-text-primary">{plan.name}</span>
					<span className="truncate text-[11px] text-text-tertiary" title={plan.path}>
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

			<div ref={paneRowRef} className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
				{/*
				 * An HTML plan has no markdown to convert, so it gets no rail at all. For a
				 * markdown plan the rail stays mounted while the preview shows HTML — only
				 * disabled — so switching source doesn't shuffle the panes sideways.
				 */}
				{isHtmlPlan ? null : (
					<>
						<PlanTemplateRail
							templates={templates}
							selectedId={selectedTemplateId}
							online={templatesOnline}
							loading={templatesLoading}
							disabled={source === "html" || isStreaming}
							collapsed={templatePaneCollapsed}
							widthPx={templatePaneWidth}
							importing={importingTemplate}
							onSelect={setSelectedTemplateId}
							onToggleCollapsed={toggleTemplatePaneCollapsed}
							onImport={handleImportTemplate}
						/>
						{templatePaneCollapsed ? null : (
							<ResizeHandle
								orientation="vertical"
								ariaLabel="Resize template pane"
								onMouseDown={handleTemplateRailResizeStart}
							/>
						)}
					</>
				)}

				<div ref={containerRef} className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
					<div
						className="flex min-h-0 min-w-0 flex-col overflow-hidden"
						style={{ width: `${rawPaneRatio * 100}%` }}
						onFocus={() => setFocusedPane("raw")}
						data-testid="plan-editor-raw-pane"
					>
						{/* h-9 on every pane chrome row — see the rendered pane's header below. */}
						<div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-2 px-2 py-1">
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
								className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border bg-surface-2 px-2 py-1"
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
						{/*
						 * Fixed h-9 and no wrapping: this header and the raw pane's must be the same
						 * height, otherwise the two formatting toolbars below them sit on different
						 * lines. A narrow pane scrolls the generate bar sideways instead of growing
						 * a second row.
						 */}
						<div className="kb-toolbar-scroll flex h-9 min-w-0 shrink-0 items-center justify-between gap-2 overflow-x-auto border-b border-border bg-surface-2 px-2 py-1">
							<div className="flex shrink-0 items-center gap-2">
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
								{/*
								 * Sits outside the generate bar below, which only exists on the markdown side —
								 * undoing a generated page is something you do while looking at that page. Absent
								 * entirely when the runtime has no git to keep versions in.
								 */}
								{history.available ? (
									<PlanHistoryControls
										entries={history.entries}
										canUndo={history.canUndo}
										canRedo={history.canRedo}
										disabled={isStreaming}
										onUndo={() => runHistoryAction(history.undo, HTML_LABELS.historyNothingOlder)}
										onRedo={() => runHistoryAction(history.redo, HTML_LABELS.historyNothingNewer)}
										onRestore={(entryId) =>
											runHistoryAction(() => history.restore(entryId), HTML_LABELS.historyDiffUnavailable)
										}
										onDiff={history.diff}
									/>
								) : null}
							</div>
							{!isHtmlPlan && source === "md" ? (
								<PlanHtmlGenerateBar
									status={generate.status}
									briefStatus={brief.status}
									startedAt={generate.startedAt}
									firstByteAt={generate.firstByteAt}
									doneAt={generate.doneAt}
									htmlSizeBytes={htmlSizeBytes}
									templates={templates}
									selectedTemplateId={selectedTemplateId}
									online={templatesOnline}
									templatesLoading={templatesLoading}
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
						{agentError ? <span className="truncate text-status-red">{agentError}</span> : null}
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
				<span className="text-[11px] text-text-tertiary">{fileTypeLabel(source === "html" ? "html" : kind)}</span>
			</div>
		</div>
	);
}
