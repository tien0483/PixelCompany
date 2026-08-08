import { TRPCError } from "@trpc/server";
import type { ClineTaskSessionService } from "../cline-sdk/cline-task-session-service";
import type {
	RuntimeGitCheckoutResponse,
	RuntimeGitCherryPickResponse,
	RuntimeGitCreateBranchResponse,
	RuntimeGitDeleteBranchResponse,
	RuntimeGitDiscardResponse,
	RuntimeGitMergeBranchResponse,
	RuntimeGitMergeIntoCurrentResponse,
	RuntimeGitPushBranchResponse,
	RuntimeGitRebaseCurrentOntoResponse,
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
	parseGitCherryPickRequest,
	parseGitCreateBranchRequest,
	parseGitDeleteBranchRequest,
	parseGitMergeBranchRequest,
	parseGitMergeIntoCurrentRequest,
	parseGitPushBranchRequest,
	parseGitRebaseCurrentOntoRequest,
	parseWorktreeDeleteRequest,
	parseWorktreeEnsureRequest,
} from "../core/api-validation";
import { hasLiveChainMemberSharingWorktree } from "../core/task-board-mutations";
import { loadWorkspaceState, saveWorkspaceState, WorkspaceStateConflictError } from "../state/workspace-state";
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
	cleanGitStash,
	commitWorkspaceChanges,
	discardGitChanges,
	getGitSyncSummary,
	getMergeConflicts,
	resolveMergeConflict,
	revertGitFile,
	revertGitHunk,
	runGitCheckoutAction,
	runGitCherryPickAction,
	runGitCreateBranchAction,
	runGitDeleteBranchAction,
	runGitMergeBranchAction,
	runGitMergeIntoCurrentAction,
	runGitPushBranchAction,
	runGitRebaseCurrentOntoAction,
	runGitSyncAction,
} from "../workspace/git-sync";
import { cleanMergedWorktrees } from "../workspace/git-worktree-cleanup";
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

