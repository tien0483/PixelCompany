import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTaskEditor } from "@/hooks/use-task-editor";
import type {
	RuntimeAgentId,
	RuntimeTaskClineSettings,
	RuntimeTaskLaunchSettings,
	RuntimeTaskWorkspaceInfoResponse,
} from "@/runtime/types";
import { addTaskDependency } from "@/state/board-state";
import type { BoardCard, BoardData, TaskAutoReviewMode, TaskImage } from "@/types";

function createTask(taskId: string, prompt: string, createdAt: number, overrides: Partial<BoardCard> = {}): BoardCard {
	return {
		id: taskId,
		title: prompt,
		prompt,
		startInPlanMode: false,
		autoReviewEnabled: false,
		autoReviewMode: "commit",
		baseRef: "main",
		createdAt,
		updatedAt: createdAt,
		...overrides,
	};
}

function createBoard(tasks: BoardCard[] = []): BoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: tasks },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Done", cards: [] },
		],
		dependencies: [],
	};
}

interface HookSnapshot {
	board: BoardData;
	isInlineTaskCreateOpen: boolean;
	newTaskPrompt: string;
	newTaskImages: TaskImage[];
	newTaskBranchRef: string;
	newTaskAgentId: RuntimeAgentId | undefined;
	newTaskClineSettings: RuntimeTaskClineSettings | undefined;
	newTaskManagerAccountId: number | undefined;
	editingTaskId: string | null;
	editTaskPrompt: string;
	editTaskBranchRef: string;
	isEditTaskBaseRefLocked: boolean;
	editTaskStartInPlanMode: boolean;
	isEditTaskStartInPlanModeDisabled: boolean;
	handleOpenCreateTask: () => void;
	handleCreateTask: (options?: { keepDialogOpen?: boolean }) => string | null;
	handleCreateTasks: (prompts: string[], options?: { keepDialogOpen?: boolean }) => string[];
	setNewTaskPrompt: (value: string) => void;
	setNewTaskImages: (value: TaskImage[]) => void;
	handleOpenEditTask: (task: BoardCard) => void;
	handleSaveEditedTask: () => string | null;
	handleSaveAndStartEditedTask: () => void;
	setEditTaskPrompt: (value: string) => void;
	setEditTaskBranchRef: (value: string) => void;
	setEditTaskAutoReviewEnabled: (value: boolean) => void;
	setEditTaskAutoReviewMode: (value: TaskAutoReviewMode) => void;
	setNewTaskAgentId: (value: RuntimeAgentId | undefined) => void;
	setNewTaskClineSettings: (value: RuntimeTaskClineSettings | undefined) => void;
	setNewTaskManagerAccountId: (value: number | undefined) => void;
	editTaskManagerAccountId: number | undefined;
	setEditTaskManagerAccountId: (value: number | undefined) => void;
	editTaskLaunchSettings: RuntimeTaskLaunchSettings | undefined;
	setEditTaskLaunchSettings: (value: RuntimeTaskLaunchSettings | undefined) => void;
	editTaskAutoRunDelayMinutes: number;
	setEditTaskAutoRunDelayMinutes: (value: number) => void;
	editTaskAutoResumeOnUsageLimit: boolean;
	setEditTaskAutoResumeOnUsageLimit: (value: boolean) => void;
}

function requireSnapshot(snapshot: HookSnapshot | null): HookSnapshot {
	if (!snapshot) {
		throw new Error("Expected a hook snapshot.");
	}
	return snapshot;
}

