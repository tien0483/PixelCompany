import { TRPCError } from "@trpc/server";
import type { ClineTaskSessionService } from "../cline-sdk/cline-task-session-service";
import type {
	RuntimeGitCheckoutResponse,
	RuntimeGitDeleteBranchResponse,
	RuntimeGitMergeBranchResponse,
	RuntimeGitDiscardResponse,
	RuntimeGitRevertResponse,
	RuntimeGitSummaryResponse,
	RuntimeGitSyncAction,
	RuntimeGitSyncResponse,
	RuntimeTaskSessionSummary,
	RuntimeWorkspaceChangesMode,
	RuntimeWorkspaceFileSearchResponse,
	RuntimeWorkspaceStateResponse,
} from "../core/api-contract";
import {
	parseGitCheckoutRequest,
	parseGitDeleteBranchRequest,
	parseGitMergeBranchRequest,
	parseWorktreeDeleteRequest,
	parseWorktreeEnsureRequest,
} from "../core/api-validation";
import { saveWorkspaceState, WorkspaceStateConflictError } from "../state/workspace-state";
import type { TerminalSessionManager } from "../terminal/session-manager";
import {
	createEmptyWorkspaceChangesResponse,
	getWorkspaceChanges,
	getWorkspaceChangesBetweenRefs,
	getWorkspaceChangesFromRef,
} from "../workspace/get-workspace-changes";
import { createPullRequest } from "../workspace/git-gh";
import { getBlame, getCommitDiff, getGitLog, getGitRefs } from "../workspace/git-history";
import {
	commitWorkspaceChanges,
	discardGitChanges,
	getGitSyncSummary,
	getMergeConflicts,
	resolveMergeConflict,
	revertGitFile,
	revertGitHunk,
	runGitCheckoutAction,
	runGitDeleteBranchAction,
	runGitMergeBranchAction,
	runGitSyncAction,
} from "../workspace/git-sync";
import { listGitWorktrees } from "../workspace/git-worktree-inventory";
import { searchWorkspaceFiles } from "../workspace/search-workspace-files";
import {
	deleteTaskWorktree,
	ensureTaskWorktreeIfDoesntExist,
	getTaskWorkspaceInfo,
	resolveTaskCwd,
} from "../workspace/task-worktree";
import type { RuntimeTrpcContext } from "./app-router";

export interface CreateWorkspaceApiDependencies {
	ensureTerminalManagerForWorkspace: (workspaceId: string, repoPath: string) => Promise<TerminalSessionManager>;
	getScopedClineTaskSessionService: (scope: {
		workspaceId: string;
		workspacePath: string;
	}) => Promise<ClineTaskSessionService>;
	broadcastRuntimeWorkspaceStateUpdated: (workspaceId: string, workspacePath: string) => Promise<void> | void;
	broadcastRuntimeProjectsUpdated: (preferredCurrentProjectId: string | null) => Promise<void> | void;
	buildWorkspaceStateSnapshot: (workspaceId: string, workspacePath: string) => Promise<RuntimeWorkspaceStateResponse>;
}

function normalizeOptionalTaskWorkspaceScopeInput(
	input: { taskId: string; baseRef: string } | null,
): { taskId: string; baseRef: string } | null {
	if (!input) {
		return null;
	}
	const taskId = input.taskId.trim();
	const baseRef = input.baseRef.trim();
	if (!taskId || !baseRef) {
		throw new Error("baseRef query parameter requires taskId.");
	}
	return {
		taskId,
		baseRef,
	};
}

function normalizeRequiredTaskWorkspaceScopeInput(input: {
	taskId: string;
	baseRef: string;
	mode?: RuntimeWorkspaceChangesMode;
}): {
	taskId: string;
	baseRef: string;
	mode: RuntimeWorkspaceChangesMode;
} {
	const taskId = input.taskId.trim();
	const baseRef = input.baseRef.trim();
	if (!taskId) {
		throw new Error("Missing taskId query parameter.");
	}
	if (!baseRef) {
		throw new Error("Missing baseRef query parameter.");
	}
	const mode: RuntimeWorkspaceChangesMode = input.mode ?? "working_copy";
	return {
		taskId,
		baseRef,
		mode,
	};
}

function isActiveTaskSessionState(summary: RuntimeTaskSessionSummary | null): boolean {
	return summary?.state === "running" || summary?.state === "awaiting_review";
}

