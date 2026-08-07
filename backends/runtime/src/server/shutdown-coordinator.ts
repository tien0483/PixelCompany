import type { RuntimeTaskSessionSummary, RuntimeWorkspaceStateResponse } from "../core/api-contract";
import { updateTaskDependencies } from "../core/task-board-mutations";
import { listWorkspaceIndexEntries, loadWorkspaceState, saveWorkspaceState } from "../state/workspace-state";
import { toParkedSessionSummary } from "../terminal/session-hydration";
import type { TerminalSessionManager } from "../terminal/session-manager";
import { createTerminalSnapshotStore } from "../terminal/terminal-snapshot-store";
import { deleteTaskWorktree, removeTaskWorktreeSetupLock } from "../workspace/task-worktree";
import type { WorkspaceRegistry } from "./workspace-registry";
import { collectProjectWorktreeTaskIdsForRemoval } from "./workspace-registry";

export interface RuntimeShutdownCoordinatorDependencies {
	workspaceRegistry: Pick<WorkspaceRegistry, "listManagedWorkspaces" | "flushSessionPersistence">;
	warn: (message: string) => void;
	closeRuntimeServer: () => Promise<void>;
	skipSessionCleanup?: boolean;
}

/**
 * A session that was manually/force-paused (`pausedAt != null`) should survive shutdown
 * untouched instead of being trashed like a genuinely interrupted one: Resume can relaunch
 * it with `--continue` later. This mirrors the "paused, no process" invariant documented in
 * `terminal/session-hydration.ts`.
 */
function isParkedOnShutdown(summary: RuntimeTaskSessionSummary | null | undefined): boolean {
	return summary?.pausedAt != null;
}

function moveTaskToTrash(
	board: RuntimeWorkspaceStateResponse["board"],
	taskId: string,
): RuntimeWorkspaceStateResponse["board"] {
	const columns = board.columns.map((column) => ({
		...column,
		cards: [...column.cards],
	}));
	let removedCard: RuntimeWorkspaceStateResponse["board"]["columns"][number]["cards"][number] | undefined;

	for (const column of columns) {
		const cardIndex = column.cards.findIndex((candidate) => candidate.id === taskId);
		if (cardIndex === -1) {
			continue;
		}
		removedCard = column.cards[cardIndex];
		column.cards.splice(cardIndex, 1);
		break;
	}

	if (!removedCard) {
		return board;
	}
	const trashColumnIndex = columns.findIndex((column) => column.id === "trash");
	if (trashColumnIndex === -1) {
		return board;
	}
	const trashColumn = columns[trashColumnIndex];
	if (!trashColumn.cards.some((candidate) => candidate.id === taskId)) {
		trashColumn.cards.unshift({
			...removedCard,
			updatedAt: Date.now(),
		});
	}
	return updateTaskDependencies({
		...board,
		columns,
	});
}

async function persistInterruptedSessions(
	workspacePath: string,
	taskIds: {
		interruptedTaskIds: string[];
		parkedTaskIds: string[];
	},
	options?: {
		workspaceState?: RuntimeWorkspaceStateResponse;
		resolveSummary?: (taskId: string) => RuntimeTaskSessionSummary | null;
	},
): Promise<string[]> {
	const { interruptedTaskIds, parkedTaskIds } = taskIds;
	if (interruptedTaskIds.length === 0 && parkedTaskIds.length === 0) {
		return [];
	}
	const workspaceState = options?.workspaceState ?? (await loadWorkspaceState(workspacePath));
	const worktreeTaskIds = collectProjectWorktreeTaskIdsForRemoval(workspaceState.board);
	// Parked tasks stay wherever they are on the board (In Progress) and keep their
	// worktree, so only interrupted tasks are eligible for the worktree cleanup pass.
	const worktreeTaskIdsToCleanup = interruptedTaskIds.filter((taskId) => worktreeTaskIds.has(taskId));
	let nextBoard = workspaceState.board;
	for (const taskId of interruptedTaskIds) {
		nextBoard = moveTaskToTrash(nextBoard, taskId);
	}
	const nextSessions = {
		...workspaceState.sessions,
	};
	const nowTs = Date.now();
	for (const taskId of interruptedTaskIds) {
		const summary = options?.resolveSummary?.(taskId) ?? workspaceState.sessions[taskId] ?? null;
		if (summary) {
			nextSessions[taskId] = {
				...summary,
				state: "interrupted",
				reviewReason: "interrupted",
				pid: null,
				updatedAt: nowTs,
			};
		}
	}
	for (const taskId of parkedTaskIds) {
		const summary = options?.resolveSummary?.(taskId) ?? workspaceState.sessions[taskId] ?? null;
		if (summary) {
			nextSessions[taskId] = toParkedSessionSummary(summary, nowTs);
		}
	}
	await saveWorkspaceState(workspacePath, {
		board: nextBoard,
		sessions: nextSessions,
	});
	return worktreeTaskIdsToCleanup;
}