function createEmptyGitCreateBranchErrorResponse(error: unknown): RuntimeGitCreateBranchResponse {
	const message = error instanceof Error ? error.message : String(error);
	return {
		ok: false,
		branch: "",
		startPoint: "",
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

function createEmptyGitMergeIntoCurrentErrorResponse(error: unknown): RuntimeGitMergeIntoCurrentResponse {
	const message = error instanceof Error ? error.message : String(error);
	return {
		ok: false,
		branch: "",
		summary: EMPTY_GIT_SYNC_SUMMARY,
		output: "",
		error: message,
	};
}

function createEmptyGitRebaseCurrentOntoErrorResponse(error: unknown): RuntimeGitRebaseCurrentOntoResponse {
	const message = error instanceof Error ? error.message : String(error);
	return {
		ok: false,
		branch: "",
		summary: EMPTY_GIT_SYNC_SUMMARY,
		output: "",
		error: message,
	};
}

function createEmptyGitCherryPickErrorResponse(error: unknown): RuntimeGitCherryPickResponse {
	const message = error instanceof Error ? error.message : String(error);
	return {
		ok: false,
		commitHash: "",
		targetBranch: "",
		summary: EMPTY_GIT_SYNC_SUMMARY,
		output: "",
		error: message,
	};
}

function createEmptyGitPushBranchErrorResponse(error: unknown): RuntimeGitPushBranchResponse {
	const message = error instanceof Error ? error.message : String(error);
	return {
		ok: false,
		branch: "",
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
		createGitBranch: async (workspaceScope, input) => {
			try {
				const body = parseGitCreateBranchRequest(input);
				const response = await runGitCreateBranchAction({
					cwd: workspaceScope.workspacePath,
					newBranch: body.newBranch,
					startPoint: body.startPoint,
				});
				if (response.ok) {
					void deps.broadcastRuntimeWorkspaceStateUpdated(
						workspaceScope.workspaceId,
						workspaceScope.workspacePath,
					);
				}
				return response;
			} catch (error) {
				return createEmptyGitCreateBranchErrorResponse(error);
			}
		},
		mergeTaskBranch: async (workspaceScope, input) => {
			try {
				const body = parseGitMergeBranchRequest(input);
				const info = await getTaskWorkspaceInfo({
					cwd: workspaceScope.workspacePath,
					workspaceId: workspaceScope.workspaceId,
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
				const baseWorktree = inventory.worktrees.find((entry) => entry.branch === info.baseRef);
				if (!baseWorktree) {
					throw new Error(`Check out '${info.baseRef}' in a worktree before merging.`);
				}
				const response = await runGitMergeBranchAction({
					cwd: baseWorktree.path,
					branch: info.branch,
					baseRef: info.baseRef,
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
		mergeBranchIntoCurrent: async (workspaceScope, input) => {
			try {
				const body = parseGitMergeIntoCurrentRequest(input);
				const response = await runGitMergeIntoCurrentAction({
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
				return createEmptyGitMergeIntoCurrentErrorResponse(error);
			}
		},
		rebaseCurrentOnto: async (workspaceScope, input) => {
			try {
				const body = parseGitRebaseCurrentOntoRequest(input);
				const response = await runGitRebaseCurrentOntoAction({
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
				return createEmptyGitRebaseCurrentOntoErrorResponse(error);
			}
		},
		cherryPickCommit: async (workspaceScope, input) => {
			try {
				const body = parseGitCherryPickRequest(input);
				const inventory = await listGitWorktrees(workspaceScope.workspacePath);
				if (!inventory.ok) {
					throw new Error(inventory.error ?? "Could not list git worktrees.");
				}
				const targetWorktree = inventory.worktrees.find((entry) => entry.branch === body.targetBranch);
				if (!targetWorktree) {
					throw new Error(`Check out '${body.targetBranch}' in a worktree before cherry-picking.`);
				}
				const response = await runGitCherryPickAction({
					cwd: targetWorktree.path,
					commitHash: body.commitHash,
					targetBranch: body.targetBranch,
				});
				if (response.ok) {
					void deps.broadcastRuntimeWorkspaceStateUpdated(
						workspaceScope.workspaceId,
						workspaceScope.workspacePath,
					);
				}
				return response;
			} catch (error) {
				return createEmptyGitCherryPickErrorResponse(error);
			}
		},
		pushGitBranch: async (workspaceScope, input) => {
			try {
				const body = parseGitPushBranchRequest(input);
				let pushCwd = workspaceScope.workspacePath;

				if (body.taskId && body.baseRef) {
					const taskCwd = await resolveTaskCwd({
						cwd: workspaceScope.workspacePath,
						taskId: body.taskId,
						baseRef: body.baseRef,
						ensure: false,
					});
					const taskSummary = await getGitSyncSummary(taskCwd);
					if (taskSummary.currentBranch === body.branch) {
						pushCwd = taskCwd;
					} else {
						const inventory = await listGitWorktrees(workspaceScope.workspacePath);
						if (!inventory.ok) {
							throw new Error(inventory.error ?? "Could not list git worktrees.");
						}
						const branchWorktree = inventory.worktrees.find((entry) => entry.branch === body.branch);
						if (!branchWorktree) {
							throw new Error(`Check out '${body.branch}' in a worktree before pushing.`);
						}
						pushCwd = branchWorktree.path;
					}
				} else {
					const inventory = await listGitWorktrees(workspaceScope.workspacePath);
					if (!inventory.ok) {
						throw new Error(inventory.error ?? "Could not list git worktrees.");
					}
					const branchWorktree = inventory.worktrees.find((entry) => entry.branch === body.branch);
					if (branchWorktree) {
						pushCwd = branchWorktree.path;
					} else {
						const homeSummary = await getGitSyncSummary(workspaceScope.workspacePath);
						if (homeSummary.currentBranch !== body.branch) {
							throw new Error(`Check out '${body.branch}' in a worktree before pushing.`);
						}
					}
				}

				const response = await runGitPushBranchAction({
					cwd: pushCwd,
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
				return createEmptyGitPushBranchErrorResponse(error);
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
		cleanMergedWorktrees: async (workspaceScope, input) => {
			try {
				const { board } = await loadWorkspaceState(workspaceScope.workspacePath);
				const response = await cleanMergedWorktrees({
					repoPath: workspaceScope.workspacePath,
					workspaceId: workspaceScope.workspaceId,
					board,
					dryRun: input?.dryRun,
				});
				if (!input?.dryRun && response.cleanedTaskIds.length > 0) {
					void deps.broadcastRuntimeWorkspaceStateUpdated(
						workspaceScope.workspaceId,
						workspaceScope.workspacePath,
					);
				}
				return response;
			} catch (error) {
				return {
					ok: false,
					cleanedTaskIds: [],
					skipped: [],
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
		cleanStash: async (workspaceScope) => {
			try {
				return await cleanGitStash(workspaceScope.workspacePath);
			} catch (error) {
				return {
					ok: false,
					clearedCount: 0,
					output: "",
					error: error instanceof Error ? error.message : String(error),
				};
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
			// Defense in depth: chain followers share their chain root's worktree. Every UI
			// caller is expected to resolve the owner and check for live members first (see
			// use-linked-backlog-task-actions.ts, use-board-interactions.ts), but this guard
			// protects any future/other caller from deleting a worktree a live chain member
			// still depends on.
			const { board } = await loadWorkspaceState(workspaceScope.workspacePath);
			if (hasLiveChainMemberSharingWorktree(board, body.taskId, body.taskId)) {
				return {
					ok: false,
					removed: false,
					error: "Worktree is shared with a live chain member and cannot be deleted yet.",
				};
			}
			const result = await deleteTaskWorktree({
				repoPath: workspaceScope.workspacePath,
				taskId: body.taskId,
			});
			if (result.ok) {
				// Best effort: an orphaned scrollback snapshot for a deleted worktree is
				// harmless but pointless to keep around. Route through the manager (rather
				// than a fresh store instance) so a live entry's memoized restoredSnapshot
				// also gets invalidated, not just the on-disk file.
				const terminalManager = await deps.ensureTerminalManagerForWorkspace(
					workspaceScope.workspaceId,
					workspaceScope.workspacePath,
				);
				await terminalManager.deleteTerminalSnapshot(body.taskId);
			}
			return result;
		},
		loadTaskContext: async (workspaceScope, input) => {
			const normalizedInput = normalizeRequiredTaskWorkspaceScopeInput(input);
			// Chain followers share their chain root's worktree: resolve the path from the
			// owner id when the caller supplied one, but report back the requested taskId so
			// the frontend's cache stays keyed on the card it asked about (not the owner).
			const worktreeTaskId = input.worktreeTaskId?.trim() || normalizedInput.taskId;
			const info = await getTaskWorkspaceInfo({
				cwd: workspaceScope.workspacePath,
				workspaceId: workspaceScope.workspaceId,
				taskId: worktreeTaskId,
				baseRef: normalizedInput.baseRef,
			});
			return { ...info, taskId: normalizedInput.taskId };
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
