import { Droppable } from "@hello-pangea/dnd";
import { ChevronDown, ChevronRight, Link2, Link2Off, Play, Plus, Trash2 } from "lucide-react";
import { type MouseEvent as ReactMouseEvent, type ReactNode, useMemo, useState } from "react";

import { BoardCard } from "@/components/board-card";
import type { ReviewGitBranchedSubmit } from "@/components/board-card-review-git-actions";
import { ChainMemberList } from "@/components/chain-member-list";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ColumnIndicator } from "@/components/ui/column-indicator";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { computeChainGroups } from "@/state/chain-groups";
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
	onPauseTask,
	onResumeTask,
	onCancelAutoRun,
	onDeleteTask,
	onStartAllTasks,
	onClearTrash,
	editingTaskId,
	inlineTaskEditor,
	onEditTask,
	onSaveTitle,
	onCommitTask,
	onOpenPrTask,
	onSubmitReviewGit,
	onCancelReviewGitForm,
	onOpenReviewGitForm,
	onRetryReviewGitFollowOn,
	reviewGitStatusById,
	canRetryReviewGitFollowOnById,
	reviewBranchSuggestionsByTaskId,
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
	onRunChain,
	workspacePath,
	defaultClineModelId,
}: {
	column: BoardColumnModel;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onCreateTask?: () => void;
	onStartTask?: (taskId: string) => void;
	onPauseTask?: (taskId: string) => void;
	onResumeTask?: (taskId: string) => void;
	onCancelAutoRun?: (taskId: string) => void;
	onDeleteTask?: (taskId: string) => void;
	onStartAllTasks?: () => void;
	onClearTrash?: () => void;
	editingTaskId?: string | null;
	inlineTaskEditor?: ReactNode;
	onEditTask?: (card: BoardCardModel) => void;
	onSaveTitle?: (taskId: string, title: string) => void;
	onCommitTask?: (taskId: string) => void;
	onOpenPrTask?: (taskId: string) => void;
	onSubmitReviewGit?: (taskId: string, input: ReviewGitBranchedSubmit) => void;
	onCancelReviewGitForm?: (taskId: string) => void;
	onOpenReviewGitForm?: (taskId: string) => void;
	onRetryReviewGitFollowOn?: (taskId: string) => void;
	reviewGitStatusById?: Record<string, string>;
	canRetryReviewGitFollowOnById?: Record<string, boolean>;
	reviewBranchSuggestionsByTaskId?: Record<string, readonly string[]>;
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
	onRunChain?: (memberIds: string[]) => void;
	workspacePath?: string | null;
	defaultClineModelId?: string | null;
}): React.ReactElement {
	const canCreate = column.id === "backlog" && onCreateTask;
	const canStartAllTasks = column.id === "backlog" && onStartAllTasks;
	const canClearTrash = column.id === "trash" && onClearTrash;
	const cardDropType = "CARD";
	const supportsChainGroups = column.id === "backlog" || column.id === "in_progress";
	// Backlog: collapsible guardrail. In Progress: queue stack (live head + queued followers).
	const chainGrouping = useMemo(
		() => (supportsChainGroups ? computeChainGroups(column.cards, dependencies ?? []) : null),
		[supportsChainGroups, column.cards, dependencies],
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
								const renderCard = (
									card: BoardCardModel,
									index: number,
									options?: { suppressStart?: boolean },
								) => (
									<BoardCard
										key={card.id}
										card={card}
										index={index}
										columnId={column.id}
										sessionSummary={taskSessions[card.id]}
										onStart={options?.suppressStart ? undefined : onStartTask}
										onPause={onPauseTask}
										onResume={onResumeTask}
										onCancelAutoRun={onCancelAutoRun}
										onDelete={onDeleteTask}
										onMoveToTrash={onMoveToTrashTask}
										onRestoreFromTrash={onRestoreFromTrashTask}
										onCommit={onCommitTask}
										onOpenPr={onOpenPrTask}
										onSubmitReviewGit={onSubmitReviewGit}
										onCancelReviewGitForm={onCancelReviewGitForm}
										onOpenReviewGitForm={onOpenReviewGitForm}
										onRetryReviewGitFollowOn={onRetryReviewGitFollowOn}
										reviewGitStatusMessage={reviewGitStatusById?.[card.id] ?? null}
										canRetryReviewGitFollowOn={canRetryReviewGitFollowOnById?.[card.id] ?? false}
										branchSuggestions={reviewBranchSuggestionsByTaskId?.[card.id] ?? []}
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
								const renderQueuedChainRows = (memberIds: string[], startIndex: number) => (
									<ul className="kb-chain-member-list kb-chain-queue-list">
										{memberIds.map((memberId, index) => {
											const queuedCard = cardById.get(memberId);
											if (!queuedCard) {
												return null;
											}
											return (
												<li
													key={memberId}
													data-task-id={memberId}
													data-column-id={column.id}
													className={cn(
														"kb-chain-member-row kb-chain-queued-row",
														dependencyTargetTaskId === memberId && "kb-chain-follower-row-target",
													)}
													onMouseEnter={() => onDependencyPointerEnter?.(memberId)}
												>
													<span className="kb-chain-follower-order">{startIndex + index}</span>
													<button
														type="button"
														className="kb-chain-follower-title kb-chain-member-title-button"
														onClick={() => onCardClick?.(queuedCard)}
														title={queuedCard.title}
													>
														{queuedCard.title}
													</button>
													<span className="kb-chain-queued-badge">Queued</span>
												</li>
											);
										})}
									</ul>
								);
								for (const card of column.cards) {
									// Chain followers render inside their stack head's group, not here.
									if (chainGrouping?.rootIdByMemberId.has(card.id)) {
										continue;
									}
									const chainGroup = chainGrouping?.groupByRootId.get(card.id);
									if (chainGroup) {
										const isInProgressStack = column.id === "in_progress";
										const isExpanded = isInProgressStack
											? true
											: (expandedChainRootIds[card.id] ?? false);
										const followerCount = chainGroup.memberIdsInOrder.length - 1;
										const rootIsEditing = editingTaskId === card.id;
										const headHasSession = Boolean(taskSessions[card.id]);
										// Collapsed backlog shows the root as its full card. Expanded backlog
										// swaps to reorderable rows. In Progress always shows head card + queued rows.
										const rootRenderedAsCard =
											isInProgressStack || (!isExpanded && !rootIsEditing);
										const queuedMemberIds = chainGroup.memberIdsInOrder.slice(1);
										items.push(
											<div
												key={`chain-${chainGroup.rootId}-${card.id}`}
												className={cn("kb-chain-group", isInProgressStack && "kb-chain-group-stack")}
												data-chain-root-id={chainGroup.rootId}
												data-chain-stack-head-id={card.id}
												style={{ marginBottom: 6 }}
											>
												<div className="kb-chain-group-header-row">
													{isInProgressStack ? (
														<div
															className="kb-chain-group-header"
															title={`Chain stack — ${chainGroup.memberIdsInOrder.length} tasks in one shared worktree. Queued members start a new agent when the prior task is Done.`}
														>
															<Link2 size={12} />
															<span className="font-medium">Chain</span>
															<span className="kb-chain-group-count">
																{chainGroup.memberIdsInOrder.length}
															</span>
															<span className="text-text-tertiary text-xs">
																{followerCount} queued
															</span>
														</div>
													) : (
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
													)}
													{column.id === "backlog" && onRunChain ? (
														<button
															type="button"
															className="kb-chain-icon-button"
															title="Run chain — move all members to In Progress and start the first with a new agent"
															aria-label="Run chain"
															onClick={() => onRunChain(chainGroup.memberIdsInOrder)}
														>
															<Play size={13} />
														</button>
													) : null}
													{column.id === "backlog" && onBreakChain ? (
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
													{isInProgressStack ? (
														<>
															{renderCard(card, draggableIndex, {
																suppressStart: !headHasSession,
															})}
															{queuedMemberIds.length > 0
																? renderQueuedChainRows(queuedMemberIds, 2)
																: null}
														</>
													) : isExpanded ? (
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
