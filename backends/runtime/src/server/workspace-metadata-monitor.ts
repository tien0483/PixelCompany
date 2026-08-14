import type {
	RuntimeBoardData,
	RuntimeGitSyncSummary,
	RuntimeTaskWorkspaceMetadata,
	RuntimeWorkspaceMetadata,
} from "../core/api-contract";
import { mapWithConcurrency } from "../core/async-pool";
import { resolveChainWorktreeOwnerTaskId } from "../core/task-board-mutations";
import { getCommitsAheadOfBaseRef, getGitSyncSummary, probeGitWorkspaceState } from "../workspace/git-sync";
import { getTaskWorkspacePathInfo } from "../workspace/task-worktree";

/** Floor of the adaptive poll: what a small repo keeps polling at. */
const WORKSPACE_METADATA_POLL_INTERVAL_MS = 1_000;

/**
 * Ceiling of the adaptive poll. A refresh on a 100k-commit repo with a large
 * working tree takes seconds, so a fixed 1 s interval re-entered before the
 * previous tick finished and the workspace spent all its time probing git.
 */
const WORKSPACE_METADATA_MAX_POLL_INTERVAL_MS = 15_000;

/** Next tick is scheduled this many times the last refresh's own duration. */
const WORKSPACE_METADATA_POLL_DUTY_CYCLE = 3;

/** Cards probed at once. A board with 40 active cards used to spawn 120+ git processes per tick. */
const WORKSPACE_METADATA_TASK_CONCURRENCY = 4;

/**
 * How long a connecting client waits for the first refresh before it is handed
 * the (possibly empty) cached snapshot instead. The connection handshake used to
 * await the whole refresh, so selecting a large project left the board on a
 * spinner until every git probe had finished.
 */
const WORKSPACE_METADATA_INITIAL_WAIT_MS = 750;

interface TrackedTaskWorkspace {
	taskId: string;
	baseRef: string;
	// Chain followers share their chain root's git worktree. This is the id whose
	// worktree path we actually probe on disk; `taskId` above stays the card's own id
	// so the reported metadata is keyed by what the UI asked about.
	worktreeTaskId: string;
}

interface CachedHomeGitMetadata {
	summary: RuntimeGitSyncSummary | null;
	stateToken: string | null;
	stateVersion: number;
}

interface CachedTaskWorkspaceMetadata {
	data: RuntimeTaskWorkspaceMetadata;
	stateToken: string | null;
}

interface WorkspaceMetadataEntry {
	workspacePath: string;
	trackedTasks: TrackedTaskWorkspace[];
	subscriberCount: number;
	pollTimer: NodeJS.Timeout | null;
	/** True while a poll chain owns this entry, so a second connect cannot start a second chain. */
	pollActive: boolean;
	refreshPromise: Promise<RuntimeWorkspaceMetadata> | null;
	homeGit: CachedHomeGitMetadata;
	taskMetadataByTaskId: Map<string, CachedTaskWorkspaceMetadata>;
}

export interface CreateWorkspaceMetadataMonitorDependencies {
	onMetadataUpdated: (workspaceId: string, metadata: RuntimeWorkspaceMetadata) => void;
}

export interface WorkspaceMetadataMonitor {
	connectWorkspace: (input: {
		workspaceId: string;
		workspacePath: string;
		board: RuntimeBoardData;
	}) => Promise<RuntimeWorkspaceMetadata>;
	updateWorkspaceState: (input: {
		workspaceId: string;
		workspacePath: string;
		board: RuntimeBoardData;
	}) => Promise<RuntimeWorkspaceMetadata>;
	/** Cached metadata without triggering a refresh. Empty for an unknown workspace. */
	readSnapshot: (workspaceId: string) => RuntimeWorkspaceMetadata;
	disconnectWorkspace: (workspaceId: string) => void;
	disposeWorkspace: (workspaceId: string) => void;
	close: () => void;
}

function collectTrackedTasks(board: RuntimeBoardData): TrackedTaskWorkspace[] {
	const tracked: TrackedTaskWorkspace[] = [];
	for (const column of board.columns) {
		// Backlog and trash cards do not need git metadata polling. Tracking only
		// active columns avoids unnecessary work, and trash paths are reconstructed
		// from task id on the web-ui side.
		if (column.id === "backlog" || column.id === "trash") {
			continue;
		}
		for (const card of column.cards) {
			tracked.push({
				taskId: card.id,
				baseRef: card.baseRef,
				worktreeTaskId: resolveChainWorktreeOwnerTaskId(board, card.id),
			});
		}
	}
	return tracked;
}