function selectLastTurnSummary(
	terminalSummary: RuntimeTaskSessionSummary | null,
	clineSummary: RuntimeTaskSessionSummary | null,
): RuntimeTaskSessionSummary | null {
	if (!terminalSummary) {
		return clineSummary;
	}
	if (!clineSummary) {
		return terminalSummary;
	}
	const terminalIsActive = isActiveTaskSessionState(terminalSummary);
	const clineIsActive = isActiveTaskSessionState(clineSummary);
	if (terminalIsActive !== clineIsActive) {
		return clineIsActive ? clineSummary : terminalSummary;
	}
	if (terminalSummary.updatedAt !== clineSummary.updatedAt) {
		return terminalSummary.updatedAt > clineSummary.updatedAt ? terminalSummary : clineSummary;
	}
	if (clineSummary.agentId === "cline" && terminalSummary.agentId !== "cline") {
		return clineSummary;
	}
	return terminalSummary;
}

const EMPTY_GIT_SYNC_SUMMARY = {
	currentBranch: null,
	upstreamBranch: null,
	changedFiles: 0,
	additions: 0,
	deletions: 0,
	aheadCount: 0,
	behindCount: 0,
} as const;

function createEmptyGitSummaryErrorResponse(error: unknown): RuntimeGitSummaryResponse {
	const message = error instanceof Error ? error.message : String(error);
	return {
		ok: false,
		summary: EMPTY_GIT_SYNC_SUMMARY,
		error: message,
	};
}

function createEmptyGitSyncErrorResponse(action: RuntimeGitSyncAction, error: unknown): RuntimeGitSyncResponse {
	const message = error instanceof Error ? error.message : String(error);
	return {
		ok: false,
		action,
		summary: EMPTY_GIT_SYNC_SUMMARY,
		output: "",
		error: message,
	};
}

function createEmptyGitCheckoutErrorResponse(error: unknown): RuntimeGitCheckoutResponse {
	const message = error instanceof Error ? error.message : String(error);
	return {
		ok: false,
		branch: "",
		summary: EMPTY_GIT_SYNC_SUMMARY,
		output: "",
		error: message,
	};
}

function createEmptyGitDeleteBranchErrorResponse(error: unknown): RuntimeGitDeleteBranchResponse {
	const message = error instanceof Error ? error.message : String(error);
	return {
		ok: false,
		branch: "",
		summary: EMPTY_GIT_SYNC_SUMMARY,
		output: "",
		error: message,
	};
}

function createEmptyGitMergeBranchErrorResponse(error: unknown): RuntimeGitMergeBranchResponse {
	const message = error instanceof Error ? error.message : String(error);
	return {
		ok: false,
		branch: "",
		baseRef: "",
		summary: EMPTY_GIT_SYNC_SUMMARY,
		output: "",
		error: message,
	};
}

function createEmptyGitDiscardErrorResponse(error: unknown): RuntimeGitDiscardResponse {
	const message = error instanceof Error ? error.message : String(error);
	return {
		ok: false,
		summary: EMPTY_GIT_SYNC_SUMMARY,
		output: "",
		error: message,
	};
}

function createEmptyGitRevertErrorResponse(error: unknown): RuntimeGitRevertResponse {
	const message = error instanceof Error ? error.message : String(error);
	return {
		ok: false,
		summary: EMPTY_GIT_SYNC_SUMMARY,
		output: "",
		error: message,
	};
}

async function resolveGitOpCwd(
	workspacePath: string,
	taskInfo: { taskId: string; baseRef: string } | null | undefined,
): Promise<string> {
	const taskScope = normalizeOptionalTaskWorkspaceScopeInput(taskInfo ?? null);
	if (!taskScope) {
		return workspacePath;
	}
	return await resolveTaskCwd({
		cwd: workspacePath,
		taskId: taskScope.taskId,
		baseRef: taskScope.baseRef,
		ensure: false,
	});
}

function isMissingTaskWorktreeError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	return error.message.startsWith("Task worktree not found for task ");
}

