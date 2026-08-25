import { Clock, Columns2, FileCode, Loader2, Menu, MessageSquare, Square, SquareCheck } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ReviewCommentComposer } from "@/components/review/review-comment-composer";
import {
	buildDisplayItems,
	CollapsedBlockControls,
	DiffRowText,
	getHighlightedLineHtml,
	isLargeFileDiff,
	parsePatchToRows,
	resolvePrismGrammar,
	resolvePrismLanguage,
	type UnifiedDiffRow,
	useIncrementalExpand,
} from "@/components/shared/diff-renderer";
import {
	isCommentableOnSplitSide,
	SplitDiffGrid,
	type SplitDiffSide,
} from "@/components/shared/split-diff-renderer";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { buildLineAnnotations, type ReviewDiffMode, resolveFileStatus } from "@/review/review-target";
import type {
	RuntimeGitlabDiffFile,
	RuntimeGitlabDiscussion,
	RuntimeGitlabNoteLineRange,
	RuntimeReviewDraftComment,
} from "@/runtime/types";

export interface ReviewCommentDraftInput {
	newPath: string;
	oldPath: string;
	oldLine: number | null;
	newLine: number | null;
	/** Set only for a note dragged across several lines; the lines above are its end. */
	lineRange?: RuntimeGitlabNoteLineRange;
	text: string;
	ruleIds: string[];
}

/**
 * Which lines the composer is open on, and on which side of the split. The
 * `oldLine`/`newLine` pair is the *end* of the run, matching how GitLab positions a
 * range note; `startRowKey` is kept so the selection stays highlighted while the
 * reviewer types.
 */
interface ComposerAnchor {
	rowKey: string;
	startRowKey: string;
	side: SplitDiffSide;
	oldLine: number | null;
	newLine: number | null;
	startOldLine: number | null;
	startNewLine: number | null;
}

/** A drag in progress: where it started and which row the pointer is over now. */
interface DragState {
	side: SplitDiffSide;
	anchorKey: string;
	headKey: string;
}

/** A resolved, contiguous, single-side run of rows. */
interface RowRange {
	keys: Set<string>;
	start: UnifiedDiffRow;
	end: UnifiedDiffRow;
}

/** How close to the bottom counts as "the reviewer finished this file". */
const END_THRESHOLD_PX = 24;
/**
 * How long the diff has to stay at the bottom before advancing. Firing on the
 * threshold alone advances mid-momentum, which reads as the file being yanked away.
 */
const END_DWELL_MS = 350;

/** The old/new line pair a row anchors a note to. A removed row is old-side only. */
function resolveRowLines(row: UnifiedDiffRow): { oldLine: number | null; newLine: number | null } {
	if (row.lineNumber == null) {
		return { oldLine: null, newLine: null };
	}
	return row.variant === "removed"
		? { oldLine: row.lineNumber, newLine: null }
		: { oldLine: null, newLine: row.lineNumber };
}

/** `+33` / `-12` — how GitLab labels the ends of a commented range. */
function formatLineEndpoint(oldLine: number | null, newLine: number | null): string {
	return newLine !== null ? `+${newLine}` : `-${oldLine ?? "?"}`;
}