async function cleanupInterruptedTaskWorktrees(
	repoPath: string,
	taskIds: string[],
	warn: (message: string) => void,
	deleteSnapshot: (taskId: string) => Promise<void>,
): Promise<void> {
	if (taskIds.length === 0) {
		return;
	}
	const deletions = await Promise.all(
		taskIds.map(async (taskId) => ({
			taskId,
			deleted: await deleteTaskWorktree({
				repoPath,
				taskId,
			}),
		})),
	);
	// Best effort, independent of whether the worktree delete itself succeeded: the task
	// is going to trash either way, so its scrollback snapshot is no longer worth keeping.
	await Promise.all(
		taskIds.map((taskId) =>
			deleteSnapshot(taskId).catch(() => {
				// An orphaned snapshot file does not block shutdown cleanup.
			}),
		),
	);
	for (const { taskId, deleted } of deletions) {
		if (deleted.ok) {
			continue;
		}
		const message = deleted.error ?? `Could not delete task workspace for task "${taskId}" during shutdown.`;
		warn(message);
	}
}

async function cleanupTaskWorktreeSetupLocks(
	repoPaths: Iterable<string>,
	warn: (message: string) => void,
): Promise<void> {
	await Promise.all(
		Array.from(new Set(repoPaths)).map(async (repoPath) => {
			try {
				await removeTaskWorktreeSetupLock(repoPath);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				warn(`Could not remove task worktree setup lock for ${repoPath} during shutdown cleanup. ${message}`);
			}
		}),
	);
}

function shouldInterruptSessionOnShutdown(summary: RuntimeTaskSessionSummary): boolean {
	if (summary.state === "running") {
		return true;
	}
	return summary.state === "awaiting_review";
}

function collectShutdownInterruptedTaskIds(
	interruptedSummaries: RuntimeTaskSessionSummary[],
	terminalManager: TerminalSessionManager,
): string[] {
	const taskIds = new Set(interruptedSummaries.map((summary) => summary.taskId));
	for (const summary of terminalManager.listSummaries()) {
		if (!shouldInterruptSessionOnShutdown(summary)) {
			continue;
		}
		taskIds.add(summary.taskId);
	}
	return Array.from(taskIds);
}

function collectWorkColumnTaskIds(workspaceState: RuntimeWorkspaceStateResponse): string[] {
	return Array.from(collectProjectWorktreeTaskIdsForRemoval(workspaceState.board));
}

/**
 * Splits a set of In Progress/Review task ids into "interrupted" (trash + delete worktree,
 * today's behavior) and "parked" (paused, survives shutdown untouched) based on each task's
 * current session summary. The live in-memory manager is the source of truth when a task has
 * one; an indexed-only task with no active `TerminalSessionManager` in this process falls back
 * to whatever was last persisted to `workspaceState.sessions`.
 */
function partitionWorkColumnTaskIds(
	taskIds: Iterable<string>,
	workspaceState: RuntimeWorkspaceStateResponse,
	terminalManager: TerminalSessionManager | undefined,
): { interruptedTaskIds: string[]; parkedTaskIds: string[] } {
	const interruptedTaskIds: string[] = [];
	const parkedTaskIds: string[] = [];
	for (const taskId of taskIds) {
		const summary = terminalManager?.getSummary(taskId) ?? workspaceState.sessions[taskId] ?? null;
		if (isParkedOnShutdown(summary)) {
			parkedTaskIds.push(taskId);
		} else {
			interruptedTaskIds.push(taskId);
		}
	}
	return { interruptedTaskIds, parkedTaskIds };
}

