import { Droppable } from "@hello-pangea/dnd";
import { ChevronDown, ChevronRight, Link2, Link2Off, Play, Plus, Trash2 } from "lucide-react";
import { type MouseEvent as ReactMouseEvent, type ReactNode, useMemo, useState } from "react";

import { BoardCard } from "@/components/board-card";
import { ChainMemberList } from "@/components/chain-member-list";
import { Button } from "@/components/ui/button";
import { ColumnIndicator } from "@/components/ui/column-indicator";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { computeBacklogChainGroups } from "@/state/chain-groups";
import { isCardDropDisabled, type ProgrammaticCardMoveInFlight } from "@/state/drag-rules";
import type {
	BoardCard as BoardCardModel,
	BoardColumnId,
	BoardColumn as BoardColumnModel,
	BoardDependency,
} from "@/types";

export function BoardColumn({
	column,
	taskSessions,
	onCreateTask,
	onStartTask,
	onDeleteTask,
	onStartAllTasks,
	onClearTrash,
	editingTaskId,
	inlineTaskEditor,
	onEditTask,
	onSaveTitle,
	onCommitTask,
	onOpenPrTask,
	onMergeTask,
	onCancelAutomaticTaskAction,
	onMoveToTrashTask,
	onRestoreFromTrashTask,
	commitTaskLoadingById,
	openPrTaskLoadingById,
	mergeTaskLoadingById,
	moveToTrashLoadingById,
	onCardClick,
	activeDragTaskId,
	activeDragSourceColumnId,
	programmaticCardMoveInFlight,
	onDependencyPointerDown,
	onDependencyPointerEnter,
	dependencySourceTaskId,
	dependencyTargetTaskId,
	isDependencyLinking,
	dependencies,
	onDeleteDependency,
	onReorderChain,
	onBreakChain,
	workspacePath,
	defaultClineModelId,
}: {
	column: BoardColumnModel;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onCreateTask?: () => void;
	onStartTask?: (taskId: string) => void;
	onDeleteTask?: (taskId: string) => void;
	onStartAllTasks?: () => void;
	onClearTrash?: () => void;
	editingTaskId?: string | null;
	inlineTaskEditor?: ReactNode;
	onEditTask?: (card: BoardCardModel) => void;
	onSaveTitle?: (taskId: string, title: string) => void;
	onCommitTask?: (taskId: string) => void;
	onOpenPrTask?: (taskId: string) => void;
	onMergeTask?: (taskId: string) => void;
	onCancelAutomaticTaskAction?: (taskId: string) => void;
	onMoveToTrashTask?: (taskId: string) => void;
	onRestoreFromTrashTask?: (taskId: string) => void;
	commitTaskLoadingById?: Record<string, boolean>;
	openPrTaskLoadingById?: Record<string, boolean>;
	mergeTaskLoadingById?: Record<string, boolean>;
	moveToTrashLoadingById?: Record<string, boolean>;
	onCardClick?: (card: BoardCardModel) => void;
	activeDragTaskId?: string | null;
	activeDragSourceColumnId?: BoardColumnId | null;
	programmaticCardMoveInFlight?: ProgrammaticCardMoveInFlight | null;
	onDependencyPointerDown?: (
		taskId: string,
		event: ReactMouseEvent<HTMLElement>,
		options?: { viaHandle?: boolean },
	) => void;
	onDependencyPointerEnter?: (taskId: string) => void;
	dependencySourceTaskId?: string | null;
	dependencyTargetTaskId?: string | null;
	isDependencyLinking?: boolean;
	dependencies?: BoardDependency[];
	onDeleteDependency?: (dependencyId: string) => void;
	onReorderChain?: (orderedMemberIds: string[]) => void;
	onBreakChain?: (memberIds: string[]) => void;
	workspacePath?: string | null;
	defaultClineModelId?: string | null;
}): React.ReactElement {
	const canCreate = column.id === "backlog" && onCreateTask;
	const canStartAllTasks = column.id === "backlog" && onStartAllTasks;
	const canClearTrash = column.id === "trash" && onClearTrash;
	const cardDropType = "CARD";
	// Backlog groups chained tasks (shared-worktree chains) into one collapsible guardrail.
	const chainGrouping = useMemo(
		() => (column.id === "backlog" ? computeBacklogChainGroups(column.cards, dependencies ?? []) : null),
		[column.id, column.cards, dependencies],
	);
	const cardById = useMemo(() => {
		const map = new Map<string, BoardCardModel>();
		for (const card of column.cards) {
			map.set(card.id, card);
		}
		return map;
	}, [column.cards]);
	// Chains default to collapsed (root + count badge); the user expands to see followers.
	const [expandedChainRootIds, setExpandedChainRootIds] = useState<Record<string, boolean>>({});
	const toggleChainExpanded = (rootId: string) =>
		setExpandedChainRootIds((current) => ({ ...current, [rootId]: !current[rootId] }));
	const isDropDisabled = isCardDropDisabled(column.id, activeDragSourceColumnId ?? null, {
		activeDragTaskId,
		programmaticCardMoveInFlight,
	});
	const createTaskButtonText = (
		<span className="inline-flex items-center gap-1.5">
			<span>Create task</span>
			<span aria-hidden className="text-text-secondary">
				(c)
			</span>
		</span>
	);

	return (
		<section
			data-column-id={column.id}
			className="flex flex-col min-w-0 min-h-0 bg-surface-1 rounded-lg overflow-hidden border border-border"
			style={{
				flex: "1 1 0",
			}}
		>
			<div className="flex flex-col min-h-0" style={{ flex: "1 1 0" }}>
				<div
					className="flex items-center justify-between"
					style={{
						height: 40,
						padding: "0 12px",
					}}
				>
					<div className="flex items-center gap-2">
						<ColumnIndicator columnId={column.id} />
						<span className="font-semibold text-sm">{column.title}</span>
						<span className="text-text-secondary text-xs">{column.cards.length}</span>
					</div>
					{canStartAllTasks ? (
						<Button
							icon={<Play size={14} />}
							variant="ghost"
							size="sm"
							onClick={onStartAllTasks}
							disabled={column.cards.length === 0}
							aria-label="Start all backlog tasks"
							title={column.cards.length > 0 ? "Start all backlog tasks" : "Backlog is empty"}
						/>
					) : null}
					{canClearTrash ? (
						<Button
							icon={<Trash2 size={14} />}
							variant="ghost"
							size="sm"
							className="text-status-red hover:text-status-red"
							onClick={onClearTrash}
							disabled={column.cards.length === 0}
							aria-label="Clear done"
							title={column.cards.length > 0 ? "Clear done items permanently" : "Done is empty"}
						/>
					) : null}
				</div>

				<Droppable droppableId={column.id} type={cardDropType} isDropDisabled={isDropDisabled}>
					{(cardProvided) => (
						<div ref={cardProvided.innerRef} {...cardProvided.droppableProps} className="kb-column-cards">
							{canCreate ? (
								<Button
									icon={<Plus size={14} />}
									aria-label="Create task"
									fill
									onClick={onCreateTask}
									style={{ marginBottom: 6, flexShrink: 0 }}
								>
									{createTaskButtonText}
								</Button>
							) : null}

							{(() => {
								const items: ReactNode[] = [];
								let draggableIndex = 0;
								const renderInlineEditor = (card: BoardCardModel) => (
									<div
										key={card.id}
										data-task-id={card.id}
										data-column-id={column.id}
										style={{ marginBottom: 6 }}
									>
										{inlineTaskEditor}
									</div>
								);
								const renderCard = (card: BoardCardModel, index: number) => (
									<BoardCard
										key={card.id}
										card={card}
										index={index}
										columnId={column.id}
										sessionSummary={taskSessions[card.id]}
										onStart={onStartTask}
										onDelete={onDeleteTask}
										onMoveToTrash={onMoveToTrashTask}
										onRestoreFromTrash={onRestoreFromTrashTask}
										onCommit={onCommitTask}
										onOpenPr={onOpenPrTask}
										onMerge={onMergeTask}
										onCancelAutomaticAction={onCancelAutomaticTaskAction}
										isCommitLoading={commitTaskLoadingById?.[card.id] ?? false}
										isOpenPrLoading={openPrTaskLoadingById?.[card.id] ?? false}
										isMergeLoading={mergeTaskLoadingById?.[card.id] ?? false}
										isMoveToTrashLoading={moveToTrashLoadingById?.[card.id] ?? false}
										onDependencyPointerDown={onDependencyPointerDown}
										onDependencyPointerEnter={onDependencyPointerEnter}
										isDependencySource={dependencySourceTaskId === card.id}
										isDependencyTarget={dependencyTargetTaskId === card.id}
										isDependencyLinking={isDependencyLinking}
										workspacePath={workspacePath}
										defaultClineModelId={defaultClineModelId}
										onSaveTitle={onSaveTitle}
										onClick={() => {
											if (column.id === "backlog") {
												onEditTask?.(card);
												return;
											}
											onCardClick?.(card);
										}}
									/>
								);
								for (const card of column.cards) {
									// Chain followers render inside their root's guardrail group, not here.
									if (chainGrouping?.rootIdByMemberId.has(card.id)) {
										continue;
									}
									const chainGroup = chainGrouping?.groupByRootId.get(card.id);
									if (chainGroup) {
										const isExpanded = expandedChainRootIds[card.id] ?? false;
										const followerCount = chainGroup.memberIdsInOrder.length - 1;
										const rootIsEditing = editingTaskId === card.id;
										// Collapsed shows the root as its full card (an rbd Draggable, so it can be
										// started or moved across columns). Expanded swaps to uniform reorderable
										// member rows — including the root — so any member can be dragged to any
										// position; only then does the root stop being a column Draggable.
										const rootRenderedAsCard = !isExpanded && !rootIsEditing;
										items.push(
											<div
												key={`chain-${card.id}`}
												className="kb-chain-group"
												data-chain-root-id={card.id}
												style={{ marginBottom: 6 }}
											>
												<div className="kb-chain-group-header-row">
													<button
														type="button"
														className="kb-chain-group-header"
														onClick={() => toggleChainExpanded(card.id)}
														aria-expanded={isExpanded}
														title={
															isExpanded
																? "Collapse chain — collapse to move the root across columns"
																: `Chain of ${chainGroup.memberIdsInOrder.length} tasks — runs in one shared worktree. Expand to reorder or unlink.`
														}
													>
														{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
														<Link2 size={12} />
														<span className="font-medium">Chain</span>
														<span className="kb-chain-group-count">
															{chainGroup.memberIdsInOrder.length}
														</span>
														{!isExpanded ? (
															<span className="text-text-tertiary text-xs">
																+{followerCount} after root
															</span>
														) : null}
													</button>
													{onBreakChain ? (
														<button
															type="button"
															className="kb-chain-icon-button kb-chain-break-button"
															title="Break chain — unlink all members"
															aria-label="Break chain"
															onClick={() => onBreakChain(chainGroup.memberIdsInOrder)}
														>
															<Link2Off size={13} />
														</button>
													) : null}
												</div>
												<div className="kb-chain-group-body">
													{isExpanded ? (
														<ChainMemberList
															memberIds={chainGroup.memberIdsInOrder}
															cardById={cardById}
															dependencies={dependencies ?? []}
															editingTaskId={editingTaskId}
															dependencyTargetTaskId={dependencyTargetTaskId}
															renderInlineEditor={renderInlineEditor}
															onEditTask={onEditTask}
															onDependencyPointerEnter={onDependencyPointerEnter}
															onDeleteDependency={onDeleteDependency}
															onReorderChain={onReorderChain}
														/>
													) : rootIsEditing ? (
														renderInlineEditor(card)
													) : (
														renderCard(card, draggableIndex)
													)}
												</div>
											</div>,
										);
										if (rootRenderedAsCard) {
											draggableIndex += 1;
										}
										continue;
									}
									if (column.id === "backlog" && editingTaskId === card.id) {
										items.push(renderInlineEditor(card));
										continue;
									}
									items.push(renderCard(card, draggableIndex));
									draggableIndex += 1;
								}
								return items;
							})()}
							{cardProvided.placeholder}
						</div>
					)}
				</Droppable>
			</div>
		</section>
	);
}