function areGitSummariesEqual(a: RuntimeGitSyncSummary | null, b: RuntimeGitSyncSummary | null): boolean {
	if (a === b) {
		return true;
	}
	if (!a || !b) {
		return false;
	}
	return (
		a.currentBranch === b.currentBranch &&
		a.upstreamBranch === b.upstreamBranch &&
		a.changedFiles === b.changedFiles &&
		a.additions === b.additions &&
		a.deletions === b.deletions &&
		a.aheadCount === b.aheadCount &&
		a.behindCount === b.behindCount
	);
}

function areTaskMetadataEqual(a: RuntimeTaskWorkspaceMetadata, b: RuntimeTaskWorkspaceMetadata): boolean {
	return (
		a.taskId === b.taskId &&
		a.path === b.path &&
		a.exists === b.exists &&
		a.baseRef === b.baseRef &&
		a.branch === b.branch &&
		a.isDetached === b.isDetached &&
		a.headCommit === b.headCommit &&
		a.changedFiles === b.changedFiles &&
		a.additions === b.additions &&
		a.deletions === b.deletions &&
		a.aheadOfBaseCount === b.aheadOfBaseCount &&
		a.stateVersion === b.stateVersion
	);
}

export function areWorkspaceMetadataEqual(a: RuntimeWorkspaceMetadata, b: RuntimeWorkspaceMetadata): boolean {
	if (!areGitSummariesEqual(a.homeGitSummary, b.homeGitSummary)) {
		return false;
	}
	if (a.homeGitStateVersion !== b.homeGitStateVersion) {
		return false;
	}
	if (a.taskWorkspaces.length !== b.taskWorkspaces.length) {
		return false;
	}
	for (let index = 0; index < a.taskWorkspaces.length; index += 1) {
		const left = a.taskWorkspaces[index];
		const right = b.taskWorkspaces[index];
		if (!left || !right || !areTaskMetadataEqual(left, right)) {
			return false;
		}
	}
	return true;
}

function createEmptyWorkspaceMetadata(): RuntimeWorkspaceMetadata {
	return {
		homeGitSummary: null,
		homeGitStateVersion: 0,
		taskWorkspaces: [],
	};
}

function createWorkspaceEntry(workspacePath: string): WorkspaceMetadataEntry {
	return {
		workspacePath,
		trackedTasks: [],
		subscriberCount: 0,
		pollTimer: null,
		pollActive: false,
		refreshPromise: null,
		homeGit: {
			summary: null,
			stateToken: null,
			stateVersion: 0,
		},
		taskMetadataByTaskId: new Map<string, CachedTaskWorkspaceMetadata>(),
	};
}

function buildWorkspaceMetadataSnapshot(entry: WorkspaceMetadataEntry): RuntimeWorkspaceMetadata {
	return {
		homeGitSummary: entry.homeGit.summary,
		homeGitStateVersion: entry.homeGit.stateVersion,
		taskWorkspaces: entry.trackedTasks
			.map((task) => entry.taskMetadataByTaskId.get(task.taskId)?.data ?? null)
			.filter((task): task is RuntimeTaskWorkspaceMetadata => task !== null),
	};
}

async function loadHomeGitMetadata(entry: WorkspaceMetadataEntry): Promise<CachedHomeGitMetadata> {
	try {
		const probe = await probeGitWorkspaceState(entry.workspacePath);
		if (entry.homeGit.stateToken === probe.stateToken) {
			return entry.homeGit;
		}
		const summary = await getGitSyncSummary(entry.workspacePath, { probe });
		return {
			summary,
			stateToken: probe.stateToken,
			stateVersion: Date.now(),
		};
	} catch {
		return entry.homeGit;
	}
}

