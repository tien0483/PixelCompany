import { useCallback, useMemo, useState } from "react";
import { showAppToast } from "@/components/app-toaster";
import {
	type UseGitHistoryDataResult,
	useGitHistoryData,
} from "@/components/git-history/use-git-history-data";
import {
	buildTaskGitActionPrompt,
	deriveTaskBranchName,
	type TaskGitAction,
} from "@/git-actions/build-task-git-action-prompt";
import {
	resolveReviewCommitPath,
} from "@/git-actions/review-commit-branch";
import type { ReviewGitBranchedSubmit } from "@/components/board-card-review-git-actions";
import { isNativeClineAgentSelected } from "@/runtime/native-agent";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeConfigResponse,
	RuntimeGitSyncAction,
	RuntimeTaskWorkspaceInfoResponse,
} from "@/runtime/types";
import { findCardSelection } from "@/state/board-state";
import {
	getTaskWorkspaceInfo,
	getTaskWorkspaceSnapshot,
	setHomeGitSummary,
	setTaskWorkspaceInfo,
	useHomeGitStateVersionValue,
	useHomeGitSummaryValue,
	useTaskWorkspaceSnapshotValue,
	useTaskWorkspaceStateVersionValue,
} from "@/stores/workspace-metadata-store";
import type { SendTerminalInputOptions } from "@/terminal/terminal-input";
import type { BoardCard, BoardData, CardSelection } from "@/types";

type TaskGitActionSource = "card" | "agent";

interface TaskGitActionLoadingState {
	commitSource: TaskGitActionSource | null;
	prSource: TaskGitActionSource | null;
}

interface ReviewFollowOnState {
	baselineHead: string | null;
	commitHash: string | null;
	officialBranch: string;
	promptTaskBranch: string;
	needsCherryPick: boolean;
	pushAfter: boolean;
	phase: "waiting-commit" | "ready" | "failed";
	baseRef: string;
	statusMessage: string;
}

const REVIEW_COMMIT_WAIT_MS = 120_000;
const REVIEW_COMMIT_POLL_MS = 2_000;

interface UseGitActionsInput {
	currentProjectId: string | null;
	board: BoardData;
	selectedCard: CardSelection | null;
	runtimeProjectConfig: RuntimeConfigResponse | null;
	sendTaskSessionInput: (
		taskId: string,
		text: string,
		options?: SendTerminalInputOptions,
	) => Promise<{ ok: boolean; message?: string }>;
	sendTaskChatMessage: (
		taskId: string,
		text: string,
		options?: { mode?: "plan" | "act" },
	) => Promise<{ ok: boolean; message?: string }>;
	fetchTaskWorkspaceInfo: (
		task: BoardCard,
	) => Promise<RuntimeTaskWorkspaceInfoResponse | null>;
	isGitHistoryOpen: boolean;
	refreshWorkspaceState: () => Promise<void>;
}

export interface UseGitActionsResult {
	runningGitAction: RuntimeGitSyncAction | null;
	taskGitActionLoadingByTaskId: Record<string, TaskGitActionLoadingState>;
	commitTaskLoadingById: Record<string, boolean>;
	openPrTaskLoadingById: Record<string, boolean>;
	mergeTaskLoadingById: Record<string, boolean>;
	agentCommitTaskLoadingById: Record<string, boolean>;
	agentOpenPrTaskLoadingById: Record<string, boolean>;
	isSwitchingHomeBranch: boolean;
	isDeletingHomeBranch: boolean;
	isCreatingHomeBranch: boolean;
	isMergingHomeBranch: boolean;
	isRebasingHomeBranch: boolean;
	isDiscardingHomeWorkingChanges: boolean;
	gitActionError: {
		action: RuntimeGitSyncAction;
		message: string;
		output: string;
	} | null;
	gitActionErrorTitle: string;
	clearGitActionError: () => void;
	gitHistory: UseGitHistoryDataResult;
	runGitAction: (action: RuntimeGitSyncAction) => Promise<void>;
	switchHomeBranch: (branch: string) => Promise<void>;
	deleteHomeBranch: (branch: string) => Promise<void>;
	createHomeBranch: (options: {
		newBranch: string;
		startPoint: string;
	}) => Promise<void>;
	mergeHomeBranchIntoCurrent: (branch: string) => Promise<void>;
	rebaseHomeCurrentOnto: (branch: string) => Promise<void>;
	discardHomeWorkingChanges: () => Promise<void>;
	revertTaskFile: (
		taskId: string,
		baseRef: string,
		path: string,
	) => Promise<void>;
	revertTaskHunk: (
		taskId: string,
		baseRef: string,
		path: string,
		hunkIndex: number,
	) => Promise<void>;
	commitHomeChanges: (message: string) => Promise<boolean>;
	createHomePullRequest: (
		title: string,
		body: string,
		base?: string,
	) => Promise<{ ok: boolean; url: string | null }>;
	handleCommitTask: (taskId: string) => void;
	handleOpenPrTask: (taskId: string) => void;
	handleReviewCommitWithBranch: (taskId: string, input: ReviewGitBranchedSubmit) => void;
	handleCancelReviewGitForm: (taskId: string) => void;
	handleRetryReviewGitFollowOn: (taskId: string) => void;
	reviewGitStatusById: Record<string, string>;
	canRetryReviewGitFollowOnById: Record<string, boolean>;
	reviewBranchSuggestions: readonly string[];
	handleMergeTaskBranch: (taskId: string) => void;
	handleAgentCommitTask: (taskId: string) => void;
	handleAgentOpenPrTask: (taskId: string) => void;
	runAutoReviewGitAction: (
		taskId: string,
		action: TaskGitAction,
	) => Promise<boolean>;
	resetGitActionState: () => void;
}

