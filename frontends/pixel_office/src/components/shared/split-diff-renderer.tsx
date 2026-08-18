import type { ReactElement } from "react";

import {
	CollapsedBlockControls,
	type DiffDisplayItem,
	type UnifiedDiffRow,
} from "@/components/shared/diff-renderer";

/**
 * Side-by-side layout over the unified rows `diff-renderer.tsx` produces.
 *
 * Only the *layout* lives here. What a row looks like, whether it can be
 * commented on and what a click does are all the call site's business — the task
 * diff viewer anchors comments by `(path, line, variant)` while the merge-request
 * reviewer anchors them by a GitLab diff position, and those two have no useful
 * common shape. So this module owns the grid, the pairing and the collapsed-block
 * rows, and takes a `renderSide` callback for everything else.
 */

export interface SplitDiffRowPair {
	key: string;
	left: UnifiedDiffRow | null;
	right: UnifiedDiffRow | null;
}

export type SplitDiffSide = "left" | "right";

/**
 * Turns the unified row sequence into left/right pairs.
 *
 * A removed run is paired positionally with the added run that immediately
 * follows it — the same positional pairing `enrichRowsWithInlineSegments` already
 * assumes when it computes word-level segments, so the highlighted intra-line
 * changes line up across the two columns instead of drifting apart. Whichever run
 * is longer leaves a blank gutter opposite its overflow.
 */
export function pairRowsForSplit(rows: UnifiedDiffRow[]): SplitDiffRowPair[] {
	const pairs: SplitDiffRowPair[] = [];
	let index = 0;
	while (index < rows.length) {
		const row = rows[index];
		if (!row) {
			index += 1;
			continue;
		}

		if (row.variant === "removed") {
			const removedStart = index;
			while (index < rows.length && rows[index]?.variant === "removed") {
				index += 1;
			}
			const removedBlock = rows.slice(removedStart, index);

			const addedStart = index;
			while (index < rows.length && rows[index]?.variant === "added") {
				index += 1;
			}
			const addedBlock = rows.slice(addedStart, index);

			const pairCount = Math.max(removedBlock.length, addedBlock.length);
			for (let pi = 0; pi < pairCount; pi += 1) {
				const left = removedBlock[pi] ?? null;
				const right = addedBlock[pi] ?? null;
				if (!left && !right) {
					continue;
				}
				const key = left
					? right
						? `pair-${left.key}-${right.key}`
						: `pair-left-${left.key}`
					: `pair-right-${right?.key ?? pi}`;
				pairs.push({ key, left, right });
			}
			continue;
		}

		if (row.variant === "added") {
			pairs.push({ key: `pair-right-${row.key}`, left: null, right: row });
			index += 1;
			continue;
		}

		// Context appears on both sides — the same row object, rendered twice.
		pairs.push({ key: `pair-context-${row.key}`, left: row, right: row });
		index += 1;
	}

	return pairs;
}

/**
 * Which column a row accepts a comment on. A deletion only exists on the left, an
 * addition only on the right, and an unchanged line is commentable on the right so
 * the note anchors to the post-image line the reviewer is actually reading.
 */
export function isCommentableOnSplitSide(row: UnifiedDiffRow, side: SplitDiffSide): boolean {
	if (row.variant === "removed") {
		return side === "left";
	}
	return side === "right";
}

export function SplitDiffPairRow({
	pair,
	renderSide,
}: {
	pair: SplitDiffRowPair;
	renderSide: (row: UnifiedDiffRow, side: SplitDiffSide) => ReactElement | null;
}): ReactElement {
	return (
		<div className="kb-diff-split-grid-row">
			<div
				className={`kb-diff-split-cell ${pair.left ? "kb-diff-split-cell-filled" : "kb-diff-split-cell-placeholder"}`}
			>
				{pair.left ? renderSide(pair.left, "left") : null}
			</div>
			<div
				className={`kb-diff-split-cell kb-diff-split-cell-right ${
					pair.right ? "kb-diff-split-cell-filled" : "kb-diff-split-cell-placeholder"
				}`}
			>
				{pair.right ? renderSide(pair.right, "right") : null}
			</div>
		</div>
	);
}

export interface SplitDiffExpandHandlers {
	expandTop: (id: string, count: number) => void;
	expandBottom: (id: string, count: number) => void;
	expandAll: (id: string) => void;
}

/**
 * The split grid: hatched background columns, then the paired rows.
 *
 * Consecutive plain rows are batched before pairing, because pairing has to see a
 * removed run and the added run after it together. A collapsed-context block
 * interrupts that batch — pairing across a hidden gap would align a deletion with
 * an addition that is nowhere near it.
 */
export function SplitDiffGrid({
	displayItems,
	renderSide,
	expandHandlers,
}: {
	displayItems: DiffDisplayItem[];
	renderSide: (row: UnifiedDiffRow, side: SplitDiffSide) => ReactElement | null;
	expandHandlers: SplitDiffExpandHandlers;
}): ReactElement {
	const renderPairs = (sourceRows: UnifiedDiffRow[]): ReactElement[] =>
		pairRowsForSplit(sourceRows).map((pair) => (
			<SplitDiffPairRow key={pair.key} pair={pair} renderSide={renderSide} />
		));

	const rendered: ReactElement[] = [];
	let pendingRows: UnifiedDiffRow[] = [];

	const flushPendingRows = (): void => {
		if (pendingRows.length === 0) {
			return;
		}
		rendered.push(...renderPairs(pendingRows));
		pendingRows = [];
	};

	for (const item of displayItems) {
		if (item.type === "row") {
			pendingRows.push(item.row);
			continue;
		}

		flushPendingRows();
		rendered.push(
			<div key={item.block.id}>
				{/* Both columns carry the control so the row reads as one full-width band. */}
				<div className="kb-diff-split-grid-row">
					<div className="kb-diff-split-cell kb-diff-split-cell-filled">
						<CollapsedBlockControls
							block={item.block}
							onExpandTop={expandHandlers.expandTop}
							onExpandBottom={expandHandlers.expandBottom}
							onExpandAll={expandHandlers.expandAll}
						/>
					</div>
					<div className="kb-diff-split-cell kb-diff-split-cell-filled kb-diff-split-cell-right">
						<CollapsedBlockControls
							block={item.block}
							onExpandTop={expandHandlers.expandTop}
							onExpandBottom={expandHandlers.expandBottom}
							onExpandAll={expandHandlers.expandAll}
						/>
					</div>
				</div>
				{item.block.expanded ? renderPairs(item.block.rows) : null}
			</div>,
		);
	}

	flushPendingRows();

	return (
		<div className="kb-diff-split-grid-shell">
			<div className="kb-diff-split-grid-backgrounds" aria-hidden>
				<div className="kb-diff-split-grid-background-column" />
				<div className="kb-diff-split-grid-background-column kb-diff-split-grid-background-column-right" />
			</div>
			<div className="kb-diff-split-grid-content">{rendered}</div>
		</div>
	);
}