async function loadTaskWorkspaceMetadata(
	workspaceId: string,
	workspacePath: string,
	task: TrackedTaskWorkspace,
	current: CachedTaskWorkspaceMetadata | null,
): Promise<CachedTaskWorkspaceMetadata | null> {
	// Probe the shared worktree owner's path (chain root for followers, the task's own
	// id for standalone/root tasks), but every returned record stays keyed on the
	// card's own taskId so the frontend store still looks it up by card id.
	const pathInfo = await getTaskWorkspacePathInfo({
		cwd: workspacePath,
		workspaceId,
		taskId: task.worktreeTaskId,
		baseRef: task.baseRef,
	});

	if (!pathInfo.exists) {
		if (
			current &&
			current.data.exists === false &&
			current.data.path === pathInfo.path &&
			current.data.baseRef === pathInfo.baseRef
		) {
			return current;
		}
		return {
			data: {
				taskId: task.taskId,
				path: pathInfo.path,
				exists: false,
				baseRef: pathInfo.baseRef,
				branch: null,
				isDetached: false,
				headCommit: null,
				changedFiles: null,
				additions: null,
				deletions: null,
				aheadOfBaseCount: null,
				stateVersion: Date.now(),
			},
			stateToken: null,
		};
	}

	try {
		const probe = await probeGitWorkspaceState(pathInfo.path);
		if (
			current &&
			current.stateToken === probe.stateToken &&
			current.data.path === pathInfo.path &&
			current.data.baseRef === pathInfo.baseRef
		) {
			return current;
		}
		const summary = await getGitSyncSummary(pathInfo.path, { probe });
		const aheadOfBaseCount = await getCommitsAheadOfBaseRef(pathInfo.path, pathInfo.baseRef);
		return {
			data: {
				taskId: task.taskId,
				path: pathInfo.path,
				exists: true,
				baseRef: pathInfo.baseRef,
				branch: probe.currentBranch,
				isDetached: probe.headCommit !== null && probe.currentBranch === null,
				headCommit: probe.headCommit,
				changedFiles: summary.changedFiles,
				additions: summary.additions,
				deletions: summary.deletions,
				aheadOfBaseCount,
				stateVersion: Date.now(),
			},
			stateToken: probe.stateToken,
		};
	} catch {
		if (current) {
			return current;
		}
		return {
			data: {
				taskId: task.taskId,
				path: pathInfo.path,
				exists: true,
				baseRef: pathInfo.baseRef,
				branch: null,
				isDetached: false,
				headCommit: null,
				changedFiles: null,
				additions: null,
				deletions: null,
				aheadOfBaseCount: null,
				stateVersion: Date.now(),
			},
			stateToken: null,
		};
	}
}

