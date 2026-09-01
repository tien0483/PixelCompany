import { deriveTaskTitleFromPrompt } from "@runtime-task-title";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { TASK_START_IN_PLAN_MODE_STORAGE_KEY } from "@/hooks/app-utils";
import type {
	RuntimeAgentId,
	RuntimeSeatPreset,
	RuntimeTaskClineSettings,
	RuntimeTaskLaunchSettings,
	RuntimeTaskWorkspaceInfoResponse,
} from "@/runtime/types";
import {
	addTaskToColumnWithResult,
	findCardSelection,
	setTaskManagerAccount,
	setTaskSeatPreset,
	updateTask,
	updateTaskTitle,
} from "@/state/board-state";
import { isTaskInChain } from "@/state/chain-groups";
import { toTelemetrySelectedAgentId, trackTaskCreated } from "@/telemetry/events";
import type { BoardCard, BoardData, TaskAutoReviewMode, TaskImage } from "@/types";
import { resolveTaskAutoReviewMode } from "@/types";
import { useBooleanLocalStorageValue } from "@/utils/react-use";

interface UseTaskEditorInput {
	board: BoardData;
	setBoard: Dispatch<SetStateAction<BoardData>>;
	currentProjectId: string | null;
	createTaskBranchOptions: Array<{ value: string; label: string }>;
	defaultTaskBranchRef: string;
	selectedAgentId: RuntimeAgentId | null;
	/** Kanban settings default; seeds a new Claude task's subagent seat when no explicit pin exists. */
	defaultSubagentSeatProviderId?: string | null;
	setSelectedTaskId: Dispatch<SetStateAction<string | null>>;
	queueTaskStartAfterEdit?: (taskId: string) => void;
	fetchTaskWorkspaceInfo?: (
		task: BoardCard,
	) => Promise<RuntimeTaskWorkspaceInfoResponse | null>;
}

interface OpenEditTaskOptions {
	preserveDetailSelection?: boolean;
}

interface CreateTaskOptions {
	keepDialogOpen?: boolean;
}