function matchesWorkspaceInfoSelection(
	workspaceInfo: RuntimeTaskWorkspaceInfoResponse | null,
	card: BoardCard | null,
): workspaceInfo is RuntimeTaskWorkspaceInfoResponse {
	if (!workspaceInfo || !card) {
		return false;
	}
	return (
		workspaceInfo.taskId === card.id && workspaceInfo.baseRef === card.baseRef
	);
}

export function useGitActions({
	currentProjectId,
	board,
	selectedCard,
	runtimeProjectConfig,
	sendTaskSessionInput,
	sendTaskChatMessage,
	fetchTaskWorkspaceInfo,
	isGitHistoryOpen,
	refreshWorkspaceState,
}: UseGitActionsInput): UseGitActionsResult {
	const [runningGitAction, setRunningGitAction] =
		useState<RuntimeGitSyncAction | null>(null);
	const [taskGitActionLoadingByTaskId, setTaskGitActionLoadingByTaskId] =
		useState<Record<string, TaskGitActionLoadingState>>({});
	const [isSwitchingHomeBranch, setIsSwitchingHomeBranch] = useState(false);
	const [isDeletingHomeBranch, setIsDeletingHomeBranch] = useState(false);
	const [isCreatingHomeBranch, setIsCreatingHomeBranch] = useState(false);
	const [isMergingHomeBranch, setIsMergingHomeBranch] = useState(false);
	const [isRebasingHomeBranch, setIsRebasingHomeBranch] = useState(false);
	const [mergeTaskLoadingById, setMergeTaskLoadingById] = useState<Record<string, boolean>>({});
	const [reviewFollowOnById, setReviewFollowOnById] = useState<Record<string, ReviewFollowOnState>>(
		{},
	);
	const [isDiscardingHomeWorkingChanges, setIsDiscardingHomeWorkingChanges] =
		useState(false);
	const [gitActionError, setGitActionError] = useState<{
		action: RuntimeGitSyncAction;
		message: string;
		output: string;
	} | null>(null);
	const homeGitSummary = useHomeGitSummaryValue();
	const homeGitStateVersion = useHomeGitStateVersionValue();
	const selectedTaskWorkspaceSnapshot = useTaskWorkspaceSnapshotValue(
		selectedCard?.card.id ?? null,
	);
	const selectedTaskWorkspaceStateVersion = useTaskWorkspaceStateVersionValue(
		selectedCard?.card.id ?? null,
	);

	const gitHistoryTaskScope = useMemo(() => {
		if (!selectedCard) {
			return null;
		}
		return {
			taskId: selectedCard.card.id,
			baseRef: selectedCard.card.baseRef,
		};
	}, [selectedCard?.card.baseRef, selectedCard?.card.id]);

	const gitHistorySummary = useMemo(() => {
		if (!selectedCard) {
			return homeGitSummary;
		}
		if (!selectedTaskWorkspaceSnapshot) {
			return null;
		}
		return {
			currentBranch: selectedTaskWorkspaceSnapshot.branch,
			upstreamBranch: null,
			changedFiles: selectedTaskWorkspaceSnapshot.changedFiles ?? 0,
			additions: selectedTaskWorkspaceSnapshot.additions ?? 0,
			deletions: selectedTaskWorkspaceSnapshot.deletions ?? 0,
			aheadCount: 0,
			behindCount: 0,
		};
	}, [homeGitSummary, selectedCard, selectedTaskWorkspaceSnapshot]);
	const gitHistoryStateVersion = selectedCard
		? selectedTaskWorkspaceStateVersion
		: homeGitStateVersion;

	const gitHistory = useGitHistoryData({
		workspaceId: currentProjectId,
		taskScope: gitHistoryTaskScope,
		gitSummary: gitHistorySummary,
		stateVersion: gitHistoryStateVersion,
		enabled: isGitHistoryOpen,
	});
	const refreshGitHistory = gitHistory.refresh;

	const setTaskGitActionLoading = useCallback(
		(
			taskId: string,
			action: TaskGitAction,
			source: TaskGitActionSource | null,
		) => {
			setTaskGitActionLoadingByTaskId((current) => {
				const existing = current[taskId] ?? {
					commitSource: null,
					prSource: null,
				};
				const key = action === "commit" ? "commitSource" : "prSource";
				if (existing[key] === source) {
					return current;
				}
				const nextEntry: TaskGitActionLoadingState = {
					...existing,
					[key]: source,
				};
				if (nextEntry.commitSource === null && nextEntry.prSource === null) {
					const { [taskId]: _removed, ...rest } = current;
					return rest;
				}
				return {
					...current,
					[taskId]: nextEntry,
				};
			});
		},
		[],
	);

	const commitTaskLoadingById = useMemo(() => {
		const next: Record<string, boolean> = {};
		for (const [taskId, loading] of Object.entries(
			taskGitActionLoadingByTaskId,
		)) {
			if (loading.commitSource === "card") {
				next[taskId] = true;
			}
		}
		return next;
	}, [taskGitActionLoadingByTaskId]);

	const openPrTaskLoadingById = useMemo(() => {
		const next: Record<string, boolean> = {};
		for (const [taskId, loading] of Object.entries(
			taskGitActionLoadingByTaskId,
		)) {
			if (loading.prSource === "card") {
				next[taskId] = true;
			}
		}
		return next;
	}, [taskGitActionLoadingByTaskId]);

	const agentCommitTaskLoadingById = useMemo(() => {
		const next: Record<string, boolean> = {};
		for (const [taskId, loading] of Object.entries(
			taskGitActionLoadingByTaskId,
		)) {
			if (loading.commitSource === "agent") {
				next[taskId] = true;
			}
		}
		return next;
	}, [taskGitActionLoadingByTaskId]);

	const agentOpenPrTaskLoadingById = useMemo(() => {
		const next: Record<string, boolean> = {};
		for (const [taskId, loading] of Object.entries(
			taskGitActionLoadingByTaskId,
		)) {
			if (loading.prSource === "agent") {
				next[taskId] = true;
			}
		}
		return next;
	}, [taskGitActionLoadingByTaskId]);

	const shouldUseClineChatForTaskGitActions = isNativeClineAgentSelected(
		runtimeProjectConfig?.selectedAgentId ?? null,
	);

	const runTaskGitAction = useCallback(
		async (
			taskId: string,
			action: TaskGitAction,
			source: TaskGitActionSource,
			options?: { taskBranchOverride?: string },
		) => {
			const taskLoadingState = taskGitActionLoadingByTaskId[taskId];
			const actionInFlightSource =
				action === "commit"
					? taskLoadingState?.commitSource
					: taskLoadingState?.prSource;
			if (actionInFlightSource !== null && actionInFlightSource !== undefined) {
				return false;
			}
			setTaskGitActionLoading(taskId, action, source);
			try {
				const selection = findCardSelection(board, taskId);
				if (!selection) {
					showAppToast({
						intent: "danger",
						icon: "warning-sign",
						message: "Could not find the selected task card.",
						timeout: 5000,
					});
					return false;
				}
				if (selection.column.id !== "review") {
					showAppToast({
						intent: "warning",
						icon: "warning-sign",
						message:
							"Commit and PR actions are only available for tasks in Review.",
						timeout: 5000,
					});
					return false;
				}

				const snapshot = getTaskWorkspaceSnapshot(taskId);
				const snapshotWorkspaceInfo = snapshot
					? {
							taskId,
							path: snapshot.path,
							exists: true,
							baseRef: selection.card.baseRef,
							branch: snapshot.branch,
							isDetached: snapshot.isDetached,
							headCommit: snapshot.headCommit,
						}
					: null;
				const storedWorkspaceInfo = getTaskWorkspaceInfo(
					selection.card.id,
					selection.card.baseRef,
				);
				const workspaceInfo = matchesWorkspaceInfoSelection(
					storedWorkspaceInfo,
					selection.card,
				)
					? storedWorkspaceInfo
					: (snapshotWorkspaceInfo ??
						(await fetchTaskWorkspaceInfo(selection.card)));
				if (!workspaceInfo) {
					showAppToast({
						intent: "danger",
						icon: "warning-sign",
						message: "Could not resolve task workspace details.",
						timeout: 6000,
					});
					return false;
				}
				setTaskWorkspaceInfo(workspaceInfo);

				const prompt = buildTaskGitActionPrompt({
					action,
					workspaceInfo,
					taskBranchOverride: options?.taskBranchOverride,
					templates: runtimeProjectConfig
						? {
								commitPromptTemplate: runtimeProjectConfig.commitPromptTemplate,
								openPrPromptTemplate: runtimeProjectConfig.openPrPromptTemplate,
								commitPromptTemplateDefault:
									runtimeProjectConfig.commitPromptTemplateDefault,
								openPrPromptTemplateDefault:
									runtimeProjectConfig.openPrPromptTemplateDefault,
								seamCommentTagTemplate: runtimeProjectConfig.seamCommentTagTemplate,
								seamCommentTagTemplateDefault:
									runtimeProjectConfig.seamCommentTagTemplateDefault,
								commitTrailerMode: runtimeProjectConfig.commitTrailerMode,
								commitTrailerTemplate: runtimeProjectConfig.commitTrailerTemplate,
								commitTrailerTemplateDefault:
									runtimeProjectConfig.commitTrailerTemplateDefault,
							}
						: null,
					agentDisplayName: runtimeProjectConfig?.agentDisplayName,
				});
				if (shouldUseClineChatForTaskGitActions) {
					const sent = await sendTaskChatMessage(taskId, prompt, {
						mode: "act",
					});
					if (!sent.ok) {
						showAppToast({
							intent: "danger",
							icon: "warning-sign",
							message:
								sent.message ??
								"Could not send instructions to the task chat session.",
							timeout: 7000,
						});
						return false;
					}
					return true;
				}
				const typed = await sendTaskSessionInput(taskId, prompt, {
					appendNewline: false,
					mode: "paste",
				});
				if (!typed.ok) {
					showAppToast({
						intent: "danger",
						icon: "warning-sign",
						message:
							typed.message ??
							"Could not send instructions to the task session.",
						timeout: 7000,
					});
					return false;
				}
				await new Promise<void>((resolve) => {
					window.setTimeout(resolve, 200);
				});
				const submitted = await sendTaskSessionInput(taskId, "\r", {
					appendNewline: false,
				});
				if (!submitted.ok) {
					showAppToast({
						intent: "danger",
						icon: "warning-sign",
						message:
							submitted.message ??
							"Could not submit instructions to the task session.",
						timeout: 7000,
					});
					return false;
				}
				return true;
			} finally {
				setTaskGitActionLoading(taskId, action, null);
			}
		},
		[
			board,
			fetchTaskWorkspaceInfo,
			runtimeProjectConfig,
			sendTaskChatMessage,
			sendTaskSessionInput,
			setTaskGitActionLoading,
			shouldUseClineChatForTaskGitActions,
			taskGitActionLoadingByTaskId,
		],
	);

	const handleCommitTask = useCallback(
		(taskId: string) => {
			void runTaskGitAction(taskId, "commit", "card");
		},
		[runTaskGitAction],
	);

	const handleOpenPrTask = useCallback(
		(taskId: string) => {
			void runTaskGitAction(taskId, "pr", "card");
		},
		[runTaskGitAction],
	);

	const runReviewFollowOn = useCallback(
		async (taskId: string, followOn: ReviewFollowOnState) => {
			if (!currentProjectId) {
				return;
			}
			const trpcClient = getRuntimeTrpcClient(currentProjectId);
			let commitHash = followOn.commitHash;

			if (!commitHash) {
				setReviewFollowOnById((current) => ({
					...current,
					[taskId]: {
						...followOn,
						phase: "waiting-commit",
						statusMessage: "Waiting for commit…",
					},
				}));
				const deadline = Date.now() + REVIEW_COMMIT_WAIT_MS;
				while (Date.now() < deadline) {
					const selection = findCardSelection(board, taskId);
					if (selection) {
						await fetchTaskWorkspaceInfo(selection.card).catch(() => null);
					}
					const snapshot = getTaskWorkspaceSnapshot(taskId);
					const head = snapshot?.headCommit ?? null;
					if (head && head !== followOn.baselineHead) {
						commitHash = head;
						break;
					}
					await new Promise<void>((resolve) => {
						window.setTimeout(resolve, REVIEW_COMMIT_POLL_MS);
					});
				}
				if (!commitHash) {
					setReviewFollowOnById((current) => ({
						...current,
						[taskId]: {
							...followOn,
							phase: "failed",
							statusMessage: "Timed out waiting for commit. Retry when ready.",
						},
					}));
					showAppToast({
						intent: "warning",
						icon: "warning-sign",
						message: "Timed out waiting for the agent commit.",
						timeout: 7000,
					});
					return;
				}
			}

			try {
				if (followOn.needsCherryPick) {
					setReviewFollowOnById((current) => ({
						...current,
						[taskId]: {
							...followOn,
							commitHash,
							phase: "ready",
							statusMessage: "Cherry-picking…",
						},
					}));
					const cherryPick = await trpcClient.workspace.cherryPickCommit.mutate({
						taskId,
						baseRef: followOn.baseRef,
						commitHash,
						targetBranch: followOn.officialBranch,
					});
					if (!cherryPick.ok) {
						setReviewFollowOnById((current) => ({
							...current,
							[taskId]: {
								...followOn,
								commitHash,
								phase: "failed",
								statusMessage: cherryPick.error ?? "Cherry-pick failed.",
							},
						}));
						showAppToast({
							intent: "danger",
							icon: "warning-sign",
							message: cherryPick.error ?? "Cherry-pick failed.",
							timeout: 8000,
						});
						return;
					}
				}

				if (followOn.pushAfter) {
					setReviewFollowOnById((current) => ({
						...current,
						[taskId]: {
							...followOn,
							commitHash,
							phase: "ready",
							statusMessage: "Pushing…",
						},
					}));
					const pushResult = await trpcClient.workspace.pushGitBranch.mutate({
						taskId,
						baseRef: followOn.baseRef,
						branch: followOn.officialBranch,
					});
					if (!pushResult.ok) {
						setReviewFollowOnById((current) => ({
							...current,
							[taskId]: {
								...followOn,
								commitHash,
								phase: "failed",
								statusMessage: pushResult.error ?? "Push failed.",
							},
						}));
						showAppToast({
							intent: "danger",
							icon: "warning-sign",
							message: pushResult.error ?? "Push failed.",
							timeout: 8000,
						});
						return;
					}
				}

				setReviewFollowOnById((current) => {
					const { [taskId]: _removed, ...rest } = current;
					return rest;
				});
				showAppToast({
					intent: "success",
					icon: "tick",
					message: followOn.pushAfter
						? `Committed and pushed ${followOn.officialBranch}.`
						: `Committed onto ${followOn.officialBranch}.`,
					timeout: 5000,
				});
				await refreshWorkspaceState();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setReviewFollowOnById((current) => ({
					...current,
					[taskId]: {
						...followOn,
						commitHash,
						phase: "failed",
						statusMessage: message,
					},
				}));
				showAppToast({
					intent: "danger",
					icon: "warning-sign",
					message,
					timeout: 8000,
				});
			}
		},
		[board, currentProjectId, fetchTaskWorkspaceInfo, refreshWorkspaceState],
	);

	const handleReviewCommitWithBranch = useCallback(
		(taskId: string, input: ReviewGitBranchedSubmit) => {
			void (async () => {
				const selection = findCardSelection(board, taskId);
				if (!selection || !currentProjectId) {
					return;
				}

				let refNames: string[] = [];
				try {
					const trpcClient = getRuntimeTrpcClient(currentProjectId);
					const refs = await trpcClient.workspace.getGitRefs.query({
						taskId: selection.card.id,
						baseRef: selection.card.baseRef,
					});
					refNames = (refs.refs ?? [])
						.filter((ref) => ref.type === "branch")
						.map((ref) => ref.name.replace(/^refs\/heads\//, ""))
						.filter((name) => name.length > 0);
				} catch {
					refNames = [selection.card.baseRef].filter(Boolean);
				}

				const derivedTaskBranch = deriveTaskBranchName(taskId);
				const resolved = resolveReviewCommitPath({
					officialBranch: input.officialBranch,
					derivedTaskBranch,
					refNames,
					existingMode: input.existingMode,
				});
				if ("error" in resolved) {
					showAppToast({
						intent: "warning",
						icon: "warning-sign",
						message: resolved.error,
						timeout: 5000,
					});
					return;
				}

				const baselineHead = getTaskWorkspaceSnapshot(taskId)?.headCommit ?? null;
				const kicked = await runTaskGitAction(taskId, "commit", "card", {
					taskBranchOverride: resolved.promptTaskBranch,
				});
				if (!kicked) {
					return;
				}

				const needsFollowOn = resolved.needsCherryPick || input.mode === "commit-and-push";
				if (!needsFollowOn) {
					showAppToast({
						intent: "success",
						icon: "tick",
						message: "Commit instructions sent to the task session.",
						timeout: 4000,
					});
					return;
				}

				const followOn: ReviewFollowOnState = {
					baselineHead,
					commitHash: null,
					officialBranch: resolved.pushBranch,
					promptTaskBranch: resolved.promptTaskBranch,
					needsCherryPick: resolved.needsCherryPick,
					pushAfter: input.mode === "commit-and-push",
					phase: "waiting-commit",
					baseRef: selection.card.baseRef,
					statusMessage: "Waiting for commit…",
				};
				setReviewFollowOnById((current) => ({ ...current, [taskId]: followOn }));
				await runReviewFollowOn(taskId, followOn);
			})();
		},
		[board, currentProjectId, runReviewFollowOn, runTaskGitAction],
	);

	const handleCancelReviewGitForm = useCallback((taskId: string) => {
		setReviewFollowOnById((current) => {
			if (!(taskId in current)) {
				return current;
			}
			const { [taskId]: _removed, ...rest } = current;
			return rest;
		});
	}, []);

	const handleRetryReviewGitFollowOn = useCallback(
		(taskId: string) => {
			const followOn = reviewFollowOnById[taskId];
			if (!followOn) {
				return;
			}
			void runReviewFollowOn(taskId, {
				...followOn,
				phase: followOn.commitHash ? "ready" : "waiting-commit",
				statusMessage: followOn.commitHash ? "Retrying…" : "Waiting for commit…",
			});
		},
		[reviewFollowOnById, runReviewFollowOn],
	);

	const reviewGitStatusById = useMemo(() => {
		const next: Record<string, string> = {};
		for (const [taskId, followOn] of Object.entries(reviewFollowOnById)) {
			next[taskId] = followOn.statusMessage;
		}
		return next;
	}, [reviewFollowOnById]);

	const canRetryReviewGitFollowOnById = useMemo(() => {
		const next: Record<string, boolean> = {};
		for (const [taskId, followOn] of Object.entries(reviewFollowOnById)) {
			next[taskId] = followOn.phase === "failed";
		}
		return next;
	}, [reviewFollowOnById]);

	const reviewBranchSuggestions = useMemo(() => {
		const fromHistory = gitHistory.refs
			.filter((ref) => ref.type === "branch")
			.map((ref) => ref.name.replace(/^refs\/heads\//, ""))
			.filter((name) => name.length > 0);
		if (fromHistory.length > 0) {
			return fromHistory;
		}
		return homeGitSummary?.currentBranch ? [homeGitSummary.currentBranch] : [];
	}, [gitHistory.refs, homeGitSummary?.currentBranch]);

	const mergeTaskBranch = useCallback(
		async (taskId: string) => {
			if (!currentProjectId || mergeTaskLoadingById[taskId]) {
				return;
			}
			const selection = findCardSelection(board, taskId);
			if (!selection) {
				showAppToast({
					intent: "danger",
					icon: "warning-sign",
					message: "Could not find the task to merge.",
					timeout: 6000,
				});
				return;
			}
			setMergeTaskLoadingById((current) => ({ ...current, [taskId]: true }));
			try {
				const workspaceInfo = await fetchTaskWorkspaceInfo(selection.card);
				if (!workspaceInfo) {
					showAppToast({
						intent: "danger",
						icon: "warning-sign",
						message: "Could not resolve task workspace details.",
						timeout: 6000,
					});
					return;
				}
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const payload = await trpcClient.workspace.mergeTaskBranch.mutate({
					taskId: workspaceInfo.taskId,
					baseRef: workspaceInfo.baseRef,
				});
				if (!payload.ok) {
					if (payload.summary) {
						setHomeGitSummary(payload.summary);
					}
					showAppToast({
						intent: "danger",
						icon: "warning-sign",
						message: `Merge failed. ${payload.error ?? ""}`.trim(),
						timeout: 8000,
					});
					return;
				}
				setHomeGitSummary(payload.summary);
				refreshGitHistory();
				await refreshWorkspaceState();
				showAppToast({
					intent: "success",
					icon: "tick",
					message: `Merged ${payload.branch} into ${payload.baseRef}.`,
					timeout: 5000,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				showAppToast({
					intent: "danger",
					icon: "warning-sign",
					message: `Merge failed. ${message}`,
					timeout: 8000,
				});
			} finally {
				setMergeTaskLoadingById((current) => {
					const { [taskId]: _removed, ...rest } = current;
					return rest;
				});
			}
		},
		[
			board,
			currentProjectId,
			fetchTaskWorkspaceInfo,
			mergeTaskLoadingById,
			refreshGitHistory,
			refreshWorkspaceState,
		],
	);

	const handleMergeTaskBranch = useCallback(
		(taskId: string) => {
			void mergeTaskBranch(taskId);
		},
		[mergeTaskBranch],
	);

	const handleAgentCommitTask = useCallback(
		(taskId: string) => {
			void runTaskGitAction(taskId, "commit", "agent");
		},
		[runTaskGitAction],
	);

	const handleAgentOpenPrTask = useCallback(
		(taskId: string) => {
			void runTaskGitAction(taskId, "pr", "agent");
		},
		[runTaskGitAction],
	);

	const runGitAction = useCallback(
		async (action: RuntimeGitSyncAction) => {
			if (!currentProjectId || runningGitAction || isSwitchingHomeBranch) {
				return;
			}
			setRunningGitAction(action);
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const payload = await trpcClient.workspace.runGitSyncAction.mutate({
					action,
				});
				if (!payload.ok || !payload.summary) {
					const errorMessage = payload.error ?? `${action} failed.`;
					const output = payload.output ?? "";
					const fallbackSummary = payload.summary ?? null;
					if (fallbackSummary) {
						setHomeGitSummary(fallbackSummary);
					}
					setGitActionError({
						action,
						message: errorMessage,
						output,
					});
					return;
				}
				setHomeGitSummary(payload.summary);
				refreshGitHistory();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setGitActionError({
					action,
					message,
					output: "",
				});
			} finally {
				setRunningGitAction(null);
			}
		},
		[
			currentProjectId,
			isSwitchingHomeBranch,
			refreshGitHistory,
			runningGitAction,
		],
	);

	const switchHomeBranch = useCallback(
		async (branch: string) => {
			const normalizedBranch = branch.trim();
			const currentBranch = homeGitSummary?.currentBranch ?? null;
			if (
				!currentProjectId ||
				isSwitchingHomeBranch ||
				!normalizedBranch ||
				normalizedBranch === currentBranch
			) {
				return;
			}
			setIsSwitchingHomeBranch(true);
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const payload = await trpcClient.workspace.checkoutGitBranch.mutate({
					branch: normalizedBranch,
				});
				if (!payload.ok || !payload.summary) {
					const errorMessage = payload.error ?? "Switch branch failed.";
					const fallbackSummary = payload.summary ?? null;
					if (fallbackSummary) {
						setHomeGitSummary(fallbackSummary);
					}
					showAppToast({
						intent: "danger",
						icon: "warning-sign",
						message: `Could not switch to ${normalizedBranch}. ${errorMessage}`,
						timeout: 7000,
					});
					return;
				}
				setHomeGitSummary(payload.summary);
				refreshGitHistory();
				await refreshWorkspaceState();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				showAppToast({
					intent: "danger",
					icon: "warning-sign",
					message: `Could not switch to ${normalizedBranch}. ${message}`,
					timeout: 7000,
				});
			} finally {
				setIsSwitchingHomeBranch(false);
			}
		},
		[
			currentProjectId,
			homeGitSummary?.currentBranch,
			isSwitchingHomeBranch,
			refreshGitHistory,
			refreshWorkspaceState,
		],
	);

	const deleteHomeBranch = useCallback(
		async (branch: string) => {
			const normalizedBranch = branch.trim();
			const currentBranch = homeGitSummary?.currentBranch ?? null;
			if (
				!currentProjectId ||
				isDeletingHomeBranch ||
				!normalizedBranch ||
				normalizedBranch === currentBranch
			) {
				return;
			}
			setIsDeletingHomeBranch(true);
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const payload = await trpcClient.workspace.deleteGitBranch.mutate({
					branch: normalizedBranch,
				});
				if (!payload.ok) {
					if (payload.summary) {
						setHomeGitSummary(payload.summary);
					}
					const errorMessage = payload.error ?? "Delete branch failed.";
					showAppToast({
						intent: "danger",
						icon: "warning-sign",
						message: `Could not delete ${normalizedBranch}. ${errorMessage}`,
						timeout: 7000,
					});
					return;
				}
				setHomeGitSummary(payload.summary);
				refreshGitHistory();
				await refreshWorkspaceState();
				showAppToast({
					intent: "success",
					icon: "tick",
					message: `Deleted branch ${normalizedBranch}.`,
					timeout: 4000,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				showAppToast({
					intent: "danger",
					icon: "warning-sign",
					message: `Could not delete ${normalizedBranch}. ${message}`,
					timeout: 7000,
				});
			} finally {
				setIsDeletingHomeBranch(false);
			}
		},
		[
			currentProjectId,
			homeGitSummary?.currentBranch,
			isDeletingHomeBranch,
			refreshGitHistory,
			refreshWorkspaceState,
		],
	);

	const createHomeBranch = useCallback(
		async ({ newBranch, startPoint }: { newBranch: string; startPoint: string }) => {
			const normalizedBranch = newBranch.trim();
			const normalizedStartPoint = startPoint.trim();
			if (
				!currentProjectId ||
				isCreatingHomeBranch ||
				!normalizedBranch ||
				!normalizedStartPoint
			) {
				return;
			}
			setIsCreatingHomeBranch(true);
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const payload = await trpcClient.workspace.createGitBranch.mutate({
					newBranch: normalizedBranch,
					startPoint: normalizedStartPoint,
				});
				if (!payload.ok) {
					if (payload.summary) {
						setHomeGitSummary(payload.summary);
					}
					const errorMessage = payload.error ?? "Create branch failed.";
					showAppToast({
						intent: "danger",
						icon: "warning-sign",
						message: `Could not create ${normalizedBranch}. ${errorMessage}`,
						timeout: 7000,
					});
					return;
				}
				setHomeGitSummary(payload.summary);
				refreshGitHistory();
				await refreshWorkspaceState();
				showAppToast({
					intent: "success",
					icon: "tick",
					message: `Created branch ${normalizedBranch} from ${normalizedStartPoint}.`,
					timeout: 4000,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				showAppToast({
					intent: "danger",
					icon: "warning-sign",
					message: `Could not create ${normalizedBranch}. ${message}`,
					timeout: 7000,
				});
			} finally {
				setIsCreatingHomeBranch(false);
			}
		},
		[
			currentProjectId,
			isCreatingHomeBranch,
			refreshGitHistory,
			refreshWorkspaceState,
		],
	);

	const mergeHomeBranchIntoCurrent = useCallback(
		async (branch: string) => {
			const normalizedBranch = branch.trim();
			const currentBranch = homeGitSummary?.currentBranch ?? null;
			if (
				!currentProjectId ||
				isMergingHomeBranch ||
				!normalizedBranch ||
				normalizedBranch === currentBranch
			) {
				return;
			}
			setIsMergingHomeBranch(true);
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const payload = await trpcClient.workspace.mergeBranchIntoCurrent.mutate({
					branch: normalizedBranch,
				});
				if (!payload.ok) {
					if (payload.summary) {
						setHomeGitSummary(payload.summary);
					}
					const errorMessage = payload.error ?? "Merge failed.";
					showAppToast({
						intent: "danger",
						icon: "warning-sign",
						message: `Could not merge ${normalizedBranch} into current. ${errorMessage}`,
						timeout: 7000,
					});
					return;
				}
				setHomeGitSummary(payload.summary);
				refreshGitHistory();
				await refreshWorkspaceState();
				showAppToast({
					intent: "success",
					icon: "tick",
					message: `Merged ${normalizedBranch} into ${payload.summary.currentBranch ?? "current branch"}.`,
					timeout: 4000,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				showAppToast({
					intent: "danger",
					icon: "warning-sign",
					message: `Could not merge ${normalizedBranch} into current. ${message}`,
					timeout: 7000,
				});
			} finally {
				setIsMergingHomeBranch(false);
			}
		},
		[
			currentProjectId,
			homeGitSummary?.currentBranch,
			isMergingHomeBranch,
			refreshGitHistory,
			refreshWorkspaceState,
		],
	);

	const rebaseHomeCurrentOnto = useCallback(
		async (branch: string) => {
			const normalizedBranch = branch.trim();
			const currentBranch = homeGitSummary?.currentBranch ?? null;
			if (
				!currentProjectId ||
				isRebasingHomeBranch ||
				!normalizedBranch ||
				normalizedBranch === currentBranch
			) {
				return;
			}
			setIsRebasingHomeBranch(true);
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const payload = await trpcClient.workspace.rebaseCurrentOnto.mutate({
					branch: normalizedBranch,
				});
				if (!payload.ok) {
					if (payload.summary) {
						setHomeGitSummary(payload.summary);
					}
					const errorMessage = payload.error ?? "Rebase failed.";
					showAppToast({
						intent: "danger",
						icon: "warning-sign",
						message: `Could not rebase current onto ${normalizedBranch}. ${errorMessage}`,
						timeout: 7000,
					});
					return;
				}
				setHomeGitSummary(payload.summary);
				refreshGitHistory();
				await refreshWorkspaceState();
				showAppToast({
					intent: "success",
					icon: "tick",
					message: `Rebased ${payload.summary.currentBranch ?? "current branch"} onto ${normalizedBranch}.`,
					timeout: 4000,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				showAppToast({
					intent: "danger",
					icon: "warning-sign",
					message: `Could not rebase current onto ${normalizedBranch}. ${message}`,
					timeout: 7000,
				});
			} finally {
				setIsRebasingHomeBranch(false);
			}
		},
		[
			currentProjectId,
			homeGitSummary?.currentBranch,
			isRebasingHomeBranch,
			refreshGitHistory,
			refreshWorkspaceState,
		],
	);

	const discardHomeWorkingChanges = useCallback(async () => {
		if (!currentProjectId || isDiscardingHomeWorkingChanges) {
			return;
		}
		setIsDiscardingHomeWorkingChanges(true);
		try {
			const trpcClient = getRuntimeTrpcClient(currentProjectId);
			const payload = await trpcClient.workspace.discardGitChanges.mutate(null);
			if (!payload.ok) {
				if (payload.summary) {
					setHomeGitSummary(payload.summary);
				}
				showAppToast({
					intent: "danger",
					icon: "warning-sign",
					message: payload.error ?? "Could not discard working copy changes.",
					timeout: 7000,
				});
				return;
			}
			setHomeGitSummary(payload.summary);
			refreshGitHistory();
			showAppToast({
				intent: "success",
				icon: "tick",
				message: "Discarded working copy changes.",
				timeout: 4000,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			showAppToast({
				intent: "danger",
				icon: "warning-sign",
				message: `Could not discard working copy changes. ${message}`,
				timeout: 7000,
			});
		} finally {
			setIsDiscardingHomeWorkingChanges(false);
		}
	}, [currentProjectId, isDiscardingHomeWorkingChanges, refreshGitHistory]);

	const revertTaskFile = useCallback(
		async (taskId: string, baseRef: string, path: string): Promise<void> => {
			if (!currentProjectId) {
				return;
			}
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const payload = await trpcClient.workspace.revertGitFile.mutate({
					path,
					taskInfo: { taskId, baseRef },
				});
				if (!payload.ok) {
					showAppToast({
						intent: "danger",
						icon: "warning-sign",
						message: payload.error ?? `Could not revert ${path}.`,
						timeout: 7000,
					});
					return;
				}
				// The runtime broadcasts a workspace-state update on success, so the
				// diff refreshes on its own — no manual invalidation needed here.
				showAppToast({
					intent: "success",
					icon: "tick",
					message: `Reverted ${path}.`,
					timeout: 4000,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				showAppToast({
					intent: "danger",
					icon: "warning-sign",
					message: `Could not revert ${path}. ${message}`,
					timeout: 7000,
				});
			}
		},
		[currentProjectId],
	);

	const revertTaskHunk = useCallback(
		async (
			taskId: string,
			baseRef: string,
			path: string,
			hunkIndex: number,
		): Promise<void> => {
			if (!currentProjectId) {
				return;
			}
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const payload = await trpcClient.workspace.revertGitHunk.mutate({
					path,
					hunkIndex,
					taskInfo: { taskId, baseRef },
				});
				if (!payload.ok) {
					showAppToast({
						intent: "danger",
						icon: "warning-sign",
						message: payload.error ?? `Could not revert hunk in ${path}.`,
						timeout: 7000,
					});
					return;
				}
				showAppToast({
					intent: "success",
					icon: "tick",
					message: `Reverted a hunk in ${path}.`,
					timeout: 4000,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				showAppToast({
					intent: "danger",
					icon: "warning-sign",
					message: `Could not revert hunk in ${path}. ${message}`,
					timeout: 7000,
				});
			}
		},
		[currentProjectId],
	);

	const commitHomeChanges = useCallback(
		async (message: string): Promise<boolean> => {
			if (!currentProjectId) {
				return false;
			}
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const payload =
					await trpcClient.workspace.commitWorkspaceChanges.mutate({ message });
				if (!payload.ok) {
					showAppToast({
						intent: "danger",
						icon: "warning-sign",
						message: payload.error ?? "Could not commit changes.",
						timeout: 7000,
					});
					return false;
				}
				setHomeGitSummary(payload.summary);
				refreshGitHistory();
				showAppToast({
					intent: "success",
					icon: "tick",
					message: "Committed changes.",
					timeout: 4000,
				});
				return true;
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				showAppToast({
					intent: "danger",
					icon: "warning-sign",
					message: `Could not commit changes. ${errorMessage}`,
					timeout: 7000,
				});
				return false;
			}
		},
		[currentProjectId, refreshGitHistory],
	);

	const createHomePullRequest = useCallback(
		async (
			title: string,
			body: string,
			base?: string,
		): Promise<{ ok: boolean; url: string | null }> => {
			if (!currentProjectId) {
				return { ok: false, url: null };
			}
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const payload = await trpcClient.workspace.createPullRequest.mutate({
					title,
					body,
					base,
				});
				if (!payload.ok) {
					showAppToast({
						intent: "danger",
						icon: "warning-sign",
						message: payload.error ?? "Could not create pull request.",
						timeout: 8000,
					});
					return { ok: false, url: null };
				}
				showAppToast({
					intent: "success",
					icon: "tick",
					message: payload.url
						? `Pull request created: ${payload.url}`
						: "Pull request created.",
					timeout: 6000,
				});
				return { ok: true, url: payload.url };
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				showAppToast({
					intent: "danger",
					icon: "warning-sign",
					message: `Could not create pull request. ${errorMessage}`,
					timeout: 8000,
				});
				return { ok: false, url: null };
			}
		},
		[currentProjectId],
	);

	const runAutoReviewGitAction = useCallback(
		async (taskId: string, action: TaskGitAction) => {
			return await runTaskGitAction(taskId, action, "card");
		},
		[runTaskGitAction],
	);

	const resetGitActionState = useCallback(() => {
		setRunningGitAction(null);
		setTaskGitActionLoadingByTaskId({});
		setIsSwitchingHomeBranch(false);
		setIsDeletingHomeBranch(false);
		setIsCreatingHomeBranch(false);
		setMergeTaskLoadingById({});
		setReviewFollowOnById({});
		setIsDiscardingHomeWorkingChanges(false);
		setGitActionError(null);
	}, []);

	const gitActionErrorTitle = useMemo(() => {
		if (!gitActionError) {
			return "Git action failed";
		}
		if (gitActionError.action === "fetch") {
			return "Fetch failed";
		}
		if (gitActionError.action === "pull") {
			return "Pull failed";
		}
		if (gitActionError.action === "stash") {
			return "Stash failed";
		}
		if (gitActionError.action === "stash-pop") {
			return "Stash pop failed";
		}
		return "Push failed";
	}, [gitActionError]);

	return {
		runningGitAction,
		taskGitActionLoadingByTaskId,
		commitTaskLoadingById,
		openPrTaskLoadingById,
		mergeTaskLoadingById,
		agentCommitTaskLoadingById,
		agentOpenPrTaskLoadingById,
		isSwitchingHomeBranch,
		isDeletingHomeBranch,
		isCreatingHomeBranch,
		isMergingHomeBranch,
		isRebasingHomeBranch,
		isDiscardingHomeWorkingChanges,
		gitActionError,
		gitActionErrorTitle,
		clearGitActionError: () => {
			setGitActionError(null);
		},
		gitHistory,
		runGitAction,
		switchHomeBranch,
		deleteHomeBranch,
		createHomeBranch,
		mergeHomeBranchIntoCurrent,
		rebaseHomeCurrentOnto,
		discardHomeWorkingChanges,
		revertTaskFile,
		revertTaskHunk,
		commitHomeChanges,
		createHomePullRequest,
		handleCommitTask,
		handleOpenPrTask,
		handleReviewCommitWithBranch,
		handleCancelReviewGitForm,
		handleRetryReviewGitFollowOn,
		reviewGitStatusById,
		canRetryReviewGitFollowOnById,
		reviewBranchSuggestions,
		handleMergeTaskBranch,
		handleAgentCommitTask,
		handleAgentOpenPrTask,
		runAutoReviewGitAction,
		resetGitActionState,
	};
}
