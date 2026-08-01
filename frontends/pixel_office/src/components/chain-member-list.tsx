import { GripVertical, Unlink } from "lucide-react";
import { type DragEvent as ReactDragEvent, type ReactNode, useMemo, useState } from "react";

import { cn } from "@/components/ui/cn";
import type { BoardCard as BoardCardModel, BoardDependency } from "@/types";

/**
 * The expanded body of a Backlog chain guardrail: every member (root first, then followers)
 * rendered as a uniform, reorderable row. Reordering uses native HTML5 drag-and-drop rather
 * than react-beautiful-dnd — the board already lives inside one global DragDropContext, and
 * rbd forbids nested contexts/droppables, so the chain body cannot host its own rbd list.
 *
 * Dropping a member at a new position rewrites the whole chain via `onReorderChain`; the first
 * member becomes the chain root / shared-worktree owner.
 */
export function ChainMemberList({
	memberIds,
	cardById,
	dependencies,
	editingTaskId,
	dependencyTargetTaskId,
	renderInlineEditor,
	onEditTask,
	onDependencyPointerEnter,
	onDeleteDependency,
	onReorderChain,
}: {
	/** Chain members in run order, root first. */
	memberIds: string[];
	cardById: Map<string, BoardCardModel>;
	dependencies: BoardDependency[];
	editingTaskId?: string | null;
	dependencyTargetTaskId?: string | null;
	renderInlineEditor: (card: BoardCardModel) => ReactNode;
	onEditTask?: (card: BoardCardModel) => void;
	onDependencyPointerEnter?: (taskId: string) => void;
	onDeleteDependency?: (dependencyId: string) => void;
	onReorderChain?: (orderedMemberIds: string[]) => void;
}): ReactNode {
	const [draggingId, setDraggingId] = useState<string | null>(null);
	const [overId, setOverId] = useState<string | null>(null);

	// A follower's incoming chain edge (fromTaskId === member) is the link that removes it from
	// the chain. The root has no such edge, so it shows no unlink control.
	const chainDependencyIdByFollowerId = useMemo(() => {
		const map = new Map<string, string>();
		for (const dependency of dependencies) {
			if (dependency.chain === true) {
				map.set(dependency.fromTaskId, dependency.id);
			}
		}
		return map;
	}, [dependencies]);

	const commitReorder = (fromId: string, toId: string) => {
		if (!onReorderChain || fromId === toId) {
			return;
		}
		const order = [...memberIds];
		const fromIndex = order.indexOf(fromId);
		const toIndex = order.indexOf(toId);
		if (fromIndex < 0 || toIndex < 0) {
			return;
		}
		order.splice(fromIndex, 1);
		order.splice(toIndex, 0, fromId);
		if (order.some((id, index) => id !== memberIds[index])) {
			onReorderChain(order);
		}
	};

	const handleDragStart = (memberId: string) => (event: ReactDragEvent<HTMLElement>) => {
		setDraggingId(memberId);
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData("text/plain", memberId);
	};
	const handleDragOver = (memberId: string) => (event: ReactDragEvent<HTMLElement>) => {
		if (!draggingId) {
			return;
		}
		event.preventDefault();
		event.dataTransfer.dropEffect = "move";
		if (overId !== memberId) {
			setOverId(memberId);
		}
	};
	const handleDrop = (memberId: string) => (event: ReactDragEvent<HTMLElement>) => {
		event.preventDefault();
		if (draggingId) {
			commitReorder(draggingId, memberId);
		}
		setDraggingId(null);
		setOverId(null);
	};
	const handleDragEnd = () => {
		setDraggingId(null);
		setOverId(null);
	};

	return (
		<ul className="kb-chain-member-list">
			{memberIds.map((memberId, index) => {
				const card = cardById.get(memberId);
				if (!card) {
					return null;
				}
				if (editingTaskId === memberId) {
					return <li key={memberId}>{renderInlineEditor(card)}</li>;
				}
				const dependencyId = chainDependencyIdByFollowerId.get(memberId);
				return (
					<li
						key={memberId}
						data-task-id={memberId}
						data-column-id="backlog"
						draggable
						onDragStart={handleDragStart(memberId)}
						onDragOver={handleDragOver(memberId)}
						onDrop={handleDrop(memberId)}
						onDragEnd={handleDragEnd}
						onMouseEnter={() => onDependencyPointerEnter?.(memberId)}
						className={cn(
							"kb-chain-member-row",
							draggingId === memberId && "kb-chain-member-row-dragging",
							overId === memberId && draggingId !== memberId && "kb-chain-member-row-over",
							dependencyTargetTaskId === memberId && "kb-chain-follower-row-target",
						)}
					>
						<span className="kb-chain-member-grip" aria-hidden>
							<GripVertical size={14} />
						</span>
						<span className="kb-chain-follower-order">{index + 1}</span>
						<button
							type="button"
							className="kb-chain-follower-title kb-chain-member-title-button"
							onClick={() => onEditTask?.(card)}
							title={card.title}
						>
							{card.title}
						</button>
						{dependencyId && onDeleteDependency ? (
							<button
								type="button"
								className="kb-chain-icon-button"
								title="Remove from chain"
								aria-label={`Remove ${card.title} from chain`}
								onClick={(event) => {
									event.stopPropagation();
									onDeleteDependency(dependencyId);
								}}
							>
								<Unlink size={13} />
							</button>
						) : null}
					</li>
				);
			})}
		</ul>
	);
}