function HookHarness({
	initialBoard,
	onSnapshot,
	queueTaskStartAfterEdit,
	createTaskBranchOptions = [{ value: "main", label: "main" }],
	defaultTaskBranchRef = "main",
	fetchTaskWorkspaceInfo,
}: {
	initialBoard: BoardData;
	onSnapshot: (snapshot: HookSnapshot) => void;
	queueTaskStartAfterEdit?: (taskId: string) => void;
	createTaskBranchOptions?: Array<{ value: string; label: string }>;
	defaultTaskBranchRef?: string;
	fetchTaskWorkspaceInfo?: (task: BoardCard) => Promise<RuntimeTaskWorkspaceInfoResponse | null>;
}): null {
	const [board, setBoard] = useState<BoardData>(initialBoard);
	const [, setSelectedTaskId] = useState<string | null>(null);
	const editor = useTaskEditor({
		board,
		setBoard,
		currentProjectId: "project-1",
		createTaskBranchOptions,
		defaultTaskBranchRef,
		selectedAgentId: null,
		setSelectedTaskId,
		queueTaskStartAfterEdit,
		fetchTaskWorkspaceInfo,
	});

	useEffect(() => {
		onSnapshot({
			board,
			isInlineTaskCreateOpen: editor.isInlineTaskCreateOpen,
			newTaskPrompt: editor.newTaskPrompt,
			newTaskImages: editor.newTaskImages,
			newTaskBranchRef: editor.newTaskBranchRef,
			newTaskAgentId: editor.newTaskAgentId,
			newTaskClineSettings: editor.newTaskClineSettings,
			newTaskManagerAccountId: editor.newTaskManagerAccountId,
			editingTaskId: editor.editingTaskId,
			editTaskPrompt: editor.editTaskPrompt,
			editTaskBranchRef: editor.editTaskBranchRef,
			isEditTaskBaseRefLocked: editor.isEditTaskBaseRefLocked,
			editTaskStartInPlanMode: editor.editTaskStartInPlanMode,
			isEditTaskStartInPlanModeDisabled: editor.isEditTaskStartInPlanModeDisabled,
			handleOpenCreateTask: editor.handleOpenCreateTask,
			handleCreateTask: editor.handleCreateTask,
			handleCreateTasks: editor.handleCreateTasks,
			setNewTaskPrompt: editor.setNewTaskPrompt,
			setNewTaskImages: editor.setNewTaskImages,
			handleOpenEditTask: editor.handleOpenEditTask,
			handleSaveEditedTask: editor.handleSaveEditedTask,
			handleSaveAndStartEditedTask: editor.handleSaveAndStartEditedTask,
			setEditTaskPrompt: editor.setEditTaskPrompt,
			setEditTaskBranchRef: editor.setEditTaskBranchRef,
			setEditTaskAutoReviewEnabled: editor.setEditTaskAutoReviewEnabled,
			setEditTaskAutoReviewMode: editor.setEditTaskAutoReviewMode,
			setNewTaskAgentId: editor.setNewTaskAgentId,
			setNewTaskClineSettings: editor.setNewTaskClineSettings,
			setNewTaskManagerAccountId: editor.setNewTaskManagerAccountId,
			editTaskManagerAccountId: editor.editTaskManagerAccountId,
			setEditTaskManagerAccountId: editor.setEditTaskManagerAccountId,
			editTaskLaunchSettings: editor.editTaskLaunchSettings,
			setEditTaskLaunchSettings: editor.setEditTaskLaunchSettings,
			editTaskAutoRunDelayMinutes: editor.editTaskAutoRunDelayMinutes,
			setEditTaskAutoRunDelayMinutes: editor.setEditTaskAutoRunDelayMinutes,
			editTaskAutoResumeOnUsageLimit: editor.editTaskAutoResumeOnUsageLimit,
			setEditTaskAutoResumeOnUsageLimit: editor.setEditTaskAutoResumeOnUsageLimit,
		});
	}, [
		board,
		editor.handleCreateTask,
		editor.handleCreateTasks,
		editor.handleOpenCreateTask,
		editor.editTaskPrompt,
		editor.editTaskBranchRef,
		editor.isEditTaskBaseRefLocked,
		editor.editTaskStartInPlanMode,
		editor.editingTaskId,
		editor.handleOpenEditTask,
		editor.handleSaveEditedTask,
		editor.handleSaveAndStartEditedTask,
		editor.isEditTaskStartInPlanModeDisabled,
		editor.isInlineTaskCreateOpen,
		editor.newTaskPrompt,
		editor.newTaskImages,
		editor.newTaskBranchRef,
		editor.newTaskAgentId,
		editor.newTaskClineSettings,
		editor.newTaskManagerAccountId,
		editor.setEditTaskAutoReviewEnabled,
		editor.setEditTaskAutoReviewMode,
		editor.setEditTaskPrompt,
		editor.setEditTaskBranchRef,
		editor.setNewTaskImages,
		editor.setNewTaskPrompt,
		editor.editTaskManagerAccountId,
		editor.editTaskLaunchSettings,
		editor.editTaskAutoRunDelayMinutes,
		editor.editTaskAutoResumeOnUsageLimit,
		onSnapshot,
	]);

	return null;
}