export async function shutdownRuntimeServer(deps: RuntimeShutdownCoordinatorDependencies): Promise<void> {
	if (deps.skipSessionCleanup) {
		await deps.closeRuntimeServer();
		return;
	}

	const interruptedByWorkspace: Array<{
		workspaceId: string;
		workspacePath: string;
		interruptedTaskIds: string[];
		parkedTaskIds: string[];
		workspaceState?: RuntimeWorkspaceStateResponse;
		resolveSummary?: (taskId: string) => RuntimeTaskSessionSummary | null;
		/** Only present for a workspace with a live manager in this process (first loop below). */
		terminalManager?: TerminalSessionManager;
	}> = [];
	const managedWorkspacePaths = new Set<string>();
	const managedWorkspaces = deps.workspaceRegistry.listManagedWorkspaces();

	for (const { workspaceId, workspacePath, terminalManager } of managedWorkspaces) {
		const interrupted = terminalManager.markInterruptedAndStopAll();
		const shutdownSweepTaskIds = collectShutdownInterruptedTaskIds(interrupted, terminalManager);
		if (!workspacePath) {
			continue;
		}
		managedWorkspacePaths.add(workspacePath);
		try {
			const workspaceState = await loadWorkspaceState(workspacePath);
			// `markInterruptedAndStopAll`/`listSummaries` sweep on `entry.active`/`state`
			// alone: a manually-paused task (`pausedAt != null`) keeps its process alive and
			// `state === "running"` for the entire pause duration by design (see
			// `isParkedOnShutdown`'s docstring), so it shows up in this sweep too. Re-partition
			// it here the same way the work-column pass below does, otherwise a paused task
			// lands in `interruptedTaskIds` and gets trashed/worktree-deleted despite also
			// being correctly classified as parked by the work-column pass.
			const sweepPartition = partitionWorkColumnTaskIds(shutdownSweepTaskIds, workspaceState, terminalManager);
			const interruptedTaskIds = new Set(sweepPartition.interruptedTaskIds);
			const parkedTaskIds = new Set(sweepPartition.parkedTaskIds);
			const workColumnPartition = partitionWorkColumnTaskIds(
				collectWorkColumnTaskIds(workspaceState),
				workspaceState,
				terminalManager,
			);
			for (const taskId of workColumnPartition.interruptedTaskIds) {
				interruptedTaskIds.add(taskId);
			}
			for (const taskId of workColumnPartition.parkedTaskIds) {
				parkedTaskIds.add(taskId);
			}
			interruptedByWorkspace.push({
				workspaceId,
				workspacePath,
				interruptedTaskIds: Array.from(interruptedTaskIds),
				parkedTaskIds: Array.from(parkedTaskIds),
				workspaceState,
				resolveSummary: (taskId) => terminalManager.getSummary(taskId),
				terminalManager,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			deps.warn(`Could not load workspace state for ${workspacePath} during shutdown cleanup. ${message}`);
		}
	}

	const indexedWorkspaces = await listWorkspaceIndexEntries();
	for (const workspace of indexedWorkspaces) {
		if (managedWorkspacePaths.has(workspace.repoPath)) {
			continue;
		}
		try {
			const workspaceState = await loadWorkspaceState(workspace.repoPath);
			const workColumnTaskIds = collectWorkColumnTaskIds(workspaceState);
			if (workColumnTaskIds.length === 0) {
				continue;
			}
			const { interruptedTaskIds, parkedTaskIds } = partitionWorkColumnTaskIds(
				workColumnTaskIds,
				workspaceState,
				undefined,
			);
			interruptedByWorkspace.push({
				workspaceId: workspace.workspaceId,
				workspacePath: workspace.repoPath,
				interruptedTaskIds,
				parkedTaskIds,
				workspaceState,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			deps.warn(`Could not load workspace state for ${workspace.repoPath} during shutdown cleanup. ${message}`);
		}
	}

	await Promise.all(
		interruptedByWorkspace.map(async (workspace) => {
			const worktreeTaskIds = await persistInterruptedSessions(
				workspace.workspacePath,
				{
					interruptedTaskIds: workspace.interruptedTaskIds,
					parkedTaskIds: workspace.parkedTaskIds,
				},
				{
					workspaceState: workspace.workspaceState,
					resolveSummary: workspace.resolveSummary,
				},
			);
			// Prefer the live manager when this workspace has one: it also invalidates the
			// entry's in-memory memoized restoredSnapshot, not just the on-disk file. Fall
			// back to a fresh store instance (equivalent on-disk target, no cache to keep in
			// sync) for an indexed-only workspace with no manager loaded in this process.
			const terminalManager = workspace.terminalManager;
			const deleteSnapshot = terminalManager
				? (taskId: string) => terminalManager.deleteTerminalSnapshot(taskId)
				: (taskId: string) => createTerminalSnapshotStore(workspace.workspaceId).delete(taskId);
			await cleanupInterruptedTaskWorktrees(workspace.workspacePath, worktreeTaskIds, deps.warn, deleteSnapshot);
		}),
	);

	// Capture the final exit output/summaries (just written by markInterruptedAndStopAll
	// above, plus whatever the persistInterruptedSessions pass wrote) before the server
	// actually closes. Reuses the same `listManagedWorkspaces()` snapshot as the loop
	// above rather than a fresh call, since no workspace gets disposed in this path
	// (shutdown-coordinator.ts never calls `disposeWorkspace`) and the set of managers
	// cannot have changed since.
	await deps.workspaceRegistry.flushSessionPersistence();
	await Promise.all(managedWorkspaces.map(({ terminalManager }) => terminalManager.flushTerminalSnapshots()));

	await deps.closeRuntimeServer();

	await cleanupTaskWorktreeSetupLocks(
		[...managedWorkspacePaths, ...indexedWorkspaces.map((workspace) => workspace.repoPath)],
		deps.warn,
	);
}