export interface UseTaskEditorResult {
	isInlineTaskCreateOpen: boolean;
	newTaskPrompt: string;
	setNewTaskPrompt: Dispatch<SetStateAction<string>>;
	newTaskImages: TaskImage[];
	setNewTaskImages: Dispatch<SetStateAction<TaskImage[]>>;
	newTaskStartInPlanMode: boolean;
	setNewTaskStartInPlanMode: Dispatch<SetStateAction<boolean>>;
	/** Absolute path of the attached plan file, or null for none. */
	newTaskPlanFilePath: string | null;
	setNewTaskPlanFilePath: Dispatch<SetStateAction<string | null>>;
	/** Minutes until the new backlog card auto-starts; 0 = off (start manually). */
	newTaskAutoRunDelayMinutes: number;
	setNewTaskAutoRunDelayMinutes: Dispatch<SetStateAction<number>>;
	isNewTaskStartInPlanModeDisabled: boolean;
	newTaskBranchRef: string;
	setNewTaskBranchRef: Dispatch<SetStateAction<string>>;
	newTaskAgentId: RuntimeAgentId | undefined;
	setNewTaskAgentId: Dispatch<SetStateAction<RuntimeAgentId | undefined>>;
	newTaskClineSettings: RuntimeTaskClineSettings | undefined;
	setNewTaskClineSettings: Dispatch<SetStateAction<RuntimeTaskClineSettings | undefined>>;
	newTaskLaunchSettings: RuntimeTaskLaunchSettings | undefined;
	setNewTaskLaunchSettings: Dispatch<SetStateAction<RuntimeTaskLaunchSettings | undefined>>;
	/** Explicit Manager seat pin for the new task; undefined means Auto. */
	newTaskManagerAccountId: number | undefined;
	setNewTaskManagerAccountId: Dispatch<SetStateAction<number | undefined>>;
	/** Seat resolution mode for the new task; mutually exclusive with the pin above. */
	newTaskSeatPreset: RuntimeSeatPreset | undefined;
	setNewTaskSeatPreset: Dispatch<SetStateAction<RuntimeSeatPreset | undefined>>;
	editingTaskId: string | null;
	editTaskPrompt: string;
	setEditTaskPrompt: Dispatch<SetStateAction<string>>;
	editTaskImages: TaskImage[];
	setEditTaskImages: Dispatch<SetStateAction<TaskImage[]>>;
	editTaskStartInPlanMode: boolean;
	setEditTaskStartInPlanMode: Dispatch<SetStateAction<boolean>>;
	editTaskPlanFilePath: string | null;
	setEditTaskPlanFilePath: Dispatch<SetStateAction<string | null>>;
	editTaskAutoReviewEnabled: boolean;
	setEditTaskAutoReviewEnabled: Dispatch<SetStateAction<boolean>>;
	editTaskAutoReviewMode: TaskAutoReviewMode;
	setEditTaskAutoReviewMode: Dispatch<SetStateAction<TaskAutoReviewMode>>;
	isEditTaskStartInPlanModeDisabled: boolean;
	editTaskBranchRef: string;
	setEditTaskBranchRef: Dispatch<SetStateAction<string>>;
	isEditTaskBaseRefLocked: boolean;
	editTaskAgentId: RuntimeAgentId | undefined;
	setEditTaskAgentId: Dispatch<SetStateAction<RuntimeAgentId | undefined>>;
	editTaskClineSettings: RuntimeTaskClineSettings | undefined;
	setEditTaskClineSettings: Dispatch<SetStateAction<RuntimeTaskClineSettings | undefined>>;
	editTaskLaunchSettings: RuntimeTaskLaunchSettings | undefined;
	setEditTaskLaunchSettings: Dispatch<SetStateAction<RuntimeTaskLaunchSettings | undefined>>;
	/** Explicit Manager seat pin for the edited task; undefined means Auto. */
	editTaskManagerAccountId: number | undefined;
	setEditTaskManagerAccountId: Dispatch<SetStateAction<number | undefined>>;
	editTaskSeatPreset: RuntimeSeatPreset | undefined;
	setEditTaskSeatPreset: Dispatch<SetStateAction<RuntimeSeatPreset | undefined>>;
	/** Minutes until the edited backlog card auto-starts; 0 = off. Seeded from its remaining countdown. */
	editTaskAutoRunDelayMinutes: number;
	setEditTaskAutoRunDelayMinutes: Dispatch<SetStateAction<number>>;
	editTaskAutoResumeOnUsageLimit: boolean;
	setEditTaskAutoResumeOnUsageLimit: Dispatch<SetStateAction<boolean>>;
	handleOpenCreateTask: () => void;
	handleCancelCreateTask: () => void;
	handleOpenEditTask: (task: BoardCard, options?: OpenEditTaskOptions) => void;
	handleCancelEditTask: () => void;
	handleSaveEditedTask: () => string | null;
	handleSaveAndStartEditedTask: () => void;
	handleSaveTaskTitle: (taskId: string, title: string) => void;
	handleCreateTask: (options?: CreateTaskOptions) => string | null;
	handleCreateTasks: (prompts: string[], options?: CreateTaskOptions) => string[];
	resetTaskEditorState: () => void;
}

/**
 * Turns a card's absolute `autoRunAt` back into the "auto-run after N min" the editor
 * shows. A countdown that already elapsed reads as 0 (off) rather than a negative delay.
 */
function autoRunDelayMinutesFrom(autoRunAt: number | null | undefined): number {
	if (autoRunAt == null) {
		return 0;
	}
	return Math.max(0, Math.ceil((autoRunAt - Date.now()) / 60_000));
}