describe("useTaskEditor", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		localStorage.clear();
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
		localStorage.clear();
	});

	it("returns the edited task id when saving a task", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const initialBoard = createBoard([createTask("task-1", "Initial prompt", 1)]);

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={initialBoard}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		const initialSnapshot = requireSnapshot(latestSnapshot);
		const task = initialSnapshot.board.columns[0]?.cards[0];
		if (!task) {
			throw new Error("Expected a backlog task.");
		}

		await act(async () => {
			initialSnapshot.handleOpenEditTask(task);
		});

		requireSnapshot(latestSnapshot);

		await act(async () => {
			latestSnapshot?.setEditTaskPrompt("Updated prompt");
		});

		let savedTaskId: string | null = null;
		await act(async () => {
			savedTaskId = latestSnapshot?.handleSaveEditedTask() ?? null;
		});

		expect(savedTaskId).toBe("task-1");
		expect(requireSnapshot(latestSnapshot).editingTaskId).toBeNull();
		expect(requireSnapshot(latestSnapshot).board.columns[0]?.cards[0]?.prompt).toBe("Updated prompt");
	});

	it("does not disable start in plan mode when auto review is enabled while editing", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const initialBoard = createBoard([
			createTask("task-1", "Initial prompt", 1, {
				startInPlanMode: true,
			}),
		]);

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={initialBoard}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		const initialSnapshot = requireSnapshot(latestSnapshot);
		const task = initialSnapshot.board.columns[0]?.cards[0];
		if (!task) {
			throw new Error("Expected a backlog task.");
		}

		await act(async () => {
			initialSnapshot.handleOpenEditTask(task);
		});

		await act(async () => {
			latestSnapshot?.setEditTaskAutoReviewEnabled(true);
			latestSnapshot?.setEditTaskAutoReviewMode("commit");
		});

		expect(requireSnapshot(latestSnapshot).isEditTaskStartInPlanModeDisabled).toBe(false);
	});

	it("keeps the stored baseRef when branch options do not include it", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const initialBoard = createBoard([
			createTask("task-1", "Initial prompt", 1, {
				baseRef: "release/1.0",
			}),
		]);

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={initialBoard}
					createTaskBranchOptions={[{ value: "main", label: "main" }]}
					defaultTaskBranchRef="main"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		const initialSnapshot = requireSnapshot(latestSnapshot);
		const task = initialSnapshot.board.columns[0]?.cards[0];
		if (!task) {
			throw new Error("Expected a backlog task.");
		}

		await act(async () => {
			initialSnapshot.handleOpenEditTask(task);
		});

		expect(requireSnapshot(latestSnapshot).editTaskBranchRef).toBe("release/1.0");
	});

	it("saves the worktree's locked base ref for a started task, not a branch option", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		// The card's stored ref drifted to "main"; the worktree was really created from
		// "release/1.0", which is what the runtime reports back as locked.
		const initialBoard = createBoard([createTask("task-1", "Initial prompt", 1, { baseRef: "main" })]);
		const fetchTaskWorkspaceInfo = vi.fn(async () => ({
			taskId: "task-1",
			path: "/worktrees/task-1",
			exists: true,
			baseRef: "release/1.0",
			baseRefLocked: true,
			branch: "kanban/task-1",
			isDetached: false,
			headCommit: "abc123",
		}));

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={initialBoard}
					createTaskBranchOptions={[{ value: "main", label: "main" }]}
					defaultTaskBranchRef="main"
					fetchTaskWorkspaceInfo={fetchTaskWorkspaceInfo}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		const initialSnapshot = requireSnapshot(latestSnapshot);
		const task = initialSnapshot.board.columns[0]?.cards[0];
		if (!task) {
			throw new Error("Expected a backlog task.");
		}

		await act(async () => {
			initialSnapshot.handleOpenEditTask(task);
		});

		expect(requireSnapshot(latestSnapshot).editTaskBranchRef).toBe("release/1.0");
		expect(requireSnapshot(latestSnapshot).isEditTaskBaseRefLocked).toBe(true);

		await act(async () => {
			latestSnapshot?.handleSaveEditedTask();
		});

		expect(requireSnapshot(latestSnapshot).board.columns[0]?.cards[0]?.baseRef).toBe("release/1.0");
	});

	it("keeps the card's base ref when the editor has no branch value to save", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const initialBoard = createBoard([createTask("task-1", "Initial prompt", 1, { baseRef: "release/1.0" })]);

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={initialBoard}
					createTaskBranchOptions={[]}
					defaultTaskBranchRef=""
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		const initialSnapshot = requireSnapshot(latestSnapshot);
		const task = initialSnapshot.board.columns[0]?.cards[0];
		if (!task) {
			throw new Error("Expected a backlog task.");
		}

		await act(async () => {
			initialSnapshot.handleOpenEditTask(task);
		});
		await act(async () => {
			latestSnapshot?.setEditTaskPrompt("Updated prompt");
		});
		// An empty branch field must never fall back to the home repo's current branch.
		await act(async () => {
			latestSnapshot?.setEditTaskBranchRef("");
		});

		let savedTaskId: string | null = null;
		await act(async () => {
			savedTaskId = latestSnapshot?.handleSaveEditedTask() ?? null;
		});

		expect(savedTaskId).toBe("task-1");
		const savedCard = requireSnapshot(latestSnapshot).board.columns[0]?.cards[0];
		expect(savedCard?.baseRef).toBe("release/1.0");
		expect(savedCard?.prompt).toBe("Updated prompt");
	});

	it("queues the saved task id when saving and starting an edited task", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const queueTaskStartAfterEdit = vi.fn();
		const initialBoard = createBoard([createTask("task-1", "Initial prompt", 1)]);

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={initialBoard}
					queueTaskStartAfterEdit={queueTaskStartAfterEdit}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		const initialSnapshot = requireSnapshot(latestSnapshot);
		const task = initialSnapshot.board.columns[0]?.cards[0];
		if (!task) {
			throw new Error("Expected a backlog task.");
		}

		await act(async () => {
			initialSnapshot.handleOpenEditTask(task);
		});

		await act(async () => {
			latestSnapshot?.setEditTaskPrompt("Updated prompt");
		});

		await act(async () => {
			latestSnapshot?.handleSaveAndStartEditedTask();
		});

		expect(queueTaskStartAfterEdit).toHaveBeenCalledWith("task-1");
		expect(requireSnapshot(latestSnapshot).board.columns[0]?.cards[0]?.prompt).toBe("Updated prompt");
	});

	it("keeps the create dialog open when requested after creating a task", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={createBoard()}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).handleOpenCreateTask();
		});

		await act(async () => {});

		await act(async () => {
			requireSnapshot(latestSnapshot).setNewTaskPrompt("Create another task");
		});
		await act(async () => {
			requireSnapshot(latestSnapshot).setNewTaskAgentId("codex");
			requireSnapshot(latestSnapshot).setNewTaskClineSettings({
				providerId: "provider-abc",
				modelId: "model-xyz",
				reasoningEffort: "low",
			});
		});

		await act(async () => {});
		expect(requireSnapshot(latestSnapshot).newTaskPrompt).toBe("Create another task");
		expect(requireSnapshot(latestSnapshot).newTaskBranchRef).toBe("main");

		let createdTaskId: string | null = null;
		await act(async () => {
			createdTaskId = requireSnapshot(latestSnapshot).handleCreateTask({ keepDialogOpen: true });
		});

		const snapshot = requireSnapshot(latestSnapshot);
		expect(createdTaskId).toBeTruthy();
		expect(snapshot.isInlineTaskCreateOpen).toBe(true);
		expect(snapshot.newTaskPrompt).toBe("");
		expect(snapshot.newTaskBranchRef).toBe("main");
		expect(snapshot.newTaskAgentId).toBeUndefined();
		expect(snapshot.newTaskClineSettings).toBeUndefined();
		expect(snapshot.board.columns[0]?.cards.some((card) => card.prompt === "Create another task")).toBe(true);
	});
	it("copies attached images to each split task and clears the draft images", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={createBoard()}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).handleOpenCreateTask();
		});

		await act(async () => {
			latestSnapshot?.setNewTaskImages([
				{
					id: "img-1",
					data: "abc123",
					mimeType: "image/png",
				},
			]);
		});

		let createdTaskIds: string[] = [];
		await act(async () => {
			createdTaskIds = latestSnapshot?.handleCreateTasks(["First task", "Second task"]) ?? [];
		});

		expect(createdTaskIds).toHaveLength(2);
		const backlogCards = requireSnapshot(latestSnapshot).board.columns[0]?.cards ?? [];
		expect(backlogCards).toHaveLength(2);
		expect(backlogCards.map((card) => card.images)).toEqual([
			[
				{
					id: "img-1",
					data: "abc123",
					mimeType: "image/png",
				},
			],
			[
				{
					id: "img-1",
					data: "abc123",
					mimeType: "image/png",
				},
			],
		]);
		expect(requireSnapshot(latestSnapshot).newTaskImages).toEqual([]);
	});

	it("persists reasoning-only task overrides when model/provider stay inherited", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={createBoard()}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).handleOpenCreateTask();
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).setNewTaskPrompt("Reasoning override only");
			requireSnapshot(latestSnapshot).setNewTaskClineSettings({
				reasoningEffort: "low",
			});
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).handleCreateTask();
		});

		const createdCard = requireSnapshot(latestSnapshot).board.columns[0]?.cards[0];
		expect(createdCard?.clineSettings).toEqual({
			reasoningEffort: "low",
		});
	});

	it("preserves per-task agent/model override fields on each split task", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={createBoard()}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).handleOpenCreateTask();
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).setNewTaskAgentId("codex");
			requireSnapshot(latestSnapshot).setNewTaskClineSettings({
				providerId: "provider-abc",
				modelId: "model-xyz",
				reasoningEffort: "medium",
			});
		});

		let createdTaskIds: string[] = [];
		await act(async () => {
			createdTaskIds = requireSnapshot(latestSnapshot).handleCreateTasks(["Task A", "Task B", "Task C"]);
		});

		expect(createdTaskIds).toHaveLength(3);
		const backlogCards = requireSnapshot(latestSnapshot).board.columns[0]?.cards ?? [];
		expect(backlogCards).toHaveLength(3);
		for (const card of backlogCards) {
			expect(card.agentId).toBe("codex");
			expect(card.clineSettings).toEqual({
				providerId: "provider-abc",
				modelId: "model-xyz",
				reasoningEffort: "medium",
			});
		}
	});

	it("always creates tasks without auto-review armed", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={createBoard()}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).handleOpenCreateTask();
			requireSnapshot(latestSnapshot).setNewTaskPrompt("Human review by default");
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).handleCreateTask();
		});

		const createdCard = requireSnapshot(latestSnapshot).board.columns[0]?.cards[0];
		expect(createdCard?.autoReviewEnabled).toBe(false);
	});

	it("clears auto-review when saving a non-chain edited task", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const initialBoard = createBoard([
			createTask("task-1", "Initial prompt", 1, {
				autoReviewEnabled: true,
				autoReviewMode: "pr",
			}),
		]);

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={initialBoard}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		const task = requireSnapshot(latestSnapshot).board.columns[0]?.cards[0];
		if (!task) {
			throw new Error("Expected a backlog task.");
		}

		await act(async () => {
			requireSnapshot(latestSnapshot).handleOpenEditTask(task);
		});

		await act(async () => {
			latestSnapshot?.setEditTaskAutoReviewEnabled(true);
			latestSnapshot?.setEditTaskAutoReviewMode("pr");
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).handleSaveEditedTask();
		});

		const saved = requireSnapshot(latestSnapshot).board.columns[0]?.cards[0];
		expect(saved?.autoReviewEnabled).toBe(false);
	});

	it("keeps commit auto-review when saving an opted-in chain member", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		let initialBoard = createBoard([
			createTask("task-1", "Root", 1),
			createTask("task-2", "Follower", 2),
		]);
		const linked = addTaskDependency(initialBoard, "task-1", "task-2");
		if (!linked.added) {
			throw new Error("Expected chain link.");
		}
		initialBoard = linked.board;

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={initialBoard}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		const follower = requireSnapshot(latestSnapshot).board.columns[0]?.cards.find((card) => card.id === "task-2");
		if (!follower) {
			throw new Error("Expected follower task.");
		}

		await act(async () => {
			requireSnapshot(latestSnapshot).handleOpenEditTask(follower);
		});

		await act(async () => {
			latestSnapshot?.setEditTaskAutoReviewEnabled(true);
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).handleSaveEditedTask();
		});

		const saved = requireSnapshot(latestSnapshot).board.columns[0]?.cards.find((card) => card.id === "task-2");
		expect(saved?.autoReviewEnabled).toBe(true);
		expect(saved?.autoReviewMode).toBe("commit");
	});

	it("stamps an explicit Manager seat pin onto the created card", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={createBoard()}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).handleOpenCreateTask();
		});
		await act(async () => {
			requireSnapshot(latestSnapshot).setNewTaskPrompt("Pinned seat task");
			requireSnapshot(latestSnapshot).setNewTaskAgentId("claude");
			requireSnapshot(latestSnapshot).setNewTaskManagerAccountId(7);
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).handleCreateTask();
		});

		const createdCard = requireSnapshot(latestSnapshot).board.columns[0]?.cards[0];
		expect(createdCard?.managerAccountId).toBe(7);
		expect(requireSnapshot(latestSnapshot).newTaskManagerAccountId).toBeUndefined();
	});

	it("seeds the edit form from the card's seat, subagent seat and schedule", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const initialBoard = createBoard([
			createTask("task-1", "Pinned task", 1, {
				managerAccountId: 4,
				taskLaunchSettings: { subagentSeatProviderId: "openrouter" },
				autoRunAt: Date.now() + 25 * 60_000,
				autoResumeOnUsageLimit: true,
			}),
		]);

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={initialBoard}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		const task = requireSnapshot(latestSnapshot).board.columns[0]?.cards[0];
		if (!task) {
			throw new Error("Expected a backlog task.");
		}

		await act(async () => {
			requireSnapshot(latestSnapshot).handleOpenEditTask(task);
		});

		const snapshot = requireSnapshot(latestSnapshot);
		expect(snapshot.editTaskManagerAccountId).toBe(4);
		expect(snapshot.editTaskLaunchSettings).toEqual({ subagentSeatProviderId: "openrouter" });
		expect(snapshot.editTaskAutoRunDelayMinutes).toBe(25);
		expect(snapshot.editTaskAutoResumeOnUsageLimit).toBe(true);
	});

	it("saves a changed subagent seat, account pin and schedule back onto the card", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const initialBoard = createBoard([
			createTask("task-1", "Pinned task", 1, {
				managerAccountId: 4,
				taskLaunchSettings: { subagentSeatProviderId: "openrouter" },
			}),
		]);

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={initialBoard}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		const task = requireSnapshot(latestSnapshot).board.columns[0]?.cards[0];
		if (!task) {
			throw new Error("Expected a backlog task.");
		}

		await act(async () => {
			requireSnapshot(latestSnapshot).handleOpenEditTask(task);
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).setEditTaskManagerAccountId(9);
			requireSnapshot(latestSnapshot).setEditTaskLaunchSettings({
				subagentSeatProviderId: "groq",
				subagentSeatModelId: "llama-4",
			});
			requireSnapshot(latestSnapshot).setEditTaskAutoRunDelayMinutes(10);
			requireSnapshot(latestSnapshot).setEditTaskAutoResumeOnUsageLimit(true);
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).handleSaveEditedTask();
		});

		const saved = requireSnapshot(latestSnapshot).board.columns[0]?.cards[0];
		expect(saved?.managerAccountId).toBe(9);
		expect(saved?.taskLaunchSettings).toEqual({
			subagentSeatProviderId: "groq",
			subagentSeatModelId: "llama-4",
		});
		expect(saved?.autoResumeOnUsageLimit).toBe(true);
		expect(saved?.autoRunAt).toBeGreaterThan(Date.now());
	});

	it("clears the seat pin and schedule when the edit form leaves them empty", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const initialBoard = createBoard([
			createTask("task-1", "Pinned task", 1, {
				managerAccountId: 4,
				autoRunAt: Date.now() + 20 * 60_000,
				autoResumeOnUsageLimit: true,
			}),
		]);

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={initialBoard}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		const task = requireSnapshot(latestSnapshot).board.columns[0]?.cards[0];
		if (!task) {
			throw new Error("Expected a backlog task.");
		}

		await act(async () => {
			requireSnapshot(latestSnapshot).handleOpenEditTask(task);
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).setEditTaskManagerAccountId(undefined);
			requireSnapshot(latestSnapshot).setEditTaskAutoRunDelayMinutes(0);
			requireSnapshot(latestSnapshot).setEditTaskAutoResumeOnUsageLimit(false);
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).handleSaveEditedTask();
		});

		const saved = requireSnapshot(latestSnapshot).board.columns[0]?.cards[0];
		expect(saved?.managerAccountId).toBeUndefined();
		expect(saved?.autoRunAt).toBeUndefined();
		expect(saved?.autoResumeOnUsageLimit).toBeUndefined();
	});
});
