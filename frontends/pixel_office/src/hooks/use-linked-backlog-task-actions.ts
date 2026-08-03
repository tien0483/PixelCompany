import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef } from "react";

import { showAppToast } from "@/components/app-toaster";
import { getDetailTerminalTaskId } from "@/hooks/use-terminal-panels";
import {
	addTaskDependency,
	breakChain,
	findCardSelection,
	getReadyLinkedTaskIdsAfterLeavingReview,
	hasLiveChainMemberSharingWorktree,
	moveTaskToColumn,
	removeTaskDependency,
	reorderChainMembers,
	resolveChainWorktreeOwnerTaskId,
	trashTaskAndGetReadyLinkedTaskIds,
} from "@/state/board-state";
import { trackTaskDependencyCreated, trackTasksAutoStartedFromDependency } from "@/telemetry/events";
import type { BoardCard, BoardColumnId, BoardData } from "@/types";
import { getNextDetailTaskIdAfterTrashMove } from "@/utils/detail-view-task-order";

interface RequestMoveTaskToTrashOptions {
	optimisticMoveApplied?: boolean;
	skipWorkingChangeWarning?: boolean;
}

export function useLinkedBacklogTaskActions({
	board,
	setBoard,
	setSelectedTaskId,
	stopTaskSession,
	cleanupTaskWorkspace,
	maybeRequestNotificationPermissionForTaskStart,
	kickoffTaskInProgress,
	startBacklogTaskWithAnimation,
	waitForBacklogStartAnimationAvailability,
}: {
	board: BoardData;
	setBoard: Dispatch<SetStateAction<BoardData>>;
	setSelectedTaskId: Dispatch<SetStateAction<string | null>>;
	stopTaskSession: (taskId: string) => Promise<void>;
	cleanupTaskWorkspace: (taskId: string) => Promise<unknown>;
	maybeRequestNotificationPermissionForTaskStart: () => void;
	kickoffTaskInProgress: (
		task: BoardCard,
		taskId: string,
		fromColumnId: BoardColumnId,
		options?: { optimisticMove?: boolean },
	) => Promise<boolean>;
	startBacklogTaskWithAnimation?: (task: BoardCard) => Promise<boolean>;
	waitForBacklogStartAnimationAvailability?: () => Promise<void>;
}): {
	handleCreateDependency: (fromTaskId: string, toTaskId: string) => void;
	handleDeleteDependency: (dependencyId: string) => void;
	handleReorderChain: (orderedMemberIds: string[]) => void;
	handleBreakChain: (memberIds: string[]) => void;
	confirmMoveTaskToTrash: (task: BoardCard, currentBoard?: BoardData) => Promise<void>;
	requestMoveTaskToTrash: (
		taskId: string,
		fromColumnId: BoardColumnId,
		options?: RequestMoveTaskToTrashOptions,
	) => Promise<void>;
} {
	const boardRef = useRef(board);

	useEffect(() => {
		boardRef.current = board;
	}, [board]);

	const handleCreateDependency = useCallback(
		(fromTaskId: string, toTaskId: string) => {
			const result = addTaskDependency(boardRef.current, fromTaskId, toTaskId);
			if (!result.added) {
				const message =
					result.reason === "same_task"
						? "A task cannot be linked to itself."
						: result.reason === "duplicate"
							? "Link already exists."
							: result.reason === "trash_task"
								? "Links cannot include done tasks."
								: result.reason === "non_backlog"
									? "Links must include at least one Backlog task."
									: result.reason === "chain_conflict"
										? "This task already chains onto another task."
										: "Could not create link.";
				showAppToast({
					intent: "warning",
					icon: "warning-sign",
					message,
					timeout: 3000,
				});
				return;
			}

			setBoard((currentBoard) => {
				const latestResult = addTaskDependency(currentBoard, fromTaskId, toTaskId);
				return latestResult.added ? latestResult.board : currentBoard;
			});
			trackTaskDependencyCreated();
		},
		[setBoard],
	);

	const handleDeleteDependency = useCallback(
		(dependencyId: string) => {
			setBoard((currentBoard) => {
				const removed = removeTaskDependency(currentBoard, dependencyId);
				return removed.removed ? removed.board : currentBoard;
			});
		},
		[setBoard],
	);

	const handleReorderChain = useCallback(
		(orderedMemberIds: string[]) => {
			setBoard((currentBoard) => {
				const reordered = reorderChainMembers(currentBoard, orderedMemberIds);
				return reordered.reordered ? reordered.board : currentBoard;
			});
		},
		[setBoard],
	);

	const handleBreakChain = useCallback(
		(memberIds: string[]) => {
			setBoard((currentBoard) => {
				const broken = breakChain(currentBoard, memberIds);
				return broken.removed ? broken.board : currentBoard;
			});
		},
		[setBoard],
	);

	const autoStartReadyLinkedTasks = useCallback(
		async (boardAfterTrash: BoardData, readyTaskIds: string[]): Promise<number> => {
			const readySelections = readyTaskIds
				.map((readyTaskId) => findCardSelection(boardAfterTrash, readyTaskId))
				.filter((selection): selection is NonNullable<typeof selection> => selection !== null);

			if (readySelections.length === 0) {
				return 0;
			}

			maybeRequestNotificationPermissionForTaskStart();
			let startedTaskCount = 0;

			// Queue-stack followers are already in In Progress; start a fresh agent in the
			// shared worktree without moving columns again.
			const queuedInProgress = readySelections.filter((selection) => selection.column.id === "in_progress");
			for (const selection of queuedInProgress) {
				const started = await kickoffTaskInProgress(selection.card, selection.card.id, "in_progress", {
					optimisticMove: false,
				});
				if (started) {
					startedTaskCount += 1;
				}
			}

			const backlogReady = readySelections
				.filter((selection) => selection.column.id === "backlog")
				.map((selection) => selection.card);
			if (backlogReady.length > 0) {
				if (startBacklogTaskWithAnimation) {
					const startedTaskPromises: Promise<boolean>[] = [];
					for (const [index, readyTask] of backlogReady.entries()) {
						startedTaskPromises.push(startBacklogTaskWithAnimation(readyTask));
						if (index < backlogReady.length - 1) {
							await waitForBacklogStartAnimationAvailability?.();
						}
					}
					const startedTasks = await Promise.all(startedTaskPromises);
					startedTaskCount += startedTasks.filter(Boolean).length;
				} else {
					setBoard((currentBoardState) => {
						let nextBoardState = currentBoardState;
						for (const readyTask of backlogReady) {
							const moved = moveTaskToColumn(nextBoardState, readyTask.id, "in_progress", {
								insertAtTop: true,
							});
							if (moved.moved) {
								nextBoardState = moved.board;
							}
						}
						return nextBoardState;
					});
					for (const readyTask of backlogReady) {
						const started = await kickoffTaskInProgress(readyTask, readyTask.id, "backlog", {
							optimisticMove: true,
						});
						if (started) {
							startedTaskCount += 1;
						}
					}
				}
			}
			return startedTaskCount;
		},
		[
			kickoffTaskInProgress,
			maybeRequestNotificationPermissionForTaskStart,
			setBoard,
			startBacklogTaskWithAnimation,
			waitForBacklogStartAnimationAvailability,
		],
	);

	const cleanupWorktreeAfterTrash = useCallback(
		async (boardAfterTrash: BoardData, taskId: string): Promise<void> => {
			// Chained tasks share one worktree keyed on the chain root. If a chain follower is
			// still live (it may have just auto-started above), hand the worktree off instead of
			// deleting it; only remove the root's worktree once no live chain member remains. For
			// standalone tasks the owner is the task itself, so this stays the original cleanup.
			const worktreeOwnerId = resolveChainWorktreeOwnerTaskId(boardAfterTrash, taskId);
			const worktreeStillInUse = hasLiveChainMemberSharingWorktree(boardAfterTrash, worktreeOwnerId, taskId);
			if (!worktreeStillInUse) {
				await cleanupTaskWorkspace(worktreeOwnerId);
			}
		},
		[cleanupTaskWorkspace],
	);

	const performMoveTaskToTrash = useCallback(
		async (
			task: BoardCard,
			currentBoard?: BoardData,
			options?: { fromColumnId?: BoardColumnId; optimisticMoveApplied?: boolean },
		): Promise<void> => {
			const boardBeforeTrash = currentBoard ?? boardRef.current;
			const fromColumnId = options?.fromColumnId;
			const trashed = trashTaskAndGetReadyLinkedTaskIds(boardBeforeTrash, task.id);

			// Optimistic drag/animation already put the card in Done: still unlock followers and
			// honor chain worktree handoff — never delete the shared worktree blindly.
			if (!trashed.moved) {
				const unlockFromColumnId = fromColumnId ?? "review";
				const readyTaskIds = getReadyLinkedTaskIdsAfterLeavingReview(
					boardBeforeTrash,
					task.id,
					unlockFromColumnId,
				);
				const startedTaskCount = await autoStartReadyLinkedTasks(boardBeforeTrash, readyTaskIds);
				if (startedTaskCount > 0) {
					trackTasksAutoStartedFromDependency(startedTaskCount);
				}
				await Promise.all([stopTaskSession(task.id), stopTaskSession(getDetailTerminalTaskId(task.id))]);
				await cleanupWorktreeAfterTrash(boardBeforeTrash, task.id);
				return;
			}

			setBoard((currentBoardState) => {
				const latestTrashResult = trashTaskAndGetReadyLinkedTaskIds(currentBoardState, task.id);
				return latestTrashResult.moved ? latestTrashResult.board : currentBoardState;
			});
			setSelectedTaskId((currentSelectedTaskId) =>
				currentSelectedTaskId === task.id
					? getNextDetailTaskIdAfterTrashMove(boardBeforeTrash, task.id)
					: currentSelectedTaskId,
			);

			const startedTaskCount = await autoStartReadyLinkedTasks(trashed.board, trashed.readyTaskIds);
			if (startedTaskCount > 0) {
				trackTasksAutoStartedFromDependency(startedTaskCount);
			}

			await Promise.all([stopTaskSession(task.id), stopTaskSession(getDetailTerminalTaskId(task.id))]);
			// Prefer the post-trash snapshot used for unlock over a raced boardRef update.
			await cleanupWorktreeAfterTrash(trashed.board, task.id);
		},
		[
			autoStartReadyLinkedTasks,
			cleanupWorktreeAfterTrash,
			setBoard,
			setSelectedTaskId,
			stopTaskSession,
		],
	);

	const requestMoveTaskToTrash = useCallback(
		async (taskId: string, fromColumnId: BoardColumnId, options?: RequestMoveTaskToTrashOptions): Promise<void> => {
			const boardSnapshot = boardRef.current;
			const selection = findCardSelection(boardSnapshot, taskId);
			if (!selection) {
				return;
			}

			const moveSelectionIfOptimisticMoveIsConfirmed = () => {
				if (!options?.optimisticMoveApplied) {
					return;
				}
				setSelectedTaskId((currentSelectedTaskId) =>
					currentSelectedTaskId === taskId
						? getNextDetailTaskIdAfterTrashMove(boardSnapshot, taskId)
						: currentSelectedTaskId,
				);
			};

			moveSelectionIfOptimisticMoveIsConfirmed();
			await performMoveTaskToTrash(selection.card, boardSnapshot, {
				fromColumnId,
				optimisticMoveApplied: options?.optimisticMoveApplied,
			});
		},
		[performMoveTaskToTrash, setSelectedTaskId],
	);

	return {
		handleCreateDependency,
		handleDeleteDependency,
		handleReorderChain,
		handleBreakChain,
		confirmMoveTaskToTrash: async (task: BoardCard, currentBoard?: BoardData) => {
			await performMoveTaskToTrash(task, currentBoard);
		},
		requestMoveTaskToTrash,
	};
}