export function createWorkspaceMetadataMonitor(
	deps: CreateWorkspaceMetadataMonitorDependencies,
): WorkspaceMetadataMonitor {
	const workspaces = new Map<string, WorkspaceMetadataEntry>();

	const stopWorkspaceTimer = (entry: WorkspaceMetadataEntry) => {
		if (entry.pollTimer) {
			clearTimeout(entry.pollTimer);
			entry.pollTimer = null;
		}
		// Also clears the flag when the chain is between ticks (refresh in flight,
		// no timer armed), which is where a plain pollTimer check would leak it.
		entry.pollActive = false;
	};

	const refreshWorkspace = async (workspaceId: string): Promise<RuntimeWorkspaceMetadata> => {
		const entry = workspaces.get(workspaceId);
		if (!entry) {
			return createEmptyWorkspaceMetadata();
		}
		if (entry.refreshPromise) {
			return await entry.refreshPromise;
		}

		entry.refreshPromise = (async () => {
			const previousSnapshot = buildWorkspaceMetadataSnapshot(entry);
			entry.homeGit = await loadHomeGitMetadata(entry);

			const nextTaskEntries = await mapWithConcurrency(
				entry.trackedTasks,
				WORKSPACE_METADATA_TASK_CONCURRENCY,
				async (task): Promise<[string, CachedTaskWorkspaceMetadata] | null> => {
					const current = entry.taskMetadataByTaskId.get(task.taskId) ?? null;
					const next = await loadTaskWorkspaceMetadata(workspaceId, entry.workspacePath, task, current);
					return next ? [task.taskId, next] : null;
				},
			);

			entry.taskMetadataByTaskId = new Map(
				nextTaskEntries.filter(
					(candidate): candidate is [string, CachedTaskWorkspaceMetadata] => candidate !== null,
				),
			);

			const nextSnapshot = buildWorkspaceMetadataSnapshot(entry);
			if (!areWorkspaceMetadataEqual(previousSnapshot, nextSnapshot)) {
				deps.onMetadataUpdated(workspaceId, nextSnapshot);
			}
			return nextSnapshot;
		})().finally(() => {
			const current = workspaces.get(workspaceId);
			if (current) {
				current.refreshPromise = null;
			}
		});

		return await entry.refreshPromise;
	};

	const updateWorkspaceEntry = (input: {
		workspaceId: string;
		workspacePath: string;
		board: RuntimeBoardData;
	}): WorkspaceMetadataEntry => {
		const existing = workspaces.get(input.workspaceId) ?? createWorkspaceEntry(input.workspacePath);
		existing.workspacePath = input.workspacePath;
		existing.trackedTasks = collectTrackedTasks(input.board);
		workspaces.set(input.workspaceId, existing);
		return existing;
	};

	/**
	 * Self-rescheduling instead of `setInterval`: the next tick is only armed once
	 * the current refresh has settled, at three times its own duration and clamped
	 * to [1s, 15s]. A repo that refreshes in 30 ms therefore keeps the original 1 s
	 * cadence, while a repo that takes 4 s backs off to 12 s instead of queueing
	 * ticks behind itself.
	 */
	const ensureWorkspaceTimer = (workspaceId: string, entry: WorkspaceMetadataEntry) => {
		if (entry.pollActive) {
			return;
		}
		entry.pollActive = true;

		const scheduleNext = (delayMs: number) => {
			const current = workspaces.get(workspaceId);
			if (!current || current.subscriberCount === 0 || !current.pollActive) {
				return;
			}
			const timer = setTimeout(() => {
				current.pollTimer = null;
				const startedAt = Date.now();
				void refreshWorkspace(workspaceId).finally(() => {
					const elapsedMs = Date.now() - startedAt;
					scheduleNext(
						Math.min(
							Math.max(elapsedMs * WORKSPACE_METADATA_POLL_DUTY_CYCLE, WORKSPACE_METADATA_POLL_INTERVAL_MS),
							WORKSPACE_METADATA_MAX_POLL_INTERVAL_MS,
						),
					);
				});
			}, delayMs);
			timer.unref();
			current.pollTimer = timer;
		};

		scheduleNext(WORKSPACE_METADATA_POLL_INTERVAL_MS);
	};

	/**
	 * Waits for a refresh, but never longer than `WORKSPACE_METADATA_INITIAL_WAIT_MS`.
	 * On a slow repo the caller gets the cached snapshot and the real one follows over
	 * `onMetadataUpdated`, which is what keeps the board from blocking on git.
	 */
	const refreshWithDeadline = async (workspaceId: string): Promise<RuntimeWorkspaceMetadata> => {
		const entry = workspaces.get(workspaceId);
		if (!entry) {
			return createEmptyWorkspaceMetadata();
		}
		const refresh = refreshWorkspace(workspaceId);
		let deadlineTimer: NodeJS.Timeout | undefined;
		const deadline = new Promise<null>((resolvePromise) => {
			deadlineTimer = setTimeout(() => {
				resolvePromise(null);
			}, WORKSPACE_METADATA_INITIAL_WAIT_MS);
			deadlineTimer.unref();
		});
		try {
			const settled = await Promise.race([refresh, deadline]);
			return settled ?? buildWorkspaceMetadataSnapshot(entry);
		} finally {
			if (deadlineTimer) {
				clearTimeout(deadlineTimer);
			}
		}
	};

	return {
		connectWorkspace: async ({ workspaceId, workspacePath, board }) => {
			const entry = updateWorkspaceEntry({ workspaceId, workspacePath, board });
			entry.subscriberCount += 1;
			ensureWorkspaceTimer(workspaceId, entry);
			return await refreshWithDeadline(workspaceId);
		},
		readSnapshot: (workspaceId) => {
			const entry = workspaces.get(workspaceId);
			return entry ? buildWorkspaceMetadataSnapshot(entry) : createEmptyWorkspaceMetadata();
		},
		updateWorkspaceState: async ({ workspaceId, workspacePath, board }) => {
			const entry = updateWorkspaceEntry({ workspaceId, workspacePath, board });
			if (entry.subscriberCount === 0) {
				return buildWorkspaceMetadataSnapshot(entry);
			}
			return await refreshWithDeadline(workspaceId);
		},
		disconnectWorkspace: (workspaceId) => {
			const entry = workspaces.get(workspaceId);
			if (!entry) {
				return;
			}
			entry.subscriberCount = Math.max(0, entry.subscriberCount - 1);
			if (entry.subscriberCount > 0) {
				return;
			}
			stopWorkspaceTimer(entry);
			workspaces.delete(workspaceId);
		},
		disposeWorkspace: (workspaceId) => {
			const entry = workspaces.get(workspaceId);
			if (!entry) {
				return;
			}
			stopWorkspaceTimer(entry);
			workspaces.delete(workspaceId);
		},
		close: () => {
			for (const entry of workspaces.values()) {
				stopWorkspaceTimer(entry);
			}
			workspaces.clear();
		},
	};
}
