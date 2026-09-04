import { Check, ChevronDown, ChevronRight, FileWarning } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
	buildDisplayItems,
	buildUnifiedDiffRows,
	DiffRowText,
	getHighlightedLineHtml,
	resolvePrismGrammar,
	resolvePrismLanguage,
	type UnifiedDiffRow,
	useIncrementalExpand,
} from "@/components/shared/diff-renderer";
import { SplitDiffGrid, type SplitDiffSide } from "@/components/shared/split-diff-renderer";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import type { RuntimeGitConflictFile, RuntimeGitConflictSide } from "@/runtime/types";

/**
 * One conflicted file: *ours* against *theirs* side by side, plus an editable pane
 * seeded with git's own marker-bearing merge.
 *
 * Whole-file "use ours" / "use theirs" was all the dialog ever offered, which
 * cannot settle a conflict where both sides are partly right. The editable pane is
 * the answer to that: it starts from the `<<<<<<<`/`=======`/`>>>>>>>` file the user
 * would have edited in a terminal and saves through the `side: "manual"` path the
 * runtime already supported but nothing ever called.
 */
export function ConflictFileResolver({
	conflict,
	operation,
	isResolving,
	onResolve,
}: {
	conflict: RuntimeGitConflictFile;
	operation: "merge" | "rebase" | "cherry-pick" | null;
	isResolving: boolean;
	onResolve: (path: string, side: RuntimeGitConflictSide, content?: string) => void;
}): React.ReactElement {
	const [isExpanded, setIsExpanded] = useState(true);
	const [draft, setDraft] = useState(conflict.merged ?? "");
	const [hasEdited, setHasEdited] = useState(false);

	// Re-seed when the file's own merged text changes underneath us (a reload after
	// resolving a different file), but never clobber an edit in progress.
	useEffect(() => {
		if (!hasEdited) {
			setDraft(conflict.merged ?? "");
		}
	}, [conflict.merged, hasEdited]);

	const prismLanguage = useMemo(() => resolvePrismLanguage(conflict.path), [conflict.path]);
	const prismGrammar = useMemo(() => resolvePrismGrammar(prismLanguage), [prismLanguage]);
	const { expandedBlocks, expandTop, expandBottom, expandAll } = useIncrementalExpand();

	// `ours` is the left column, `theirs` the right. During a rebase or cherry-pick
	// "ours" is the branch being replayed onto, not the user's branch — hence the
	// explicit labels below rather than a bare ours/theirs.
	const displayItems = useMemo(
		() => buildDisplayItems(buildUnifiedDiffRows(conflict.ours ?? "", conflict.theirs ?? ""), expandedBlocks),
		[conflict.ours, conflict.theirs, expandedBlocks],
	);

	const renderSide = (row: UnifiedDiffRow, side: SplitDiffSide): React.ReactElement => (
		<div
			className={cn(
				"kb-diff-row",
				row.variant === "added"
					? "kb-diff-row-added"
					: row.variant === "removed"
						? "kb-diff-row-removed"
						: "kb-diff-row-context",
			)}
			style={{ cursor: "default" }}
			data-side={side}
		>
			<span className="kb-diff-line-number" style={{ color: "var(--color-text-tertiary)" }}>
				<span className="kb-diff-line-number-text">{row.lineNumber ?? ""}</span>
			</span>
			<DiffRowText
				row={row}
				highlightedLineHtml={getHighlightedLineHtml(row.text, prismGrammar, prismLanguage)}
				grammar={prismGrammar}
				language={prismLanguage}
			/>
		</div>
	);

	const oursLabel = operation === "merge" ? "Ours (base branch)" : "Ours (target)";
	const theirsLabel = operation === "merge" ? "Theirs (incoming)" : "Theirs (replayed commit)";
	const stillHasMarkers = draft.includes("<<<<<<<") || draft.includes(">>>>>>>");

	return (
		<li className="overflow-hidden rounded-md border border-border bg-surface-2">
			<div className="flex items-center gap-2 px-2.5 py-2 text-[12px]">
				<button
					type="button"
					className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
					onClick={() => setIsExpanded((current) => !current)}
					aria-expanded={isExpanded}
				>
					{isExpanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
					<span className="min-w-0 flex-1 truncate font-mono text-text-primary" title={conflict.path}>
						{conflict.path}
					</span>
				</button>
				{isResolving ? <Spinner size={14} /> : null}
				<Button
					variant="default"
					size="sm"
					disabled={isResolving}
					onClick={() => onResolve(conflict.path, "ours")}
				>
					Use ours
				</Button>
				<Button
					variant="default"
					size="sm"
					disabled={isResolving}
					onClick={() => onResolve(conflict.path, "theirs")}
				>
					Use theirs
				</Button>
			</div>

			{isExpanded ? (
				conflict.contentOmitted ? (
					<div className="flex items-start gap-2 border-t border-border px-2.5 py-3 text-[12px] text-text-secondary">
						<FileWarning size={14} className="mt-0.5 shrink-0 text-status-orange" aria-hidden />
						<span>
							{conflict.binary
								? "This file is binary, so there is no text to compare."
								: "This file is too large to load for editing."}{" "}
							Pick a whole side above, or resolve it in a terminal.
						</span>
					</div>
				) : (
					<div className="border-t border-border">
						<div className="grid grid-cols-2 border-b border-border bg-surface-1 text-[11px] text-text-secondary">
							<span className="border-r border-border px-2.5 py-1">{oursLabel}</span>
							<span className="px-2.5 py-1">{theirsLabel}</span>
						</div>
						<div className="max-h-[40vh] overflow-auto">
							<SplitDiffGrid
								displayItems={displayItems}
								renderSide={renderSide}
								expandHandlers={{ expandTop, expandBottom, expandAll }}
							/>
						</div>

						<div className="border-t border-border">
							<div className="flex items-center gap-2 bg-surface-1 px-2.5 py-1 text-[11px] text-text-secondary">
								<span className="flex-1">Merged result — edit, then save</span>
								{stillHasMarkers ? (
									<span className="text-status-orange">Conflict markers still present</span>
								) : null}
							</div>
							<textarea
								className="h-48 w-full resize-y bg-surface-2 px-2.5 py-2 font-mono text-[12px] text-text-primary outline-none focus:ring-1 focus:ring-border-focus"
								value={draft}
								spellCheck={false}
								onChange={(event) => {
									setHasEdited(true);
									setDraft(event.target.value);
								}}
								aria-label={`Merged contents of ${conflict.path}`}
							/>
							<div className="flex items-center justify-end gap-2 px-2.5 py-2">
								<Button
									variant="default"
									size="sm"
									disabled={isResolving || !hasEdited}
									onClick={() => {
										setHasEdited(false);
										setDraft(conflict.merged ?? "");
									}}
								>
									Reset
								</Button>
								<Button
									variant="primary"
									size="sm"
									icon={<Check size={14} />}
									disabled={isResolving}
									onClick={() => onResolve(conflict.path, "manual", draft)}
								>
									Save resolution
								</Button>
							</div>
						</div>
					</div>
				)
			) : null}
		</li>
	);
}
