import { Clock, Columns2, FileCode, Menu, MessageSquare, Square, SquareCheck } from "lucide-react";
import { type ReactElement, useCallback, useMemo, useState } from "react";

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
import type { RuntimeGitlabDiffFile, RuntimeGitlabDiscussion, RuntimeReviewDraftComment } from "@/runtime/types";

export interface ReviewCommentDraftInput {
	newPath: string;
	oldPath: string;
	oldLine: number | null;
	newLine: number | null;
	text: string;
	ruleIds: string[];
}

/** Which line the composer is open on, and on which side of the split. */
interface ComposerAnchor {
	rowKey: string;
	side: SplitDiffSide;
	oldLine: number | null;
	newLine: number | null;
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
}): ReactElement {
	const [composer, setComposer] = useState<ComposerAnchor | null>(null);
	const [composerText, setComposerText] = useState("");
	const [forceRenderLargeDiff, setForceRenderLargeDiff] = useState(false);
	const { expandedBlocks, expandTop, expandBottom, expandAll } = useIncrementalExpand();

	const path = file?.newPath ?? "";
	const prismLanguage = useMemo(() => resolvePrismLanguage(path), [path]);
	const prismGrammar = useMemo(() => resolvePrismGrammar(prismLanguage), [prismLanguage]);

	const rows = useMemo(() => (file ? parsePatchToRows(file.diff) : []), [file]);
	const displayItems = useMemo(() => buildDisplayItems(rows, expandedBlocks), [expandedBlocks, rows]);

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

	const closeComposer = useCallback(() => {
		setComposer(null);
		setComposerText("");
		onClearCitations();
		onComposerOpenChange(false);
	}, [onClearCitations, onComposerOpenChange]);

	const openComposer = useCallback(
		(anchor: ComposerAnchor) => {
			setComposer(anchor);
			setComposerText("");
			onClearCitations();
			onComposerOpenChange(true);
		},
		[onClearCitations, onComposerOpenChange],
	);

	const saveComposer = useCallback(() => {
		if (!composer || !file) {
			return;
		}
		onAddDraft({
			newPath: file.newPath,
			oldPath: file.oldPath,
			oldLine: composer.oldLine,
			newLine: composer.newLine,
			text: composerText.trim(),
			ruleIds: pendingCitations,
		});
		closeComposer();
	}, [closeComposer, composer, composerText, file, onAddDraft, pendingCitations]);

	const renderSide = useCallback(
		(row: UnifiedDiffRow, side: SplitDiffSide): ReactElement | null => {
			const lineNumber = row.lineNumber;
			if (lineNumber == null) {
				return null;
			}
			const commentable = isCommentableOnSplitSide(row, side);
			// A removed row's number is an old-side number; everything else is new-side.
			// Mixing these up is what silently posts a note against the wrong revision.
			const oldLine = row.variant === "removed" ? lineNumber : null;
			const newLine = row.variant === "removed" ? null : lineNumber;

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

			return (
				<div className="flex min-w-0 flex-col">
					<div
						className={cn(
							"kb-diff-row",
							variantClass,
							hasAnnotation && "kb-diff-row-commented",
							!commentable && "kb-diff-row-noncommentable",
						)}
						onClick={
							commentable
								? () => openComposer({ rowKey: row.key, side, oldLine, newLine })
								: undefined
						}
					>
						<span className="kb-diff-line-number" style={{ color: "var(--color-text-tertiary)" }}>
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
								Draft by {draft.author} — not published yet
							</div>
						</div>
					))}

					{isComposerHere ? (
						<ReviewCommentComposer
							lineLabel={`${path}:${lineNumber}`}
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
			onRemoveCitation,
			onRemoveDraft,
			openComposer,
			path,
			pendingCitations,
			prismGrammar,
			prismLanguage,
			saveComposer,
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

			<div className="min-h-0 flex-1 overflow-auto">
				{file.binary ? (
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
