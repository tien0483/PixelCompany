import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { RuntimeBoardData, RuntimeTaskSessionSummary } from "../../src/core/api-contract";
import { shutdownRuntimeServer } from "../../src/server/shutdown-coordinator";
import { loadWorkspaceState, saveWorkspaceState } from "../../src/state/workspace-state";
import { ensureTaskWorktreeIfDoesntExist } from "../../src/workspace/task-worktree";
import type { TerminalSessionManager } from "../../src/terminal/session-manager";
import { createGitTestEnv } from "../utilities/git-env";
import { createTempDir } from "../utilities/temp-dir";

async function withTemporaryHome<T>(run: () => Promise<T>): Promise<T> {
	const { path: tempHome, cleanup } = createTempDir("kanban-home-shutdown-");
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	process.env.HOME = tempHome;
	process.env.USERPROFILE = tempHome;
	try {
		return await run();
	} finally {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		if (previousUserProfile === undefined) {
			delete process.env.USERPROFILE;
		} else {
			process.env.USERPROFILE = previousUserProfile;
		}
		cleanup();
	}
}

function runGit(cwd: string, args: string[]): void {
	const result = spawnSync("git", args, {
		cwd,
		stdio: "ignore",
		env: createGitTestEnv(),
	});
	if (result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed in ${cwd}`);
	}
}

function initGitRepository(path: string): void {
	runGit(path, ["init"]);
}

/** Creates a repo with an initial commit on `main` so `ensureTaskWorktreeIfDoesntExist` can succeed. */
function initGitRepositoryWithCommit(path: string): void {
	initGitRepository(path);
	runGit(path, ["config", "user.name", "Kanban Test"]);
	runGit(path, ["config", "user.email", "kanban-test@example.com"]);
	writeFileSync(join(path, "README.md"), "hello\n", "utf8");
	runGit(path, ["add", "README.md"]);
	runGit(path, ["commit", "-m", "init"]);
	runGit(path, ["branch", "-M", "main"]);
}

function createCard(taskId: string) {
	return {
		id: taskId,
		title: `Task ${taskId}`,
		prompt: `Task ${taskId}`,
		startInPlanMode: false,
		baseRef: "main",
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};
}

function createBoard(taskIds: { inProgress?: string[]; review?: string[] }): RuntimeBoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{
				id: "in_progress",
				title: "In Progress",
				cards: (taskIds.inProgress ?? []).map((taskId) => createCard(taskId)),
			},
			{
				id: "review",
				title: "Review",
				cards: (taskIds.review ?? []).map((taskId) => createCard(taskId)),
			},
			{ id: "trash", title: "Done", cards: [] },
		],
		dependencies: [],
	};
}

function createSession(
	taskId: string,
	state: "running" | "awaiting_review" | "idle",
	overrides: Partial<RuntimeTaskSessionSummary> = {},
): RuntimeTaskSessionSummary {
	return {
		taskId,
		state,
		agentId: "codex",
		workspacePath: `/tmp/${taskId}`,
		pid: state === "idle" ? null : 1234,
		startedAt: state === "idle" ? null : Date.now() - 1_000,
		activeRunMs: 0,
		runningSince: null,
		pausedAt: null,
		pauseReason: null,
		updatedAt: Date.now(),
		lastOutputAt: state === "idle" ? null : Date.now(),
		reviewReason: state === "awaiting_review" ? "hook" : null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		...overrides,
	};
}

/** A fully "parked" summary: idle, no process, `pausedAt` set. Matches the paused invariant. */
function createParkedSession(taskId: string): RuntimeTaskSessionSummary {
	return createSession(taskId, "idle", { pausedAt: Date.now() - 5_000, pauseReason: "manual" });
}

function createFakeTerminalManager(
	summariesByTaskId: Record<string, RuntimeTaskSessionSummary>,
	options?: {
		markInterruptedAndStopAllResult?: RuntimeTaskSessionSummary[];
	},
): TerminalSessionManager {
	return {
		markInterruptedAndStopAll: vi.fn(() => options?.markInterruptedAndStopAllResult ?? []),
		listSummaries: vi.fn(() => Object.values(summariesByTaskId)),
		getSummary: vi.fn((taskId: string) => summariesByTaskId[taskId] ?? null),
		deleteTerminalSnapshot: vi.fn(async () => {}),
		flushTerminalSnapshots: vi.fn(async () => {}),
	} as unknown as TerminalSessionManager;
}

describe.sequential("shutdown coordinator integration", () => {
	it("moves all in-progress and review cards to trash for every indexed project on shutdown", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-shutdown-scope-");
			try {
				const managedProjectPath = join(sandboxRoot, "managed-project");
				const indexedProjectPath = join(sandboxRoot, "indexed-project");
				mkdirSync(managedProjectPath, { recursive: true });
				mkdirSync(indexedProjectPath, { recursive: true });
				initGitRepository(managedProjectPath);
				initGitRepository(indexedProjectPath);

				const managedInitial = await loadWorkspaceState(managedProjectPath);
				await saveWorkspaceState(managedProjectPath, {
					board: createBoard({
						inProgress: ["managed-running", "managed-missing-session"],
						review: ["managed-idle"],
					}),
					sessions: {
						"managed-running": createSession("managed-running", "running"),
						"managed-idle": createSession("managed-idle", "idle"),
					},
					expectedRevision: managedInitial.revision,
				});

				const indexedInitial = await loadWorkspaceState(indexedProjectPath);
				await saveWorkspaceState(indexedProjectPath, {
					board: createBoard({
						inProgress: ["indexed-missing-session"],
						review: ["indexed-awaiting-review"],
					}),
					sessions: {
						"indexed-awaiting-review": createSession("indexed-awaiting-review", "awaiting_review"),
					},
					expectedRevision: indexedInitial.revision,
				});

				let didCloseRuntimeServer = false;
				const managedTerminalManager = createFakeTerminalManager(
					{
						"managed-running": createSession("managed-running", "running"),
						"managed-idle": createSession("managed-idle", "idle"),
					},
					{ markInterruptedAndStopAllResult: [createSession("managed-running", "running")] },
				);
				const flushSessionPersistence = vi.fn(async () => {});
				await shutdownRuntimeServer({
					workspaceRegistry: {
						listManagedWorkspaces: () => [
							{
								workspaceId: "managed-project",
								workspacePath: managedProjectPath,
								terminalManager: managedTerminalManager,
							},
						],
						flushSessionPersistence,
					},
					warn: () => {},
					closeRuntimeServer: async () => {
						didCloseRuntimeServer = true;
					},
				});

				expect(didCloseRuntimeServer).toBe(true);

				const managedAfter = await loadWorkspaceState(managedProjectPath);
				const managedTrash = managedAfter.board.columns.find((column) => column.id === "trash")?.cards ?? [];
				expect(managedTrash.map((card) => card.id).sort()).toEqual(
					["managed-idle", "managed-missing-session", "managed-running"].sort(),
				);
				expect(managedAfter.sessions["managed-running"]?.state).toBe("interrupted");
				expect(managedAfter.sessions["managed-idle"]?.state).toBe("interrupted");
				expect(managedAfter.sessions["managed-missing-session"]).toBeUndefined();

				const indexedAfter = await loadWorkspaceState(indexedProjectPath);
				const indexedTrash = indexedAfter.board.columns.find((column) => column.id === "trash")?.cards ?? [];
				expect(indexedTrash.map((card) => card.id).sort()).toEqual(
					["indexed-awaiting-review", "indexed-missing-session"].sort(),
				);
				expect(indexedAfter.sessions["indexed-awaiting-review"]?.state).toBe("interrupted");
				expect(indexedAfter.sessions["indexed-missing-session"]).toBeUndefined();

				// Every trashed/interrupted worktree task's scrollback snapshot is cleaned up
				// alongside its worktree, routed through the live manager for the managed
				// workspace (so its in-memory memoized restoredSnapshot is invalidated too).
				const deletedSnapshotTaskIds = (
					managedTerminalManager.deleteTerminalSnapshot as ReturnType<typeof vi.fn>
				).mock.calls
					.map(([taskId]) => taskId)
					.sort();
				expect(deletedSnapshotTaskIds).toEqual(["managed-idle", "managed-missing-session", "managed-running"].sort());

				// Task 7: session persistence + terminal snapshots are flushed before shutdown.
				expect(flushSessionPersistence).toHaveBeenCalledTimes(1);
				expect(managedTerminalManager.flushTerminalSnapshots).toHaveBeenCalledTimes(1);
			} finally {
				cleanup();
			}
		});
	}, 30_000);

	it("parks a paused In Progress card untouched while a non-paused card is still trashed and its worktree deleted", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-shutdown-parked-");
			try {
				const managedProjectPath = join(sandboxRoot, "managed-project");
				mkdirSync(managedProjectPath, { recursive: true });
				initGitRepositoryWithCommit(managedProjectPath);

				const pausedEnsure = await ensureTaskWorktreeIfDoesntExist({
					cwd: managedProjectPath,
					taskId: "paused-task",
					baseRef: "main",
				});
				expect(pausedEnsure.ok).toBe(true);
				const interruptedEnsure = await ensureTaskWorktreeIfDoesntExist({
					cwd: managedProjectPath,
					taskId: "interrupted-task",
					baseRef: "main",
				});
				expect(interruptedEnsure.ok).toBe(true);
				if (!pausedEnsure.ok || !interruptedEnsure.ok) {
					throw new Error("expected both worktrees to be created");
				}
				const pausedWorktreePath = pausedEnsure.path;
				const interruptedWorktreePath = interruptedEnsure.path;
				expect(existsSync(pausedWorktreePath)).toBe(true);
				expect(existsSync(interruptedWorktreePath)).toBe(true);

				const pausedSession = createParkedSession("paused-task");
				const runningSession = createSession("interrupted-task", "running");

				const managedInitial = await loadWorkspaceState(managedProjectPath);
				await saveWorkspaceState(managedProjectPath, {
					board: createBoard({
						inProgress: ["paused-task", "interrupted-task"],
					}),
					sessions: {
						"paused-task": pausedSession,
						"interrupted-task": runningSession,
					},
					expectedRevision: managedInitial.revision,
				});

				// `markInterruptedAndStopAll` sweeps every entry with a live process, which
				// includes a paused task: `pauseTaskSession` deliberately keeps the process
				// alive (so `--continue` can resume it later) and never clears `entry.active`.
				// The fake must mirror that real behavior so this test actually exercises the
				// re-partitioning of the sweep's output instead of the fake sidestepping it.
				const managedTerminalManager = createFakeTerminalManager(
					{
						"paused-task": pausedSession,
						"interrupted-task": runningSession,
					},
					{ markInterruptedAndStopAllResult: [pausedSession, runningSession] },
				);
				const flushSessionPersistence = vi.fn(async () => {});

				await shutdownRuntimeServer({
					workspaceRegistry: {
						listManagedWorkspaces: () => [
							{
								workspaceId: "managed-project",
								workspacePath: managedProjectPath,
								terminalManager: managedTerminalManager,
							},
						],
						flushSessionPersistence,
					},
					warn: () => {},
					closeRuntimeServer: async () => {},
				});

				const after = await loadWorkspaceState(managedProjectPath);
				const inProgress = after.board.columns.find((column) => column.id === "in_progress")?.cards ?? [];
				const trash = after.board.columns.find((column) => column.id === "trash")?.cards ?? [];

				// Paused task: stays In Progress, untouched.
				expect(inProgress.map((card) => card.id)).toEqual(["paused-task"]);
				const pausedAfter = after.sessions["paused-task"];
				expect(pausedAfter?.state).toBe("idle");
				expect(pausedAfter?.pausedAt).toBe(pausedSession.pausedAt);
				expect(pausedAfter?.pauseReason).toBe("manual");
				expect(pausedAfter?.pid).toBeNull();
				expect(pausedAfter?.exitCode).toBeNull();
				expect(existsSync(pausedWorktreePath)).toBe(true);

				// Non-paused task: keeps today's behavior exactly (trashed, worktree deleted).
				expect(trash.map((card) => card.id)).toEqual(["interrupted-task"]);
				expect(after.sessions["interrupted-task"]?.state).toBe("interrupted");
				expect(existsSync(interruptedWorktreePath)).toBe(false);

				// The paused task's worktree is never a delete candidate, so its snapshot is
				// never touched either; the interrupted task's is.
				const deleteTerminalSnapshot = managedTerminalManager.deleteTerminalSnapshot as ReturnType<typeof vi.fn>;
				const deletedSnapshotTaskIds = deleteTerminalSnapshot.mock.calls.map(([taskId]) => taskId);
				expect(deletedSnapshotTaskIds).toEqual(["interrupted-task"]);
			} finally {
				cleanup();
			}
		});
	}, 30_000);

	it("leaves everything untouched when skipSessionCleanup is set", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-shutdown-skip-");
			try {
				const managedProjectPath = join(sandboxRoot, "managed-project");
				mkdirSync(managedProjectPath, { recursive: true });
				initGitRepository(managedProjectPath);

				const managedInitial = await loadWorkspaceState(managedProjectPath);
				await saveWorkspaceState(managedProjectPath, {
					board: createBoard({ inProgress: ["still-running"] }),
					sessions: {
						"still-running": createSession("still-running", "running"),
					},
					expectedRevision: managedInitial.revision,
				});

				const listManagedWorkspaces = vi.fn(() => []);
				const flushSessionPersistence = vi.fn(async () => {});
				let didCloseRuntimeServer = false;

				await shutdownRuntimeServer({
					workspaceRegistry: {
						listManagedWorkspaces,
						flushSessionPersistence,
					},
					warn: () => {},
					closeRuntimeServer: async () => {
						didCloseRuntimeServer = true;
					},
					skipSessionCleanup: true,
				});

				expect(didCloseRuntimeServer).toBe(true);
				expect(listManagedWorkspaces).not.toHaveBeenCalled();
				expect(flushSessionPersistence).not.toHaveBeenCalled();

				const after = await loadWorkspaceState(managedProjectPath);
				const inProgress = after.board.columns.find((column) => column.id === "in_progress")?.cards ?? [];
				expect(inProgress.map((card) => card.id)).toEqual(["still-running"]);
				expect(after.sessions["still-running"]?.state).toBe("running");
			} finally {
				cleanup();
			}
		});
	}, 30_000);

	it("awaits flushSessionPersistence and flushTerminalSnapshots after markInterruptedAndStopAll and before closeRuntimeServer", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-shutdown-order-");
			try {
				const managedProjectPath = join(sandboxRoot, "managed-project");
				mkdirSync(managedProjectPath, { recursive: true });
				initGitRepository(managedProjectPath);

				const managedInitial = await loadWorkspaceState(managedProjectPath);
				await saveWorkspaceState(managedProjectPath, {
					board: createBoard({ inProgress: ["order-task"] }),
					sessions: {
						"order-task": createSession("order-task", "running"),
					},
					expectedRevision: managedInitial.revision,
				});

				const runningSession = createSession("order-task", "running");
				const markInterruptedAndStopAll = vi.fn(() => [runningSession]);
				const managedTerminalManager = {
					markInterruptedAndStopAll,
					listSummaries: vi.fn(() => [runningSession]),
					getSummary: vi.fn((taskId: string) => (taskId === "order-task" ? runningSession : null)),
					deleteTerminalSnapshot: vi.fn(async () => {}),
					flushTerminalSnapshots: vi.fn(async () => {}),
				} as unknown as TerminalSessionManager;
				const flushSessionPersistence = vi.fn(async () => {});
				const closeRuntimeServer = vi.fn(async () => {});

				await shutdownRuntimeServer({
					workspaceRegistry: {
						listManagedWorkspaces: () => [
							{
								workspaceId: "managed-project",
								workspacePath: managedProjectPath,
								terminalManager: managedTerminalManager,
							},
						],
						flushSessionPersistence,
					},
					warn: () => {},
					closeRuntimeServer,
				});

				expect(markInterruptedAndStopAll).toHaveBeenCalledTimes(1);
				expect(flushSessionPersistence).toHaveBeenCalledTimes(1);
				expect(managedTerminalManager.flushTerminalSnapshots).toHaveBeenCalledTimes(1);
				expect(closeRuntimeServer).toHaveBeenCalledTimes(1);

				const markOrder = markInterruptedAndStopAll.mock.invocationCallOrder[0]!;
				const flushSessionOrder = flushSessionPersistence.mock.invocationCallOrder[0]!;
				const flushSnapshotsOrder = (managedTerminalManager.flushTerminalSnapshots as ReturnType<typeof vi.fn>).mock
					.invocationCallOrder[0]!;
				const closeOrder = closeRuntimeServer.mock.invocationCallOrder[0]!;

				expect(markOrder).toBeLessThan(flushSessionOrder);
				expect(markOrder).toBeLessThan(flushSnapshotsOrder);
				expect(flushSessionOrder).toBeLessThan(closeOrder);
				expect(flushSnapshotsOrder).toBeLessThan(closeOrder);
			} finally {
				cleanup();
			}
		});
	}, 30_000);
});
