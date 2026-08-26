import {
	ChevronDown,
	ChevronUp,
	Clock,
	Columns2,
	FileCode,
	Loader2,
	Menu,
	MessageSquare,
	Square,
	SquareCheck,
} from "lucide-react";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ReviewCommentComposer } from "@/components/review/review-comment-composer";
import {
	buildDisplayItems,
	CollapsedBlockControls,
	type DiffDisplayItem,
	DiffRowText,
	getHighlightedLineHtml,
	isLargeFileDiff,
	LARGE_FILE_DIFF_LINE_THRESHOLD,
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
import {
	accumulateDeepScroll,
	createDeepScrollState,
	createLockedDeepScrollState,
	DEEP_SCROLL_EDGE_EPSILON_PX,
	normalizeWheelDeltaPx,
} from "@/review/review-deep-scroll";
import { buildFullFileRows } from "@/review/review-full-file-rows";
import {
	buildLineAnnotations,
	type ReviewDiffMode,
	type ReviewLineSelection,
	type ReviewNavDirection,
	type ReviewVisibleRange,
	resolveFileStatus,
} from "@/review/review-target";
import { type FullFileFetchResult, useFullFileContent } from "@/review/use-full-file-content";
import type {
	RuntimeGitlabDiffFile,
	RuntimeGitlabDiscussion,
	RuntimeGitlabNoteLineRange,
	RuntimeReviewDraftComment,
} from "@/runtime/types";

/** Line numbers on a removed row belong to the pre-image; everything else post-image. */
function rowSide(variant: UnifiedDiffRow["variant"]): "old" | "new" {
	return variant === "removed" ? "old" : "new";
}

/**
 * The text of every row whose line number falls inside the range, on one side.
 *
 * Sliced from the already-parsed rows rather than the raw patch: the reviewer picked
 * lines out of what they can see, and the rendered rows are that.
 */
function collectSelectedText(
	rows: UnifiedDiffRow[],
	side: "old" | "new",
	startLine: number,
	endLine: number,
): string {
	return rows
		.filter(
			(row) =>
				row.lineNumber != null &&
				rowSide(row.variant) === side &&
				row.lineNumber >= startLine &&
				row.lineNumber <= endLine,
		)
		.map((row) => `${row.lineNumber}: ${row.text}`)
		.join("\n");
}

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

/** The old/new line pair a row anchors a note to. A removed row is old-side only. */
function resolveRowLines(row: UnifiedDiffRow): { oldLine: number | null; newLine: number | null } {
	if (row.lineNumber == null) {
		return { oldLine: null, newLine: null };
	}
	if (row.variant === "removed") {
		return { oldLine: row.lineNumber, newLine: null };
	}
	if (row.variant === "added") {
		return { oldLine: null, newLine: row.lineNumber };
	}
	// An unchanged line exists in both revisions, and GitLab wants both numbers to
	// anchor a note to it. Outside a hunk that is not optional: the post-image number
	// alone does not locate the line in the pre-image. See `gitlab-position.ts`.
	return { oldLine: row.oldLineNumber ?? null, newLine: row.lineNumber };
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
	selection,
	onSelectionChange,
	onVisibleRangeChange,
	onNavigate,
	navTargets,
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
	/** Fetches the active file's post-image. Absent when no source can supply one. */
	onFetchFullFile?: () => Promise<FullFileFetchResult>;
	/**
	 * Lines the reviewer has focused, shared with the chat panel. Optional because the
	 * pane is a usable diff viewer without a chat beside it — the standalone Review
	 * package and the pane's own tests render it that way.
	 */
	selection?: ReviewLineSelection | null;
	onSelectionChange?: (selection: ReviewLineSelection | null) => void;
	/** Must be referentially stable — it re-arms the visibility observer. */
	onVisibleRangeChange?: (range: ReviewVisibleRange | null) => void;
	/**
	 * Moves to the adjacent file that still needs reading. Called by the header buttons, by
	 * the workspace's `]` / `[` keys, and by a wheel gesture that *begins* at an edge of the
	 * diff and pushes past it. Only the gesture's first event decides: wheeling from the
	 * middle of a long diff down to its bottom never navigates, however far the momentum
	 * carries, and one that does navigate is locked until the wheel goes quiet — so a flick
	 * moves exactly one file. A short diff sits at its top and its bottom at once, which is
	 * how it gets both directions rather than teleporting the reviewer away mid-read.
	 */
	onNavigate?: (direction: ReviewNavDirection) => void;
	/** Whether a target exists each way, so the buttons disable instead of no-op. */
	navTargets?: { previous: boolean; next: boolean };
}): ReactElement {
	const [composer, setComposer] = useState<ComposerAnchor | null>(null);
	const [composerText, setComposerText] = useState("");
	const [drag, setDrag] = useState<DragState | null>(null);
	const [forceRenderLargeDiff, setForceRenderLargeDiff] = useState(false);
	const [showFullFile, setShowFullFile] = useState(false);
	const { expandedBlocks, expandTop, expandBottom, expandAll } = useIncrementalExpand();
	const scrollRef = useRef<HTMLDivElement | null>(null);

	const path = file?.newPath ?? "";
	const prismLanguage = useMemo(() => resolvePrismLanguage(path), [path]);
	const prismGrammar = useMemo(() => resolvePrismGrammar(prismLanguage), [prismLanguage]);

	/**
	 * Whether a post-image exists to fetch at all. A deleted file has none, and a binary
	 * or diff-truncated file has nothing this pane could render line by line.
	 */
	const canShowFullFile =
		onFetchFullFile !== undefined &&
		file !== null &&
		!file.binary &&
		!file.tooLarge &&
		!file.deletedFile;

	const fullFile = useFullFileContent({
		path: file?.newPath ?? null,
		enabled: canShowFullFile && showFullFile,
		fetchFile: onFetchFullFile,
	});

	const patchRows = useMemo(() => (file ? parsePatchToRows(file.diff) : []), [file]);

	/**
	 * The whole file as rows, or null when it has not been fetched — or when it cannot
	 * be reconciled with the patch, which means the two are different revisions and
	 * splicing them would anchor notes to lines nobody reviewed.
	 */
	const fullFileRows = useMemo(
		() =>
			file && fullFile.content !== null
				? buildFullFileRows({ patch: file.diff, content: fullFile.content })
				: null,
		[file, fullFile.content],
	);
	const fullFileUnusable = fullFile.content !== null && fullFileRows === null;

	// The whole pane is expressed over `rows`: selection, drag ranges, the composer's
	// anchors and the annotation lookup all read them. Swapping the source here is what
	// gives the full-file view every one of those without a second implementation.
	const rows = showFullFile && fullFileRows !== null ? fullFileRows : patchRows;
	const displayItems = useMemo<DiffDisplayItem[]>(
		() =>
			// Nothing is elided in the full file, so there is no context to collapse.
			showFullFile && fullFileRows !== null
				? rows.map((row) => ({ type: "row", row }))
				: buildDisplayItems(rows, expandedBlocks),
		[expandedBlocks, fullFileRows, rows, showFullFile],
	);

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

	// The hook owns fetching and its per-file invalidation; this only records intent, so
	// the toggle survives moving between files instead of silently reverting to the diff.
	const toggleFullFile = useCallback(() => {
		setShowFullFile((current) => !current);
	}, []);

	/**
	 * Reports the post-image line range currently on screen, so a question asked with
	 * nothing selected is still answered about the part of the file being read. Rows
	 * carry `data-review-line`; only new-side rows do, because an old-side number
	 * would make the reported range refer to a different revision than its path.
	 */
	useEffect(() => {
		const root = scrollRef.current;
		if (!root || !file) {
			return;
		}
		const path = file.newPath;
		const visible = new Set<number>();
		const report = (): void => {
			if (visible.size === 0) {
				onVisibleRangeChange?.(null);
				return;
			}
			// Spread into Math.min would overflow the argument limit on a long file.
			let startLine = Number.POSITIVE_INFINITY;
			let endLine = 0;
			for (const line of visible) {
				startLine = Math.min(startLine, line);
				endLine = Math.max(endLine, line);
			}
			onVisibleRangeChange?.({ path, startLine, endLine });
		};
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const raw = (entry.target as HTMLElement).dataset.reviewLine;
					const line = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
					if (!Number.isFinite(line)) {
						continue;
					}
					if (entry.isIntersecting) {
						visible.add(line);
					} else {
						visible.delete(line);
					}
				}
				report();
			},
			{ root },
		);
		for (const element of root.querySelectorAll<HTMLElement>("[data-review-line]")) {
			observer.observe(element);
		}
		return () => {
			observer.disconnect();
		};
		// `displayItems` covers expand/collapse; the mode and full-file flags re-render
		// a different set of rows, so the observer has to be re-armed against them too.
	}, [displayItems, file, mode, onVisibleRangeChange, showFullFile]);

	// A selection belongs to the file it was made in. Leaving it attached across a file
	// switch would send the chat lines the reviewer is no longer looking at.
	const activePathForSelection = file?.newPath ?? null;
	useEffect(() => {
		onSelectionChange?.(null);
	}, [activePathForSelection, onSelectionChange]);

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
	 * Opens the composer for a finished drag, and publishes the same run as the chat's
	 * context. A press and release on one row resolves to a one-row range, so
	 * click-to-comment needs no separate path.
	 *
	 * The run the reviewer just dragged out is also the run they are asking about, so
	 * one gesture serves both rather than the pane carrying two selection mechanisms
	 * with different clamping rules. This is the only place a resolved range exists.
	 */
	const openComposerForRange = useCallback(
		(side: SplitDiffSide, anchorKey: string, headKey: string) => {
			const range = resolveRange(side, anchorKey, headKey);
			if (!range) {
				return;
			}
			if (file) {
				// `resolveRange` has already clamped the run to one side, so either end
				// answers which revision the numbers belong to.
				const selectionSide = rowSide(range.end.variant);
				const startLine = Math.min(range.start.lineNumber ?? 0, range.end.lineNumber ?? 0);
				const endLine = Math.max(range.start.lineNumber ?? 0, range.end.lineNumber ?? 0);
				onSelectionChange?.({
					path: file.newPath,
					side: selectionSide,
					startLine,
					endLine,
					text: collectSelectedText(rows, selectionSide, startLine, endLine),
				});
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
		[file, onSelectionChange, openComposer, resolveRange, rows],
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

	// Held in a ref because the parent passes fresh callback identities every render,
	// so depending on `closeComposer` directly would close the composer as fast as it
	// opens.
	const closeComposerRef = useRef(closeComposer);
	closeComposerRef.current = closeComposer;

	// A new file starts at the top with nothing carried over from the last one — a
	// composer anchored to a row key of the previous file cannot resolve.
	useEffect(() => {
		setDrag(null);
		// "Render it anyway" was a judgement about the previous file's size, not this one's.
		setForceRenderLargeDiff(false);
		closeComposerRef.current();
		if (scrollRef.current) {
			scrollRef.current.scrollTop = 0;
		}
	}, [path]);

	/**
	 * Wheel navigation. Deliberately *not* reset when `path` changes: the lock a fired
	 * gesture leaves behind is what absorbs the momentum still arriving after the jump, and
	 * the new file is at its top — on a short one, at both edges — so a reset ref would let
	 * that momentum walk straight on to a third file.
	 *
	 * Everything the handler needs comes from refs, so the parent's fresh callback
	 * identities do not re-arm the listener on every render.
	 */
	const deepScrollRef = useRef(createDeepScrollState());
	const onNavigateRef = useRef(onNavigate);
	onNavigateRef.current = onNavigate;
	// A note in progress must never have the file moved out from under it.
	const isNavSuppressedRef = useRef(false);
	isNavSuppressedRef.current = composer !== null || drag !== null;

	useEffect(() => {
		const element = scrollRef.current;
		if (!element) {
			return;
		}
		const handleWheel = (event: WheelEvent) => {
			const nowMs = Date.now();
			if (isNavSuppressedRef.current) {
				// Locked rather than fresh: closing the composer mid-flick must not hand the
				// rest of that same gesture a navigation.
				deepScrollRef.current = createLockedDeepScrollState(nowMs);
				return;
			}
			const maxScrollTop = element.scrollHeight - element.clientHeight;
			const { state, triggered } = accumulateDeepScroll(deepScrollRef.current, {
				deltaPx: normalizeWheelDeltaPx({
					deltaY: event.deltaY,
					deltaMode: event.deltaMode,
					viewportPx: element.clientHeight,
				}),
				atTop: element.scrollTop <= DEEP_SCROLL_EDGE_EPSILON_PX,
				atBottom: maxScrollTop - element.scrollTop <= DEEP_SCROLL_EDGE_EPSILON_PX,
				nowMs,
			});
			deepScrollRef.current = state;
			if (triggered) {
				onNavigateRef.current?.(triggered);
			}
		};
		// Passive: at an edge the browser has nothing left to scroll, and `overscroll-contain`
		// on the container already stops the wheel chaining into the board behind it.
		element.addEventListener("wheel", handleWheel, { passive: true });
		return () => element.removeEventListener("wheel", handleWheel);
		// Keyed on `path` only because the scroller does not exist until a file does; the
		// state ref survives the re-attach, which is the whole point of it living outside.
	}, [path]);

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
						// Only new-side rows are tagged: the visibility observer reports a
						// post-image range, and an old-side number would make that range refer
						// to a different revision than the path beside it.
						data-review-line={resolveRowLines(row).newLine ?? undefined}
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
	const isShowingFullFile = showFullFile && fullFileRows !== null;
	// Split rendering doubles the DOM per row, so the shared large-diff guard matters
	// more here than in the unified viewer, not less. Filling the elided context makes
	// the row count, not the change count, the thing that has to be capped — every row
	// carries drag handlers and is watched by the visibility observer.
	const isRenderBlocked = isShowingFullFile
		? rows.length > LARGE_FILE_DIFF_LINE_THRESHOLD
		: isLargeFileDiff(file.additions, file.deletions);

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
					{onNavigate ? (
						<div className="flex items-center gap-1">
							<Button
								variant="default"
								size="sm"
								icon={<ChevronUp size={12} />}
								disabled={navTargets ? !navTargets.previous : false}
								onClick={() => onNavigate("previous")}
								title="Previous unreviewed file ( [ or Shift+K )"
							>
								Prev
							</Button>
							<Button
								variant="default"
								size="sm"
								icon={<ChevronDown size={12} />}
								disabled={navTargets ? !navTargets.next : false}
								onClick={() => onNavigate("next")}
								title="Next unreviewed file ( ] or Shift+J )"
							>
								Next
							</Button>
						</div>
					) : null}
					<div className="flex items-center rounded border border-border bg-surface-2 p-0.5">
						<button
							type="button"
							onClick={() => onModeChange("split")}
							className={cn(
								"flex cursor-pointer items-center gap-1 rounded-sm px-2 py-0.5 text-[11px]",
								mode === "split" ? "bg-surface-4 text-text-primary" : "text-text-secondary hover:text-text-primary",
							)}
						>
							<Columns2 size={11} /> Side-by-side
						</button>
						<button
							type="button"
							onClick={() => onModeChange("unified")}
							className={cn(
								"flex cursor-pointer items-center gap-1 rounded-sm px-2 py-0.5 text-[11px]",
								mode === "unified"
									? "bg-surface-4 text-text-primary"
									: "text-text-secondary hover:text-text-primary",
							)}
						>
							<Menu size={11} /> Unified
						</button>
						{/* Not a third mode: it fills the context the patch elided, and either
						    mode renders the result. */}
						{canShowFullFile ? (
							<button
								type="button"
								aria-pressed={showFullFile}
								onClick={toggleFullFile}
								title="Show every line of the file, not only the changed hunks"
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

			{mode === "split" ? (
				<div className="grid shrink-0 grid-cols-2 divide-x divide-border border-b border-border bg-surface-0 px-0 font-mono text-[11px] text-text-tertiary">
					<div className="px-3 py-1">Base — {file.oldPath}</div>
					<div className="px-3 py-1">Merge request — {file.newPath}</div>
				</div>
			) : null}

			{showFullFile && fullFileUnusable ? (
				<div className="shrink-0 border-b border-border bg-surface-1 px-3 py-1.5 text-[11px] text-status-orange">
					The file GitLab returned does not line up with this diff — it has probably moved on
					since the merge request was loaded. Showing the diff instead; refresh to try again.
				</div>
			) : null}

			<div
				ref={scrollRef}
				data-testid="review-diff-scroll"
				className={cn(
					// `overscroll-contain`: a wheel past either edge stays here rather than
					// chaining into the board behind the workspace.
					"min-h-0 flex-1 overflow-auto overscroll-contain",
					// Only once the drag spans rows: a press inside one row is still a text
					// selection, and locking `user-select` would break copying that line.
					drag && drag.headKey !== drag.anchorKey && "kb-diff-body-dragging",
				)}
			>
				{file.binary ? (
					<p className="p-4 text-xs text-text-tertiary">Binary file — no text diff to show.</p>
				) : file.tooLarge ? (
					<p className="p-4 text-xs text-text-tertiary">
						GitLab truncated this file's diff because it is too large to send.
					</p>
				) : showFullFile && fullFile.isLoading ? (
					<div className="flex items-center justify-center p-4">
						<Loader2 size={16} className="animate-spin text-text-tertiary" />
					</div>
				) : showFullFile && fullFile.error !== null ? (
					<div className="space-y-2 p-4">
						<p className="text-xs text-status-red">{fullFile.error}</p>
						<Button variant="default" size="sm" onClick={fullFile.retry}>
							Try again
						</Button>
					</div>
				) : isRenderBlocked && !forceRenderLargeDiff ? (
					<div className="space-y-2 p-4">
						<p className="text-xs text-text-secondary">
							{isShowingFullFile
								? `${rows.length} lines. Rendering the whole file is slow enough to hang the tab, so it is collapsed by default.`
								: `${file.additions + file.deletions} changed lines. Rendering this side by side is slow enough to hang the tab, so it is collapsed by default.`}
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