export function createWorkspaceApi(deps: CreateWorkspaceApiDependencies): RuntimeTrpcContext["workspaceApi"] {
	return {
		loadGitSummary: async (workspaceScope, input) => {
			try {
				const taskScope = normalizeOptionalTaskWorkspaceScopeInput(input);
				let summaryCwd = workspaceScope.workspacePath;
				if (taskScope) {
					summaryCwd = await resolveTaskCwd({
						cwd: workspaceScope.workspacePath,
						taskId: taskScope.taskId,
						baseRef: taskScope.baseRef,
						ensure: false,
					});
				}
				const summary = await getGitSyncSummary(summaryCwd);
				return {
					ok: true,
					summary,
				} satisfies RuntimeGitSummaryResponse;
			} catch (error) {
				return createEmptyGitSummaryErrorResponse(error);
			}
		},
		runGitSyncAction: async (workspaceScope, input) => {
			try {
				return await runGitSyncAction({
					cwd: workspaceScope.workspacePath,
					action: input.action,
				});
			} catch (error) {
				return createEmptyGitSyncErrorResponse(input.action, error);
			}
		},
		checkoutGitBranch: async (workspaceScope, input) => {
			try {
				const body = parseGitCheckoutRequest(input);
				const response = await runGitCheckoutAction({
					cwd: workspaceScope.workspacePath,
					branch: body.branch,
				});
				if (response.ok) {
					void deps.broadcastRuntimeWorkspaceStateUpdated(
						workspaceScope.workspaceId,
						workspaceScope.workspacePath,
					);
				}
				return response;
			} catch (error) {
				return createEmptyGitCheckoutErrorResponse(error);
			}
		},
		deleteGitBranch: async (workspaceScope, input) => {
			try {
				const body = parseGitDeleteBranchRequest(input);
				const response = await runGitDeleteBranchAction({
					cwd: workspaceScope.workspacePath,
					branch: body.branch,
					force: body.force,
				});
				if (response.ok) {
					void deps.broadcastRuntimeWorkspaceStateUpdated(
						workspaceScope.workspaceId,
						workspaceScope.workspacePath,
					);
				}
				return response;
			} catch (error) {
				return createEmptyGitDeleteBranchErrorResponse(error);
			}
		},
		mergeTaskBranch: async (workspaceScope, input) => {
			try {
				const body = parseGitMergeBranchRequest(input);
				const info = await getTaskWorkspaceInfo({
					cwd: workspaceScope.workspacePath,
					taskId: body.taskId,
					baseRef: body.baseRef,
				});
				if (!info.exists) {
					throw new Error("Task worktree not found. Start the task before merging.");
				}
				if (!info.branch || info.isDetached) {
					throw new Error("Task has no committed branch yet. Run Commit on the task first.");
				}
				const inventory = await listGitWorktrees(workspaceScope.workspacePath);
				if (!inventory.ok) {
					throw new Error(inventory.error ?? "Could not list git worktrees.");
				}
				const baseWorktree = inventory.worktrees.find((entry) => entry.branch === body.baseRef);
				if (!baseWorktree) {
					throw new Error(`Check out '${body.baseRef}' in a worktree before merging.`);
				}
				const response = await runGitMergeBranchAction({
					cwd: baseWorktree.path,
					branch: info.branch,
					baseRef: body.baseRef,
				});
				if (response.ok) {
					void deps.broadcastRuntimeWorkspaceStateUpdated(
						workspaceScope.workspaceId,
						workspaceScope.workspacePath,
					);
				}
				return response;
			} catch (error) {
				return createEmptyGitMergeBranchErrorResponse(error);
			}
		},
		discardGitChanges: async (workspaceScope, input) => {
			try {
				const taskScope = normalizeOptionalTaskWorkspaceScopeInput(input);
				let discardCwd = workspaceScope.workspacePath;
				if (taskScope) {
					discardCwd = await resolveTaskCwd({
						cwd: workspaceScope.workspacePath,
						taskId: taskScope.taskId,
						baseRef: taskScope.baseRef,
						ensure: false,
					});
				}
				const response = await discardGitChanges({
					cwd: discardCwd,
				});
				if (response.ok) {
					void deps.broadcastRuntimeWorkspaceStateUpdated(
						workspaceScope.workspaceId,
						workspaceScope.workspacePath,
					);
				}
				return response;
			} catch (error) {
				return createEmptyGitDiscardErrorResponse(error);
			}
		},
		revertGitFile: async (workspaceScope, input) => {
			try {
				const cwd = await resolveGitOpCwd(workspaceScope.workspacePath, input.taskInfo ?? null);
				const response = await revertGitFile({ cwd, path: input.path });
				if (response.ok) {
					void deps.broadcastRuntimeWorkspaceStateUpdated(
						workspaceScope.workspaceId,
						workspaceScope.workspacePath,
					);
				}
				return response;
			} catch (error) {
				return createEmptyGitRevertErrorResponse(error);
			}
		},
		revertGitHunk: async (workspaceScope, input) => {
			try {
				const cwd = await resolveGitOpCwd(workspaceScope.workspacePath, input.taskInfo ?? null);
				const response = await revertGitHunk({ cwd, path: input.path, hunkIndex: input.hunkIndex });
				if (response.ok) {
					void deps.broadcastRuntimeWorkspaceStateUpdated(
						workspaceScope.workspaceId,
						workspaceScope.workspacePath,
					);
				}
				return response;
			} catch (error) {
				return createEmptyGitRevertErrorResponse(error);
			}
		},
		commitWorkspaceChanges: async (workspaceScope, input) => {
			try {
				const cwd = await resolveGitOpCwd(workspaceScope.workspacePath, input.taskInfo ?? null);
				const response = await commitWorkspaceChanges({ cwd, message: input.message, paths: input.paths });
				if (response.ok) {
					void deps.broadcastRuntimeWorkspaceStateUpdated(
						workspaceScope.workspaceId,
						workspaceScope.workspacePath,
					);
				}
				return response;
			} catch (error) {
				return createEmptyGitRevertErrorResponse(error);
			}
		},
		listWorktrees: async (workspaceScope) => {
			try {
				return await listGitWorktrees(workspaceScope.workspacePath);
			} catch (error) {
				return { ok: false, worktrees: [], error: error instanceof Error ? error.message : String(error) };
			}
		},
		getBlame: async (workspaceScope, input) => {
			try {
				const cwd = await resolveGitOpCwd(workspaceScope.workspacePath, input.taskInfo ?? null);
				return await getBlame({ cwd, path: input.path });
			} catch (error) {
				return {
					ok: false,
					path: input.path,
					lines: [],
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
		getMergeConflicts: async (workspaceScope, input) => {
			try {
				const cwd = await resolveGitOpCwd(workspaceScope.workspacePath, input);
				return await getMergeConflicts({ cwd });
			} catch (error) {
				return { ok: false, conflicts: [], error: error instanceof Error ? error.message : String(error) };
			}
		},
		resolveMergeConflict: async (workspaceScope, input) => {
			try {
				const cwd = await resolveGitOpCwd(workspaceScope.workspacePath, input.taskInfo ?? null);
				const response = await resolveMergeConflict({
					cwd,
					path: input.path,
					side: input.side,
					content: input.content,
				});
				if (response.ok) {
					void deps.broadcastRuntimeWorkspaceStateUpdated(
						workspaceScope.workspaceId,
						workspaceScope.workspacePath,
					);
				}
				return response;
			} catch (error) {
				return createEmptyGitRevertErrorResponse(error);
			}
		},
		createPullRequest: async (workspaceScope, input) => {
			try {
				const cwd = await resolveGitOpCwd(workspaceScope.workspacePath, input.taskInfo ?? null);
				return await createPullRequest({ cwd, title: input.title, body: input.body, base: input.base });
			} catch (error) {
				return { ok: false, url: null, output: "", error: error instanceof Error ? error.message : String(error) };
			}
		},
		loadChanges: async (workspaceScope, input) => {
			const normalizedInput = normalizeRequiredTaskWorkspaceScopeInput(input);
			let taskCwd: string;
			try {
				taskCwd = await resolveTaskCwd({
					cwd: workspaceScope.workspacePath,
					taskId: normalizedInput.taskId,
					baseRef: normalizedInput.baseRef,
					ensure: false,
				});
			} catch (error) {
				if (!isMissingTaskWorktreeError(error)) {
					throw error;
				}
				return await createEmptyWorkspaceChangesResponse(workspaceScope.workspacePath);
			}
			if (normalizedInput.mode === "last_turn") {
				const terminalManager = await deps.ensureTerminalManagerForWorkspace(
					workspaceScope.workspaceId,
					workspaceScope.workspacePath,
				);
				const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
				const summary = selectLastTurnSummary(
					terminalManager.getSummary(normalizedInput.taskId),
					clineTaskSessionService.getSummary(normalizedInput.taskId),
				);
				const fromCheckpoint = summary?.previousTurnCheckpoint;
				const toCheckpoint = summary?.latestTurnCheckpoint;
				if (!toCheckpoint) {
					return await createEmptyWorkspaceChangesResponse(taskCwd);
				}
				if (summary?.state === "running" || !fromCheckpoint) {
					return await getWorkspaceChangesFromRef({
						cwd: taskCwd,
						fromRef: toCheckpoint.commit,
					});
				}
				return await getWorkspaceChangesBetweenRefs({
					cwd: taskCwd,
					fromRef: fromCheckpoint.commit,
					toRef: toCheckpoint.commit,
				});
			}
			return await getWorkspaceChanges(taskCwd);
		},
		ensureWorktree: async (workspaceScope, input) => {
			const body = parseWorktreeEnsureRequest(input);
			return await ensureTaskWorktreeIfDoesntExist({
				cwd: workspaceScope.workspacePath,
				taskId: body.taskId,
				baseRef: body.baseRef,
			});
		},
		deleteWorktree: async (workspaceScope, input) => {
			const body = parseWorktreeDeleteRequest(input);
			return await deleteTaskWorktree({
				repoPath: workspaceScope.workspacePath,
				taskId: body.taskId,
			});
		},
		loadTaskContext: async (workspaceScope, input) => {
			const normalizedInput = normalizeRequiredTaskWorkspaceScopeInput(input);
			return await getTaskWorkspaceInfo({
				cwd: workspaceScope.workspacePath,
				taskId: normalizedInput.taskId,
				baseRef: normalizedInput.baseRef,
			});
		},
		searchFiles: async (workspaceScope, input) => {
			const query = input.query.trim();
			const limit = input.limit;
			const files = await searchWorkspaceFiles(workspaceScope.workspacePath, query, limit);
			return {
				query,
				files,
			} satisfies RuntimeWorkspaceFileSearchResponse;
		},
		loadState: async (workspaceScope) => {
			return await deps.buildWorkspaceStateSnapshot(workspaceScope.workspaceId, workspaceScope.workspacePath);
		},
		notifyStateUpdated: async (workspaceScope) => {
			void deps.broadcastRuntimeWorkspaceStateUpdated(workspaceScope.workspaceId, workspaceScope.workspacePath);
			void deps.broadcastRuntimeProjectsUpdated(workspaceScope.workspaceId);
			return {
				ok: true,
			};
		},
		saveState: async (workspaceScope, input) => {
			try {
				const terminalManager = await deps.ensureTerminalManagerForWorkspace(
					workspaceScope.workspaceId,
					workspaceScope.workspacePath,
				);
				for (const summary of terminalManager.listSummaries()) {
					input.sessions[summary.taskId] = summary;
				}
				const response = await saveWorkspaceState(workspaceScope.workspacePath, input);
				void deps.broadcastRuntimeWorkspaceStateUpdated(workspaceScope.workspaceId, workspaceScope.workspacePath);
				void deps.broadcastRuntimeProjectsUpdated(workspaceScope.workspaceId);
				return response;
			} catch (error) {
				if (error instanceof WorkspaceStateConflictError) {
					throw new TRPCError({
						code: "CONFLICT",
						message: error.message,
						cause: {
							currentRevision: error.currentRevision,
						},
					});
				}
				throw error;
			}
		},
		loadWorkspaceChanges: async (workspaceScope) => {
			return await getWorkspaceChanges(workspaceScope.workspacePath);
		},
		loadGitLog: async (workspaceScope, input) => {
			const taskScope = normalizeOptionalTaskWorkspaceScopeInput(input.taskScope ?? null);
			let logCwd = workspaceScope.workspacePath;
			if (taskScope) {
				logCwd = await resolveTaskCwd({
					cwd: workspaceScope.workspacePath,
					taskId: taskScope.taskId,
					baseRef: taskScope.baseRef,
					ensure: false,
				});
			}
			return await getGitLog({
				cwd: logCwd,
				ref: input.ref ?? null,
				refs: input.refs ?? null,
				maxCount: input.maxCount,
				skip: input.skip,
			});
		},
		loadGitRefs: async (workspaceScope, input) => {
			const taskScope = normalizeOptionalTaskWorkspaceScopeInput(input ?? null);
			let refsCwd = workspaceScope.workspacePath;
			if (taskScope) {
				refsCwd = await resolveTaskCwd({
					cwd: workspaceScope.workspacePath,
					taskId: taskScope.taskId,
					baseRef: taskScope.baseRef,
					ensure: false,
				});
			}
			return await getGitRefs(refsCwd);
		},
		loadCommitDiff: async (workspaceScope, input) => {
			const taskScope = normalizeOptionalTaskWorkspaceScopeInput(input.taskScope ?? null);
			let diffCwd = workspaceScope.workspacePath;
			if (taskScope) {
				diffCwd = await resolveTaskCwd({
					cwd: workspaceScope.workspacePath,
					taskId: taskScope.taskId,
					baseRef: taskScope.baseRef,
					ensure: false,
				});
			}
			return await getCommitDiff({
				cwd: diffCwd,
				commitHash: input.commitHash,
			});
		},
	};
}
