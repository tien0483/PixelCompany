// Render-index ↔ array-index translation for card drags.
//
// `@hello-pangea/dnd` requires every `<Draggable>` in a droppable to carry a contiguous
// 0..n-1 index, so a column that hides cards (chain followers folded into their stack
// head, a card swapped for an inline editor) numbers its draggables differently from the
// `column.cards` array behind them. `DropResult` therefore reports *render* indices, and
// consuming them as array indices splices the wrong card out of the column.
//
// Both the renderer and the state reducer go through this module so the two orderings
// cannot drift: `board-column.tsx` numbers its draggables from `computeDraggableCardOrder`,
// and `applyDragResult` resolves the drop slot with `resolveDropInsertIndex`.

import { computeChainGroups } from "@/state/chain-groups";
import type { BoardCard, BoardColumnId, BoardDependency } from "@/types";

/** Per-surface render rules. Each drag surface hides a different subset of the column. */
export interface DragRenderContext {
	/** Board columns fold chain followers into their stack head; the detail panel does not. */
	chainGroupingEnabled: boolean;
	/** Backlog swaps this card for the inline editor, so it is not draggable. */
	editingTaskId?: string | null;
	/** Backlog chain roots expanded into a reorderable member list are not draggable. */
	expandedChainRootIds?: Record<string, boolean>;
}

/** Columns whose cards are rendered as chain groups (mirrors `supportsChainGroups`). */
function supportsChainGroups(columnId: BoardColumnId): boolean {
	return columnId === "backlog" || columnId === "in_progress";
}

function resolveChainGrouping(
	columnId: BoardColumnId,
	cards: readonly BoardCard[],
	dependencies: readonly BoardDependency[],
	context: DragRenderContext,
): ReturnType<typeof computeChainGroups> | null {
	if (!context.chainGroupingEnabled || !supportsChainGroups(columnId)) {
		return null;
	}
	return computeChainGroups([...cards], [...dependencies]);
}

/**
 * Ids of the cards that render as `<Draggable>`s, in render order. The index of an id in
 * this array is exactly the `index` prop dnd sees, and hence the `source.index` /
 * `destination.index` it reports back.
 */
export function computeDraggableCardOrder(
	columnId: BoardColumnId,
	cards: readonly BoardCard[],
	dependencies: readonly BoardDependency[],
	context: DragRenderContext,
): string[] {
	const chainGrouping = resolveChainGrouping(columnId, cards, dependencies, context);
	const order: string[] = [];

	for (const card of cards) {
		// Chain followers render inside their stack head's group, not as their own card.
		if (chainGrouping?.rootIdByMemberId.has(card.id)) {
			continue;
		}
		const chainGroup = chainGrouping?.groupByRootId.get(card.id);
		if (chainGroup) {
			const isInProgressStack = columnId === "in_progress";
			const isExpanded = isInProgressStack ? true : (context.expandedChainRootIds?.[card.id] ?? false);
			const rootIsEditing = context.editingTaskId === card.id;
			// Collapsed backlog shows the root as its full card; expanded backlog swaps to
			// reorderable rows. In Progress always shows the head card plus queued rows.
			if (isInProgressStack || (!isExpanded && !rootIsEditing)) {
				order.push(card.id);
			}
			continue;
		}
		if (columnId === "backlog" && context.editingTaskId === card.id) {
			continue;
		}
		order.push(card.id);
	}

	return order;
}

/**
 * Array indices occupied by a draggable and everything that renders underneath it — for a
 * chain stack head, the head plus every follower folded into its group. Dropping below a
 * stack has to land below the whole stack, which is what the drop placeholder shows.
 */
function resolveBlockIndices(
	draggableId: string,
	indexByCardId: ReadonlyMap<string, number>,
	chainGrouping: ReturnType<typeof computeChainGroups> | null,
): number[] {
	const ownIndex = indexByCardId.get(draggableId);
	const indices = ownIndex === undefined ? [] : [ownIndex];
	const group = chainGrouping?.groupByRootId.get(draggableId);
	if (!group) {
		return indices;
	}
	for (const memberId of group.memberIdsInOrder) {
		const memberIndex = indexByCardId.get(memberId);
		if (memberIndex !== undefined) {
			indices.push(memberIndex);
		}
	}
	return indices;
}

export interface ResolveDropInsertIndexInput {
	columnId: BoardColumnId;
	/** The destination column's cards *before* the drop, including the moved card if same-column. */
	cards: readonly BoardCard[];
	dependencies: readonly BoardDependency[];
	movedCardId: string;
	/** `destination.index` from dnd — a position among draggables, not among cards. */
	renderIndex: number;
	context: DragRenderContext;
}

/**
 * Array index at which to splice the moved card into `cards.filter(c => c.id !== movedCardId)`.
 *
 * `renderIndex === k` means "the k-th draggable slot once the move settles", so the anchor
 * is the block of the (k-1)-th remaining draggable — insert after it — or the start of the
 * first remaining draggable's block when k is 0.
 */
export function resolveDropInsertIndex(input: ResolveDropInsertIndexInput): number {
	const { columnId, cards, dependencies, movedCardId, renderIndex, context } = input;

	const remainingCards = cards.filter((card) => card.id !== movedCardId);
	const chainGrouping = resolveChainGrouping(columnId, cards, dependencies, context);
	const indexByCardId = new Map<string, number>();
	remainingCards.forEach((card, index) => {
		indexByCardId.set(card.id, index);
	});

	const order = computeDraggableCardOrder(columnId, cards, dependencies, context).filter(
		(id) => id !== movedCardId,
	);
	if (order.length === 0) {
		return remainingCards.length;
	}

	const clamped = Math.min(Math.max(renderIndex, 0), order.length);

	if (clamped === 0) {
		const firstId = order[0];
		const blockIndices = firstId === undefined ? [] : resolveBlockIndices(firstId, indexByCardId, chainGrouping);
		return blockIndices.length === 0 ? 0 : Math.min(...blockIndices);
	}

	const previousId = order[clamped - 1];
	const blockIndices = previousId === undefined ? [] : resolveBlockIndices(previousId, indexByCardId, chainGrouping);
	if (blockIndices.length === 0) {
		return remainingCards.length;
	}
	return Math.min(Math.max(...blockIndices) + 1, remainingCards.length);
}