export function useTaskEditor({
	board,
	setBoard,
	currentProjectId,
	createTaskBranchOptions,
	defaultTaskBranchRef,
	selectedAgentId,
	defaultSubagentSeatProviderId,
	setSelectedTaskId,
	queueTaskStartAfterEdit,
	fetchTaskWorkspaceInfo,
}: UseTaskEditorInput): UseTaskEditorResult {
	const [isInlineTaskCreateOpen, setIsInlineTaskCreateOpen] = useState(false);
	const [newTaskPrompt, setNewTaskPrompt] = useState("");
	const [newTaskImages, setNewTaskImages] = useState<TaskImage[]>([]);
	const [newTaskStartInPlanMode, setNewTaskStartInPlanMode] = useBooleanLocalStorageValue(
		TASK_START_IN_PLAN_MODE_STORAGE_KEY,
		false,
	);
	const [newTaskPlanFilePath, setNewTaskPlanFilePath] = useState<string | null>(null);
	const [newTaskAutoRunDelayMinutes, setNewTaskAutoRunDelayMinutes] = useState(0);
	const isNewTaskStartInPlanModeDisabled = false;
	const [newTaskBranchRef, setNewTaskBranchRef] = useState("");
	const [lastCreatedTaskBranchByProjectId, setLastCreatedTaskBranchByProjectId] = useState<Record<string, string>>({});
	const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
	const [editTaskPrompt, setEditTaskPrompt] = useState("");
	const [editTaskImages, setEditTaskImages] = useState<TaskImage[]>([]);
	const [editTaskStartInPlanMode, setEditTaskStartInPlanMode] = useState(false);
	const [editTaskPlanFilePath, setEditTaskPlanFilePath] = useState<string | null>(null);
	const [editTaskAutoReviewEnabled, setEditTaskAutoReviewEnabled] = useState(false);
	const [editTaskAutoReviewMode, setEditTaskAutoReviewMode] = useState<TaskAutoReviewMode>("commit");
	const isEditTaskStartInPlanModeDisabled = false;
	const [editTaskBranchRef, setEditTaskBranchRef] = useState("");
	const [isEditTaskBaseRefLocked, setIsEditTaskBaseRefLocked] = useState(false);

	const [newTaskAgentId, setNewTaskAgentId] = useState<RuntimeAgentId | undefined>(undefined);
	const [newTaskClineSettings, setNewTaskClineSettings] = useState<RuntimeTaskClineSettings | undefined>(undefined);
	const [newTaskLaunchSettings, setNewTaskLaunchSettings] = useState<RuntimeTaskLaunchSettings | undefined>(undefined);
	const [newTaskManagerAccountId, setNewTaskManagerAccountId] = useState<number | undefined>(undefined);
	const [newTaskSeatPreset, setNewTaskSeatPreset] = useState<RuntimeSeatPreset | undefined>(undefined);
	const [editTaskAgentId, setEditTaskAgentId] = useState<RuntimeAgentId | undefined>(undefined);
	const [editTaskClineSettings, setEditTaskClineSettings] = useState<RuntimeTaskClineSettings | undefined>(undefined);
	const [editTaskLaunchSettings, setEditTaskLaunchSettings] = useState<RuntimeTaskLaunchSettings | undefined>(
		undefined,
	);
	const [editTaskManagerAccountId, setEditTaskManagerAccountId] = useState<number | undefined>(undefined);
	const [editTaskSeatPreset, setEditTaskSeatPreset] = useState<RuntimeSeatPreset | undefined>(undefined);
	const [editTaskAutoRunDelayMinutes, setEditTaskAutoRunDelayMinutes] = useState(0);
	const [editTaskAutoResumeOnUsageLimit, setEditTaskAutoResumeOnUsageLimit] = useState(false);

	const lastCreatedTaskBranchRef = useMemo(() => {
		if (!currentProjectId) {
			return null;
		}
		return lastCreatedTaskBranchByProjectId[currentProjectId] ?? null;
	}, [currentProjectId, lastCreatedTaskBranchByProjectId]);

	const resolvedDefaultTaskBranchRef = useMemo(() => {
		if (
			lastCreatedTaskBranchRef &&
			createTaskBranchOptions.some((option) => option.value === lastCreatedTaskBranchRef)
		) {
			return lastCreatedTaskBranchRef;
		}
		return defaultTaskBranchRef;
	}, [createTaskBranchOptions, defaultTaskBranchRef, lastCreatedTaskBranchRef]);

	useEffect(() => {
		const isCurrentValid = createTaskBranchOptions.some((option) => option.value === newTaskBranchRef);
		if (isCurrentValid) {
			return;
		}
		setNewTaskBranchRef(resolvedDefaultTaskBranchRef);
	}, [createTaskBranchOptions, newTaskBranchRef, resolvedDefaultTaskBranchRef]);

	useEffect(() => {
		if (!isInlineTaskCreateOpen) {
			return;
		}
		if (!newTaskBranchRef) {
			setNewTaskBranchRef(resolvedDefaultTaskBranchRef);
		}
	}, [isInlineTaskCreateOpen, newTaskBranchRef, resolvedDefaultTaskBranchRef]);

	useEffect(() => {
		if (!isNewTaskStartInPlanModeDisabled || !newTaskStartInPlanMode) {
			return;
		}
		setNewTaskStartInPlanMode(false);
	}, [isNewTaskStartInPlanModeDisabled, newTaskStartInPlanMode, setNewTaskStartInPlanMode]);

	useEffect(() => {
		if (!isEditTaskStartInPlanModeDisabled || !editTaskStartInPlanMode) {
			return;
		}
		setEditTaskStartInPlanMode(false);
	}, [editTaskStartInPlanMode, isEditTaskStartInPlanModeDisabled]);

	useEffect(() => {
		if (!editingTaskId) {
			return;
		}
		// Never clobber a non-empty edit base ref just because it's momentarily absent
		// from branch options (that used to silently drift the stored base ref).
		if (editTaskBranchRef.trim()) {
			return;
		}
		setEditTaskBranchRef(resolvedDefaultTaskBranchRef);
	}, [createTaskBranchOptions, editTaskBranchRef, editingTaskId, resolvedDefaultTaskBranchRef]);

	useEffect(() => {
		if (!editingTaskId) {
			return;
		}
		const selection = findCardSelection(board, editingTaskId);
		if (!selection || selection.column.id !== "backlog") {
			setEditingTaskId(null);

			setEditTaskPrompt("");
			setEditTaskStartInPlanMode(false);
			setEditTaskAutoReviewEnabled(false);
			setEditTaskAutoReviewMode("commit");
			setEditTaskImages([]);
			setEditTaskBranchRef("");
		}
	}, [board, editingTaskId]);

	const handleOpenCreateTask = useCallback(() => {
		setEditingTaskId(null);
		setEditTaskPrompt("");
		setEditTaskImages([]);

		setNewTaskAgentId(undefined);
		setNewTaskClineSettings(undefined);
		// A new Claude task without an explicit pin bills its subagents to the
		// Settings-configured default seat; other agents don't support the split.
		setNewTaskLaunchSettings(
			selectedAgentId === "claude" && defaultSubagentSeatProviderId
				? { subagentSeatProviderId: defaultSubagentSeatProviderId }
				: undefined,
		);
		setNewTaskManagerAccountId(undefined);
		setNewTaskSeatPreset(undefined);
		setIsInlineTaskCreateOpen(true);
	}, [defaultSubagentSeatProviderId, selectedAgentId]);

	const handleCancelCreateTask = useCallback(() => {
		setIsInlineTaskCreateOpen(false);

		setNewTaskPrompt("");
		setNewTaskImages([]);
		setNewTaskBranchRef(resolvedDefaultTaskBranchRef);
		setNewTaskAgentId(undefined);
		setNewTaskClineSettings(undefined);
		setNewTaskLaunchSettings(undefined);
		setNewTaskManagerAccountId(undefined);
		setNewTaskSeatPreset(undefined);
		setNewTaskPlanFilePath(null);
	}, [resolvedDefaultTaskBranchRef]);

	const handleOpenEditTask = useCallback(
		(task: BoardCard, options?: OpenEditTaskOptions) => {
			if (!options?.preserveDetailSelection) {
				setSelectedTaskId(null);
			}
			setIsInlineTaskCreateOpen(false);

			setNewTaskPrompt("");
			setNewTaskImages([]);
			const taskPrompt = task.prompt.trim();
			setEditingTaskId(task.id);

			setEditTaskPrompt(taskPrompt);
			setEditTaskImages(task.images ? task.images.map((image) => ({ ...image })) : []);
			setEditTaskStartInPlanMode(task.startInPlanMode);
			setEditTaskPlanFilePath(task.planFilePath?.trim() ? task.planFilePath.trim() : null);
			setEditTaskAutoReviewEnabled(task.autoReviewEnabled === true);
			setEditTaskAutoReviewMode(resolveTaskAutoReviewMode(task.autoReviewMode));
			const fallbackBranch = task.baseRef || resolvedDefaultTaskBranchRef;
			setEditTaskBranchRef(fallbackBranch);
			setIsEditTaskBaseRefLocked(false);
			setEditTaskAgentId(task.agentId);
			setEditTaskClineSettings(task.clineSettings);
			setEditTaskLaunchSettings(task.taskLaunchSettings);
			setEditTaskManagerAccountId(task.managerAccountId);
			setEditTaskSeatPreset(task.seatPreset);
			setEditTaskAutoRunDelayMinutes(autoRunDelayMinutesFrom(task.autoRunAt));
			setEditTaskAutoResumeOnUsageLimit(task.autoResumeOnUsageLimit === true);

			if (fetchTaskWorkspaceInfo) {
				void fetchTaskWorkspaceInfo(task).then((info) => {
					if (!info || info.taskId !== task.id) {
						return;
					}
					if (info.baseRef.trim()) {
						setEditTaskBranchRef(info.baseRef);
					}
					// A worktree can exist while its recorded base ref is unusable (a floating
					// `HEAD` written by an older runtime), and locking the picker on such a ref
					// leaves the task with a base nothing can merge into.
					setIsEditTaskBaseRefLocked(info.exists === true && info.baseRefLocked !== false);
				});
			}
		},
		[fetchTaskWorkspaceInfo, resolvedDefaultTaskBranchRef, setSelectedTaskId],
	);

	const handleCancelEditTask = useCallback(() => {
		setEditingTaskId(null);

		setEditTaskPrompt("");
		setEditTaskStartInPlanMode(false);
		setEditTaskPlanFilePath(null);
		setEditTaskAutoReviewEnabled(false);
		setEditTaskAutoReviewMode("commit");
		setEditTaskImages([]);
		setEditTaskBranchRef("");
		setIsEditTaskBaseRefLocked(false);
		setEditTaskManagerAccountId(undefined);
		setEditTaskSeatPreset(undefined);
		setEditTaskAutoRunDelayMinutes(0);
		setEditTaskAutoResumeOnUsageLimit(false);
	}, []);

	const handleSaveEditedTask = useCallback((): string | null => {
		if (!editingTaskId) {
			return null;
		}
		const prompt = editTaskPrompt.trim();
		if (!prompt) {
			return null;
		}
		// No fallback to the default branch here: the field is seeded asynchronously from
		// the server (and is locked once a worktree exists), so defaulting would re-target
		// a started task at whatever the home repo currently has checked out. An empty
		// value means "keep what the card already has" — `updateTask` preserves it.
		const baseRef = editTaskBranchRef.trim();
		const savedTaskId = editingTaskId;

		setBoard((currentBoard) => {
			const currentCard = currentBoard.columns.flatMap((c) => c.cards).find((c) => c.id === savedTaskId);
			const title = currentCard?.title ?? "";
			const inChain = isTaskInChain(currentBoard.dependencies, savedTaskId);
			const autoReviewEnabled = inChain && editTaskAutoReviewEnabled;
			const updated = updateTask(currentBoard, savedTaskId, {
				title,
				prompt,
				startInPlanMode: editTaskStartInPlanMode,
				planFilePath: editTaskPlanFilePath,
				autoReviewEnabled,
				autoReviewMode: autoReviewEnabled ? "commit" : resolveTaskAutoReviewMode(editTaskAutoReviewMode),
				images: editTaskImages,
				agentId: editTaskAgentId,
				clineSettings: editTaskClineSettings,
				taskLaunchSettings: editTaskLaunchSettings,
				autoRunAt: editTaskAutoRunDelayMinutes > 0 ? Date.now() + editTaskAutoRunDelayMinutes * 60_000 : null,
				autoResumeOnUsageLimit: editTaskAutoResumeOnUsageLimit,
				baseRef,
			});
			if (!updated.updated) {
				return currentBoard;
			}
			// After updateTask, never before: it drops a cross-provider seat pin when the
			// task switches agent family, and that clearing must win over the editor's
			// stale value — so only re-apply a pin the updated card still allows.
			const clearedCrossProviderPin =
				currentCard?.managerAccountId !== undefined &&
				findCardSelection(updated.board, savedTaskId)?.card.managerAccountId === undefined;
			// A preset and a pin are the same field: apply whichever the editor holds, and let
			// the cross-provider clearing above win over both.
			const savedPreset = clearedCrossProviderPin ? undefined : editTaskSeatPreset;
			if (savedPreset !== undefined) {
				return setTaskSeatPreset(updated.board, savedTaskId, savedPreset).board;
			}
			return setTaskManagerAccount(
				updated.board,
				savedTaskId,
				clearedCrossProviderPin ? null : (editTaskManagerAccountId ?? null),
			).board;
		});
		setEditingTaskId(null);

		setEditTaskPrompt("");
		setEditTaskStartInPlanMode(false);
		setEditTaskPlanFilePath(null);
		setEditTaskAutoReviewEnabled(false);
		setEditTaskAutoReviewMode("commit");
		setEditTaskImages([]);
		setEditTaskBranchRef("");
		setEditTaskAgentId(undefined);
		setEditTaskClineSettings(undefined);
		setEditTaskLaunchSettings(undefined);
		setEditTaskManagerAccountId(undefined);
		setEditTaskSeatPreset(undefined);
		setEditTaskAutoRunDelayMinutes(0);
		setEditTaskAutoResumeOnUsageLimit(false);
		return savedTaskId;
	}, [
		editTaskAgentId,
		editTaskAutoResumeOnUsageLimit,
		editTaskAutoReviewEnabled,
		editTaskAutoReviewMode,
		editTaskAutoRunDelayMinutes,
		editTaskBranchRef,
		editTaskClineSettings,
		editTaskLaunchSettings,
		editTaskManagerAccountId,
		editTaskSeatPreset,
		editTaskPrompt,
		editTaskImages,
		editTaskPlanFilePath,
		editTaskStartInPlanMode,
		editingTaskId,
		setBoard,
	]);

	const handleSaveAndStartEditedTask = useCallback(() => {
		const taskId = handleSaveEditedTask();
		if (!taskId) {
			return;
		}
		queueTaskStartAfterEdit?.(taskId);
	}, [handleSaveEditedTask, queueTaskStartAfterEdit]);

	const handleSaveTaskTitle = useCallback(
		(taskId: string, title: string) => {
			setBoard((currentBoard) => {
				const updated = updateTaskTitle(currentBoard, taskId, title);
				return updated.updated ? updated.board : currentBoard;
			});
		},
		[setBoard],
	);

	const handleCreateTask = useCallback(
		(options?: CreateTaskOptions): string | null => {
			const prompt = newTaskPrompt.trim();
			if (!prompt) {
				return null;
			}
			if (!(newTaskBranchRef || resolvedDefaultTaskBranchRef)) {
				return null;
			}
			const baseRef = newTaskBranchRef || resolvedDefaultTaskBranchRef;
			const title = deriveTaskTitleFromPrompt(prompt);
			const created = addTaskToColumnWithResult(board, "backlog", {
				title,
				prompt,
				startInPlanMode: newTaskStartInPlanMode,
				...(newTaskPlanFilePath ? { planFilePath: newTaskPlanFilePath } : {}),
				autoReviewEnabled: false,
				autoReviewMode: "commit",
				images: newTaskImages,
				// Stamp the effective agent onto the card so launches do not silently
				// fall back to Claude when Settings still points at the old default.
				agentId: newTaskAgentId ?? selectedAgentId ?? undefined,
				...(newTaskSeatPreset !== undefined ? { seatPreset: newTaskSeatPreset } : {}),
				...(typeof newTaskManagerAccountId === "number"
					? { managerAccountId: newTaskManagerAccountId }
					: {}),
				clineSettings: newTaskClineSettings,
				taskLaunchSettings: newTaskLaunchSettings,
				autoRunAt: newTaskAutoRunDelayMinutes > 0 ? Date.now() + newTaskAutoRunDelayMinutes * 60_000 : undefined,
				baseRef,
			});
			setBoard(created.board);
			trackTaskCreated({
				selected_agent_id: toTelemetrySelectedAgentId(newTaskAgentId ?? selectedAgentId),
				start_in_plan_mode: newTaskStartInPlanMode,
				prompt_character_count: prompt.length,
			});
			if (currentProjectId) {
				setLastCreatedTaskBranchByProjectId((current) => ({
					...current,
					[currentProjectId]: baseRef,
				}));
			}

			setNewTaskPrompt("");
			setNewTaskImages([]);
			setNewTaskBranchRef(baseRef);
			setNewTaskAgentId(undefined);
			setNewTaskClineSettings(undefined);
			setNewTaskLaunchSettings(undefined);
			setNewTaskManagerAccountId(undefined);
			setNewTaskSeatPreset(undefined);
			setNewTaskPlanFilePath(null);
			setNewTaskAutoRunDelayMinutes(0);
			if (!options?.keepDialogOpen) {
				setIsInlineTaskCreateOpen(false);
			}
			return created.task.id;
		},
		[
			board,
			currentProjectId,
			newTaskAgentId,
			newTaskAutoRunDelayMinutes,
			setNewTaskAutoRunDelayMinutes,
			newTaskBranchRef,
			newTaskClineSettings,
			newTaskLaunchSettings,
			newTaskManagerAccountId,
			newTaskSeatPreset,
			newTaskImages,
			newTaskPlanFilePath,
			newTaskPrompt,
			newTaskStartInPlanMode,
			resolvedDefaultTaskBranchRef,
			selectedAgentId,
			setBoard,
			setNewTaskAgentId,
			setNewTaskClineSettings,
		],
	);

	const handleCreateTasks = useCallback(
		(prompts: string[], options?: CreateTaskOptions): string[] => {
			const validPrompts = prompts.map((p) => p.trim()).filter(Boolean);
			if (validPrompts.length === 0) {
				return [];
			}
			if (!(newTaskBranchRef || resolvedDefaultTaskBranchRef)) {
				return [];
			}
			const baseRef = newTaskBranchRef || resolvedDefaultTaskBranchRef;
			const autoRunAt = newTaskAutoRunDelayMinutes > 0 ? Date.now() + newTaskAutoRunDelayMinutes * 60_000 : undefined;
			const createdTaskIds: string[] = [];
			let updatedBoard = board;
			for (const prompt of validPrompts) {
				const created = addTaskToColumnWithResult(updatedBoard, "backlog", {
					prompt,
					startInPlanMode: newTaskStartInPlanMode,
					...(newTaskPlanFilePath ? { planFilePath: newTaskPlanFilePath } : {}),
					autoReviewEnabled: false,
					autoReviewMode: "commit",
					images: newTaskImages,
					agentId: newTaskAgentId ?? selectedAgentId ?? undefined,
					...(newTaskSeatPreset !== undefined ? { seatPreset: newTaskSeatPreset } : {}),
					...(typeof newTaskManagerAccountId === "number"
						? { managerAccountId: newTaskManagerAccountId }
						: {}),
					clineSettings: newTaskClineSettings,
					taskLaunchSettings: newTaskLaunchSettings,
					autoRunAt,
					baseRef,
				});
				updatedBoard = created.board;
				createdTaskIds.push(created.task.id);
			}
			setBoard(updatedBoard);
			for (const prompt of validPrompts) {
				trackTaskCreated({
					selected_agent_id: toTelemetrySelectedAgentId(newTaskAgentId ?? selectedAgentId),
					start_in_plan_mode: newTaskStartInPlanMode,
					prompt_character_count: prompt.length,
				});
			}
			if (currentProjectId) {
				setLastCreatedTaskBranchByProjectId((current) => ({
					...current,
					[currentProjectId]: baseRef,
				}));
			}

			setNewTaskPrompt("");
			setNewTaskImages([]);
			setNewTaskBranchRef(baseRef);
			setNewTaskAgentId(undefined);
			setNewTaskClineSettings(undefined);
			setNewTaskLaunchSettings(undefined);
			setNewTaskManagerAccountId(undefined);
			setNewTaskSeatPreset(undefined);
			setNewTaskPlanFilePath(null);
			setNewTaskAutoRunDelayMinutes(0);
			if (!options?.keepDialogOpen) {
				setIsInlineTaskCreateOpen(false);
			}
			return createdTaskIds;
		},
		[
			board,
			currentProjectId,
			newTaskAgentId,
			newTaskAutoRunDelayMinutes,
			setNewTaskAutoRunDelayMinutes,
			newTaskBranchRef,
			newTaskClineSettings,
			newTaskLaunchSettings,
			newTaskManagerAccountId,
			newTaskSeatPreset,
			newTaskImages,
			newTaskPlanFilePath,
			newTaskStartInPlanMode,
			resolvedDefaultTaskBranchRef,
			selectedAgentId,
			setBoard,
			setNewTaskAgentId,
			setNewTaskClineSettings,
		],
	);

	const resetTaskEditorState = useCallback(() => {
		setIsInlineTaskCreateOpen(false);
		setEditingTaskId(null);

		setNewTaskPrompt("");

		setEditTaskPrompt("");
		setEditTaskStartInPlanMode(false);
		setEditTaskPlanFilePath(null);
		setEditTaskAutoReviewEnabled(false);
		setEditTaskAutoReviewMode("commit");
		setEditTaskImages([]);
		setEditTaskBranchRef("");
		setIsEditTaskBaseRefLocked(false);
		setEditTaskAgentId(undefined);
		setEditTaskClineSettings(undefined);
		setEditTaskLaunchSettings(undefined);
		setNewTaskImages([]);
		setNewTaskAgentId(undefined);
		setNewTaskClineSettings(undefined);
		setNewTaskLaunchSettings(undefined);
		setNewTaskManagerAccountId(undefined);
		setNewTaskSeatPreset(undefined);
		setNewTaskPlanFilePath(null);
	}, []);

	return {
		isInlineTaskCreateOpen,
		newTaskPrompt,
		setNewTaskPrompt,
		newTaskImages,
		setNewTaskImages,
		newTaskStartInPlanMode,
		setNewTaskStartInPlanMode,
		newTaskPlanFilePath,
		setNewTaskPlanFilePath,
		newTaskAutoRunDelayMinutes,
		setNewTaskAutoRunDelayMinutes,
		isNewTaskStartInPlanModeDisabled,
		newTaskBranchRef,
		setNewTaskBranchRef,
		newTaskAgentId,
		setNewTaskAgentId,
		newTaskClineSettings,
		setNewTaskClineSettings,
		newTaskLaunchSettings,
		setNewTaskLaunchSettings,
		newTaskManagerAccountId,
		setNewTaskManagerAccountId,
		newTaskSeatPreset,
		setNewTaskSeatPreset,
		editingTaskId,
		editTaskPrompt,
		setEditTaskPrompt,
		editTaskImages,
		setEditTaskImages,
		editTaskStartInPlanMode,
		setEditTaskStartInPlanMode,
		editTaskPlanFilePath,
		setEditTaskPlanFilePath,
		editTaskAutoReviewEnabled,
		setEditTaskAutoReviewEnabled,
		editTaskAutoReviewMode,
		setEditTaskAutoReviewMode,
		isEditTaskStartInPlanModeDisabled,
		editTaskBranchRef,
		setEditTaskBranchRef,
		isEditTaskBaseRefLocked,
		editTaskAgentId,
		setEditTaskAgentId,
		editTaskClineSettings,
		setEditTaskClineSettings,
		editTaskLaunchSettings,
		setEditTaskLaunchSettings,
		editTaskManagerAccountId,
		setEditTaskManagerAccountId,
		editTaskSeatPreset,
		setEditTaskSeatPreset,
		editTaskAutoRunDelayMinutes,
		setEditTaskAutoRunDelayMinutes,
		editTaskAutoResumeOnUsageLimit,
		setEditTaskAutoResumeOnUsageLimit,
		handleOpenCreateTask,
		handleCancelCreateTask,
		handleOpenEditTask,
		handleCancelEditTask,
		handleSaveEditedTask,
		handleSaveAndStartEditedTask,
		handleSaveTaskTitle,
		handleCreateTask,
		handleCreateTasks,
		resetTaskEditorState,
	};
}