export function ReviewDiffPane({
	file,
	mode,
	isReviewed,
	draftComments,
	discussions,
	pendingCitations,
	deltaBanner,
	onModeChange,
	onToggleReviewed,
	onAddDraft,
	onRemoveDraft,
	onComposerOpenChange,
	onClearCitations,
	onRemoveCitation,
	onFetchFullFile,
	onReachedEnd,
}: {
	file: RuntimeGitlabDiffFile | null;
	mode: ReviewDiffMode;
	isReviewed: boolean;
	draftComments: RuntimeReviewDraftComment[];
	discussions: RuntimeGitlabDiscussion[];
	/** Rule ids the Rules panel has cited into the open composer. */
	pendingCitations: string[];
	deltaBanner: { previousHeadSha: string; currentHeadSha: string } | null;
	onModeChange: (mode: ReviewDiffMode) => void;
	onToggleReviewed: () => void;
	onAddDraft: (draft: ReviewCommentDraftInput) => void;
	onRemoveDraft: (id: string) => void;
	onComposerOpenChange: (open: boolean) => void;
	onClearCitations: () => void;
	onRemoveCitation: (ruleId: string) => void;
	onFetchFullFile?: () => Promise<string | null>;
	/** Called once the reviewer has dwelt at the bottom of this file's diff. */
	onReachedEnd?: () => void;
}): ReactElement {
	const [composer, setComposer] = useState<ComposerAnchor | null>(null);
	const [composerText, setComposerText] = useState("");
	const [drag, setDrag] = useState<DragState | null>(null);
	const [forceRenderLargeDiff, setForceRenderLargeDiff] = useState(false);
	const [fullFileContent, setFullFileContent] = useState<string | null>(null);
	const [isLoadingFullFile, setIsLoadingFullFile] = useState(false);
	const [showFullFile, setShowFullFile] = useState(false);
	const { expandedBlocks, expandTop, expandBottom, expandAll } = useIncrementalExpand();

	const path = file?.newPath ?? "";
	const prismLanguage = useMemo(() => resolvePrismLanguage(path), [path]);
	const prismGrammar = useMemo(() => resolvePrismGrammar(prismLanguage), [prismLanguage]);

	const rows = useMemo(() => (file ? parsePatchToRows(file.diff) : []), [file]);
	const displayItems = useMemo(() => buildDisplayItems(rows, expandedBlocks), [expandedBlocks, rows]);

	/** Patch order by row key — a drag has to be orderable regardless of its direction. */
	const rowIndexByKey = useMemo(() => {
		const indexes = new Map<string, number>();
		rows.forEach((row, index) => indexes.set(row.key, index));
		return indexes;
	}, [rows]);

	/**
	 * The contiguous, single-side run of rows between two keys.
	 *
	 * GitLab range notes cannot span sides — the two endpoints would name lines in
	 * different revisions of the file — so the run is clamped at the first row that
	 * is not commentable on the anchor's side. Walking outwards from the anchor
	 * rather than between the two indexes is what keeps that clamp on the reviewer's
	 * side of the gap: dragging past a deletion block in the right column selects up
	 * to it, not across it.
	 */
	const resolveRange = useCallback(
		(side: SplitDiffSide, anchorKey: string, headKey: string): RowRange | null => {
			const anchorIndex = rowIndexByKey.get(anchorKey);
			const headIndex = rowIndexByKey.get(headKey) ?? anchorIndex;
			if (anchorIndex === undefined || headIndex === undefined) {
				return null;
			}
			const anchorRow = rows[anchorIndex];
			if (!anchorRow || !isCommentableOnSplitSide(anchorRow, side)) {
				return null;
			}

			const keys = new Set<string>([anchorRow.key]);
			let first = anchorIndex;
			let last = anchorIndex;
			const step = headIndex >= anchorIndex ? 1 : -1;
			for (let index = anchorIndex + step; index !== headIndex + step; index += step) {
				const row = rows[index];
				if (!row || !isCommentableOnSplitSide(row, side) || row.lineNumber == null) {
					break;
				}
				keys.add(row.key);
				first = Math.min(first, index);
				last = Math.max(last, index);
			}

			const start = rows[first];
			const end = rows[last];
			if (!start || !end) {
				return null;
			}
			return { keys, start, end };
		},
		[rowIndexByKey, rows],
	);

	/** Rows painted as selected: the live drag, or the run the open composer covers. */
	const selectedRowKeys = useMemo(() => {
		if (drag) {
			return resolveRange(drag.side, drag.anchorKey, drag.headKey)?.keys ?? null;
		}
		if (composer) {
			return resolveRange(composer.side, composer.startRowKey, composer.rowKey)?.keys ?? null;
		}
		return null;
	}, [composer, drag, resolveRange]);

	const annotations = useMemo(
		() =>
			buildLineAnnotations({
				path,
				oldPath: file?.oldPath ?? path,
				draftComments,
				discussions,
			}),
		[discussions, draftComments, file?.oldPath, path],
	);

	/** New-file line numbers that are added in this diff (used to highlight in full-file view). */
	const changedLineNumbers = useMemo(() => {
		const added = new Set<number>();
		for (const row of rows) {
			if (row.variant === "added" && row.lineNumber != null) {
				added.add(row.lineNumber);
			}
		}
		return { added };
	}, [rows]);

	const handleToggleFullFile = useCallback(async () => {
		if (!showFullFile) {
			setShowFullFile(true);
			if (fullFileContent === null && onFetchFullFile) {
				setIsLoadingFullFile(true);
				try {
					const content = await onFetchFullFile();
					setFullFileContent(content);
				} finally {
					setIsLoadingFullFile(false);
				}
			}
		} else {
			setShowFullFile(false);
		}
	}, [showFullFile, fullFileContent, onFetchFullFile]);

	const closeComposer = useCallback(() => {
		setComposer(null);
		setComposerText("");
		onClearCitations();
		onComposerOpenChange(false);
	}, [onClearCitations, onComposerOpenChange]);

	/** Read while resolving a gesture, so opening can no-op on the run already shown. */
	const composerRef = useRef(composer);
	composerRef.current = composer;

	const openComposer = useCallback(
		(anchor: ComposerAnchor) => {
			setComposer(anchor);
			setComposerText("");
			onClearCitations();
			onComposerOpenChange(true);
		},
		[onClearCitations, onComposerOpenChange],
	);

	/**
	 * Opens the composer for a finished drag. A press and release on one row resolves
	 * to a one-row range, so click-to-comment needs no separate path.
	 */
	const openComposerForRange = useCallback(
		(side: SplitDiffSide, anchorKey: string, headKey: string) => {
			const range = resolveRange(side, anchorKey, headKey);
			if (!range) {
				return;
			}
			const open = composerRef.current;
			if (open && open.side === side && open.rowKey === range.end.key && open.startRowKey === range.start.key) {
				// The same run as the composer already showing — a press and release inside
				// one row raises both mouseup and click, and re-opening would wipe the text.
				return;
			}
			const startLines = resolveRowLines(range.start);
			const endLines = resolveRowLines(range.end);
			openComposer({
				rowKey: range.end.key,
				startRowKey: range.start.key,
				side,
				oldLine: endLines.oldLine,
				newLine: endLines.newLine,
				startOldLine: startLines.oldLine,
				startNewLine: startLines.newLine,
			});
		},
		[openComposer, resolveRange],
	);

	const startDrag = useCallback((side: SplitDiffSide, rowKey: string) => {
		setDrag({ side, anchorKey: rowKey, headKey: rowKey });
	}, []);

	const extendDrag = useCallback((side: SplitDiffSide, rowKey: string) => {
		setDrag((current) => {
			// A pointer crossing into the other column keeps the run it started in.
			if (!current || current.side !== side || current.headKey === rowKey) {
				return current;
			}
			if (rowKey !== current.anchorKey) {
				// The gesture is now a row selection, not a text selection. Dropping the
				// native one here (rather than preventing it on mousedown) is what keeps
				// selecting and copying the text of a single line working.
				window.getSelection()?.removeAllRanges();
			}
			return { ...current, headKey: rowKey };
		});
	}, []);

	// Release ends the drag wherever it happens, including outside the pane — a
	// mouseup the window never sees would leave the rows stuck in selection.
	useEffect(() => {
		if (!drag) {
			return;
		}
		const finish = (): void => {
			openComposerForRange(drag.side, drag.anchorKey, drag.headKey);
			setDrag(null);
		};
		window.addEventListener("mouseup", finish);
		return () => window.removeEventListener("mouseup", finish);
	}, [drag, openComposerForRange]);

	const saveComposer = useCallback(() => {
		if (!composer || !file) {
			return;
		}
		const isRange =
			composer.startOldLine !== composer.oldLine || composer.startNewLine !== composer.newLine;
		onAddDraft({
			newPath: file.newPath,
			oldPath: file.oldPath,
			oldLine: composer.oldLine,
			newLine: composer.newLine,
			...(isRange
				? { lineRange: { startOldLine: composer.startOldLine, startNewLine: composer.startNewLine } }
				: {}),
			text: composerText.trim(),
			ruleIds: pendingCitations,
		});
		closeComposer();
	}, [closeComposer, composer, composerText, file, onAddDraft, pendingCitations]);

	const scrollRef = useRef<HTMLDivElement | null>(null);
	const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	/** Latched so one long stay at the bottom advances once, not once per scroll event. */
	const hasAdvancedRef = useRef(false);
	// Read inside the timer rather than captured: the reviewer may start writing during
	// the dwell, and a note in progress must not be teleported off screen.
	const suppressAdvanceRef = useRef(false);
	suppressAdvanceRef.current = composer !== null || drag !== null;

	const clearAdvanceTimer = useCallback(() => {
		if (advanceTimerRef.current) {
			clearTimeout(advanceTimerRef.current);
			advanceTimerRef.current = null;
		}
	}, []);

	const handleScroll = useCallback(() => {
		const element = scrollRef.current;
		if (!element || !onReachedEnd) {
			return;
		}
		// A file shorter than the viewport is already "at the bottom" on open, so
		// without the overflow check it would navigate away the moment it appeared.
		const canScroll = element.scrollHeight > element.clientHeight;
		const atEnd =
			canScroll && element.scrollTop + element.clientHeight >= element.scrollHeight - END_THRESHOLD_PX;
		if (!atEnd) {
			hasAdvancedRef.current = false;
			clearAdvanceTimer();
			return;
		}
		if (hasAdvancedRef.current || advanceTimerRef.current) {
			return;
		}
		advanceTimerRef.current = setTimeout(() => {
			advanceTimerRef.current = null;
			if (suppressAdvanceRef.current) {
				return;
			}
			hasAdvancedRef.current = true;
			onReachedEnd();
		}, END_DWELL_MS);
	}, [clearAdvanceTimer, onReachedEnd]);

	// Held in a ref because the parent passes fresh callback identities every render,
	// so depending on `closeComposer` directly would close the composer as fast as it
	// opens.
	const closeComposerRef = useRef(closeComposer);
	closeComposerRef.current = closeComposer;

	// A new file starts at the top, un-advanced, with nothing carried over from the
	// last one — a composer anchored to a row key of the previous file cannot resolve.
	useEffect(() => {
		hasAdvancedRef.current = false;
		clearAdvanceTimer();
		setDrag(null);
		closeComposerRef.current();
		if (scrollRef.current) {
			scrollRef.current.scrollTop = 0;
		}
	}, [clearAdvanceTimer, path]);

	useEffect(() => clearAdvanceTimer, [clearAdvanceTimer]);

	const renderSide = useCallback(
		(row: UnifiedDiffRow, side: SplitDiffSide): ReactElement | null => {
			const lineNumber = row.lineNumber;
			if (lineNumber == null) {
				return null;
			}
			const commentable = isCommentableOnSplitSide(row, side);
			// A removed row's number is an old-side number; everything else is new-side.
			// Mixing these up is what silently posts a note against the wrong revision;
			// `resolveRowLines` is the single place that decision is made.
			const rowDrafts = commentable
				? (row.variant === "removed"
						? annotations.draftsByOldLine.get(lineNumber)
						: annotations.draftsByNewLine.get(lineNumber)) ?? []
				: [];
			const rowThreads = commentable
				? (row.variant === "removed"
						? annotations.threadsByOldLine.get(lineNumber)
						: annotations.threadsByNewLine.get(lineNumber)) ?? []
				: [];
			const hasAnnotation = rowDrafts.length > 0 || rowThreads.length > 0;

			const variantClass =
				row.variant === "added"
					? "kb-diff-row-added"
					: row.variant === "removed"
						? "kb-diff-row-removed"
						: "kb-diff-row-context";
			const isComposerHere = composer?.rowKey === row.key && composer.side === side;
			const isSelected = commentable && selectedRowKeys?.has(row.key) === true;

			return (
				<div className="flex min-w-0 flex-col">
					<div
						className={cn(
							"kb-diff-row",
							variantClass,
							hasAnnotation && "kb-diff-row-commented",
							isSelected && "kb-diff-row-selected",
							!commentable && "kb-diff-row-noncommentable",
						)}
						data-row-key={row.key}
						data-diff-side={side}
						// Press-drag-release is one gesture: a press and release on the same row
						// resolves to a one-row range, which is the old click-to-comment.
						onMouseDown={commentable ? () => startDrag(side, row.key) : undefined}
						onMouseEnter={commentable ? () => extendDrag(side, row.key) : undefined}
					>
						<span
							className="kb-diff-line-number"
							style={{ color: "var(--color-text-tertiary)" }}
							// A press that starts on the gutter is never meant to select text, so
							// this one suppresses it up front instead of clearing it mid-drag.
							onMouseDown={commentable ? (event) => event.preventDefault() : undefined}
						>
							<span className="kb-diff-line-number-text">{lineNumber}</span>
							{commentable ? (
								<span className="kb-diff-comment-gutter">
									<span className="kb-diff-gutter-icon-comment">
										<MessageSquare size={12} />
									</span>
								</span>
							) : null}
						</span>
						<DiffRowText
							row={row}
							highlightedLineHtml={getHighlightedLineHtml(row.text, prismGrammar, prismLanguage)}
							grammar={prismGrammar}
							language={prismLanguage}
						/>
					</div>

					{rowThreads.map((thread) => (
						<div
							key={thread.id}
							className={cn(
								"border-l-2 px-2.5 py-1.5 text-[11px]",
								thread.resolved
									? "border-status-green bg-surface-1 text-text-tertiary"
									: "border-status-orange bg-surface-1 text-text-secondary",
							)}
						>
							<span className="font-semibold">
								{thread.resolved ? "Resolved thread" : "Unresolved thread"}
							</span>
							{": "}
							{thread.notes.find((note) => !note.system)?.body ?? ""}
						</div>
					))}

					{rowDrafts.map((draft) => (
						<div
							key={draft.id}
							className="space-y-1 border-l-2 border-accent bg-surface-1 px-2.5 py-1.5 text-[11px]"
						>
							<div className="flex items-start justify-between gap-2">
								<span className="whitespace-pre-wrap text-text-primary">{draft.text}</span>
								<button
									type="button"
									aria-label="Delete draft comment"
									className="shrink-0 cursor-pointer text-text-tertiary hover:text-status-red"
									onClick={(event) => {
										event.stopPropagation();
										onRemoveDraft(draft.id);
									}}
								>
									×
								</button>
							</div>
							{draft.ruleIds.length > 0 ? (
								<div className="flex flex-wrap gap-1">
									{draft.ruleIds.map((ruleId) => (
										<span
											key={ruleId}
											className="rounded border border-border-bright bg-surface-2 px-1 text-[9px] text-text-secondary"
										>
											{ruleId}
										</span>
									))}
								</div>
							) : null}
							<div className="text-[9px] text-text-tertiary">
								{/* A range note hangs off its end line, so the span it covers is not
								    otherwise visible from where the draft renders. */}
								{draft.lineRange
									? `Lines ${formatLineEndpoint(
											draft.lineRange.startOldLine,
											draft.lineRange.startNewLine,
										)} to ${formatLineEndpoint(draft.oldLine, draft.newLine)} · `
									: ""}
								Draft by {draft.author} — not published yet
							</div>
						</div>
					))}

					{isComposerHere && composer ? (
						<ReviewCommentComposer
							path={path}
							startLabel={formatLineEndpoint(composer.startOldLine, composer.startNewLine)}
							endLabel={formatLineEndpoint(composer.oldLine, composer.newLine)}
							text={composerText}
							citedRuleIds={pendingCitations}
							onTextChange={setComposerText}
							onRemoveCitation={onRemoveCitation}
							onCancel={closeComposer}
							onSave={saveComposer}
						/>
					) : null}
				</div>
			);
		},
		[
			annotations,
			closeComposer,
			composer,
			composerText,
			extendDrag,
			onRemoveCitation,
			onRemoveDraft,
			path,
			pendingCitations,
			prismGrammar,
			prismLanguage,
			saveComposer,
			selectedRowKeys,
			startDrag,
		],
	);

	if (!file) {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center bg-surface-0">
				<p className="text-xs text-text-tertiary">Select a changed file to review it.</p>
			</div>
		);
	}

	const status = resolveFileStatus(file);
	// Split rendering doubles the DOM per row, so the shared large-diff guard matters
	// more here than in the unified viewer, not less.
	const isLarge = isLargeFileDiff(file.additions, file.deletions);

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-0">
			{deltaBanner ? (
				<div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-1 px-3 py-1.5 text-[11px] text-text-secondary">
					<Clock size={12} className="text-status-orange" />
					<span>
						New commits since your last pass:{" "}
						<code className="font-mono text-text-tertiary">{deltaBanner.previousHeadSha.slice(0, 8)}</code> →{" "}
						<code className="font-mono text-status-green">{deltaBanner.currentHeadSha.slice(0, 8)}</code>
					</span>
				</div>
			) : null}

			<div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface-1 px-3 text-xs">
				<div className="flex min-w-0 items-center gap-2">
					<FileCode size={13} className="shrink-0 text-accent" />
					<span className="truncate font-mono font-semibold text-text-primary" title={file.newPath}>
						{file.renamedFile ? `${file.oldPath} → ${file.newPath}` : file.newPath}
					</span>
					<span className="shrink-0 rounded bg-surface-3 px-1.5 text-[10px] uppercase text-text-secondary">
						{status}
					</span>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<div className="flex items-center rounded border border-border bg-surface-2 p-0.5">
						<button
							type="button"
							onClick={() => { setShowFullFile(false); onModeChange("split"); }}
							className={cn(
								"flex cursor-pointer items-center gap-1 rounded-sm px-2 py-0.5 text-[11px]",
								!showFullFile && mode === "split" ? "bg-surface-4 text-text-primary" : "text-text-secondary hover:text-text-primary",
							)}
						>
							<Columns2 size={11} /> Side-by-side
						</button>
						<button
							type="button"
							onClick={() => { setShowFullFile(false); onModeChange("unified"); }}
							className={cn(
								"flex cursor-pointer items-center gap-1 rounded-sm px-2 py-0.5 text-[11px]",
								!showFullFile && mode === "unified"
									? "bg-surface-4 text-text-primary"
									: "text-text-secondary hover:text-text-primary",
							)}
						>
							<Menu size={11} /> Unified
						</button>
						{onFetchFullFile ? (
							<button
								type="button"
								onClick={() => { void handleToggleFullFile(); }}
								className={cn(
									"flex cursor-pointer items-center gap-1 rounded-sm px-2 py-0.5 text-[11px]",
									showFullFile ? "bg-surface-4 text-text-primary" : "text-text-secondary hover:text-text-primary",
								)}
							>
								<FileCode size={11} /> Full file
							</button>
						) : null}
					</div>
					<Button
						variant={isReviewed ? "primary" : "default"}
						size="sm"
						icon={isReviewed ? <SquareCheck size={12} /> : <Square size={12} />}
						onClick={onToggleReviewed}
					>
						{isReviewed ? "Reviewed" : "Mark reviewed"}
					</Button>
				</div>
			</div>

			{!showFullFile && mode === "split" ? (
				<div className="grid shrink-0 grid-cols-2 divide-x divide-border border-b border-border bg-surface-0 px-0 font-mono text-[11px] text-text-tertiary">
					<div className="px-3 py-1">Base — {file.oldPath}</div>
					<div className="px-3 py-1">Merge request — {file.newPath}</div>
				</div>
			) : null}

			<div
				ref={scrollRef}
				onScroll={handleScroll}
				data-testid="review-diff-scroll"
				className={cn(
					"min-h-0 flex-1 overflow-auto",
					// Only once the drag spans rows: a press inside one row is still a text
					// selection, and locking `user-select` would break copying that line.
					drag && drag.headKey !== drag.anchorKey && "kb-diff-body-dragging",
				)}
			>
				{showFullFile ? (
					isLoadingFullFile ? (
						<div className="flex items-center justify-center p-4">
							<Loader2 size={16} className="animate-spin text-text-tertiary" />
						</div>
					) : fullFileContent === null ? (
						<p className="p-4 text-xs text-text-tertiary">Could not load file content.</p>
					) : (
						<div>
							{fullFileContent.split("\n").map((line, index) => {
								const lineNum = index + 1;
								const isAdded = changedLineNumbers.added.has(lineNum);
								const highlightedHtml = getHighlightedLineHtml(line, prismGrammar, prismLanguage);
								return (
									<div
										key={lineNum}
										className={cn(
											"kb-diff-row",
											isAdded ? "kb-diff-row-added" : "kb-diff-row-context",
										)}
									>
										<span className="kb-diff-line-number" style={{ color: "var(--color-text-tertiary)" }}>
											<span className="kb-diff-line-number-text">{lineNum}</span>
										</span>
										{highlightedHtml != null ? (
											<span
												className="font-mono kb-diff-text"
												// biome-ignore lint/security/noDangerouslySetInnerHtml: trusted Prism output
												dangerouslySetInnerHTML={{ __html: highlightedHtml }}
											/>
										) : (
											<span className="font-mono kb-diff-text">{line || " "}</span>
										)}
									</div>
								);
							})}
						</div>
					)
				) : file.binary ? (
					<p className="p-4 text-xs text-text-tertiary">Binary file — no text diff to show.</p>
				) : file.tooLarge ? (
					<p className="p-4 text-xs text-text-tertiary">
						GitLab truncated this file's diff because it is too large to send.
					</p>
				) : isLarge && !forceRenderLargeDiff ? (
					<div className="space-y-2 p-4">
						<p className="text-xs text-text-secondary">
							{file.additions + file.deletions} changed lines. Rendering this side by side is slow enough to
							hang the tab, so it is collapsed by default.
						</p>
						<Button variant="default" size="sm" onClick={() => setForceRenderLargeDiff(true)}>
							Render it anyway
						</Button>
					</div>
				) : mode === "split" ? (
					<SplitDiffGrid
						displayItems={displayItems}
						renderSide={renderSide}
						expandHandlers={{ expandTop, expandBottom, expandAll }}
					/>
				) : (
					<div>
						{displayItems.map((item) =>
							item.type === "row" ? (
								<div key={item.row.key}>{renderSide(item.row, item.row.variant === "removed" ? "left" : "right")}</div>
							) : (
								<div key={item.block.id}>
									<CollapsedBlockControls
										block={item.block}
										onExpandTop={expandTop}
										onExpandBottom={expandBottom}
										onExpandAll={expandAll}
									/>
									{item.block.expanded
										? item.block.rows.map((row) => (
												<div key={row.key}>{renderSide(row, row.variant === "removed" ? "left" : "right")}</div>
											))
										: null}
								</div>
							),
						)}
					</div>
				)}
			</div>
		</div>
	);
}
