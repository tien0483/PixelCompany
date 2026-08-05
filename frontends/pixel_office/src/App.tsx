// Main React composition root for the browser app.
// Keep this file focused on wiring top-level hooks and surfaces together, and
// push runtime-specific orchestration down into hooks and service modules.

import { buildLaunchTagAllowlistUpdateNotice } from "@runtime-task-launch-tag-messages";
import { FolderOpen } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AddProjectDialog } from "@/components/add-project-dialog";
import { notifyError, showAppToast } from "@/components/app-toaster";
import { CardDetailView } from "@/components/card-detail-view";
import { ClearTrashDialog } from "@/components/clear-trash-dialog";
import { DebugDialog } from "@/components/debug-dialog";
import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import {
	CommitComposerDialog,
	PullRequestDialog,
} from "@/components/git-composer-dialogs";
import { GitHistoryView } from "@/components/git-history-view";
import {
	ConflictsDialog,
	WorktreesDialog,
} from "@/components/git-inspector-dialogs";
import { HomeTriplePane } from "@/components/home-triple-pane";
import { KanbanBoard } from "@/components/kanban-board";
import { PlanEditorView } from "@/components/plan-editor/plan-editor-view";
import { ProjectNavigationPanel } from "@/components/project-navigation-panel";
import {
	RuntimeSettingsDialog,
	type RuntimeSettingsSection,
} from "@/components/runtime-settings-dialog";
import { StartupOnboardingDialog } from "@/components/startup-onboarding-dialog";
import { TaskCreateDialog } from "@/components/task-create-dialog";
import { TaskInlineCreateCard } from "@/components/task-inline-create-card";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogBody,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { UpdateNotificationController } from "@/components/update-notification-controller";
import { createInitialBoardData } from "@/data/board-data";
import { createIdleTaskSession } from "@/hooks/app-utils";
import { KanbanAccessBlockedFallback } from "@/hooks/kanban-access-blocked-fallback";
import { RuntimeDisconnectedFallback } from "@/hooks/runtime-disconnected-fallback";
import { useAppHotkeys } from "@/hooks/use-app-hotkeys";
import { useBoardInteractions } from "@/hooks/use-board-interactions";
import { useDebugTools } from "@/hooks/use-debug-tools";
import { useDetailTaskNavigation } from "@/hooks/use-detail-task-navigation";
import { useDocumentVisibility } from "@/hooks/use-document-visibility";
import { useFeaturebaseFeedbackWidget } from "@/hooks/use-featurebase-feedback-widget";
import { useGitActions } from "@/hooks/use-git-actions";
import { useKanbanAccessGate } from "@/hooks/use-kanban-access-gate";
import { useOpenWorkspace } from "@/hooks/use-open-workspace";
import {
	parseRemovedProjectPathFromStreamError,
	useProjectNavigation,
} from "@/hooks/use-project-navigation";
import { useProjectUiState } from "@/hooks/use-project-ui-state";
import { useReviewReadyNotifications } from "@/hooks/use-review-ready-notifications";
import { useReviewStalenessAlert } from "@/hooks/use-review-staleness-alert";
import { useShortcutActions } from "@/hooks/use-shortcut-actions";
import { useStartupOnboarding } from "@/hooks/use-startup-onboarding";
import { useTaskBranchOptions } from "@/hooks/use-task-branch-options";
import { useTaskEditor } from "@/hooks/use-task-editor";
import { useSavedPlans } from "@/hooks/use-saved-plans";
import { useTaskSessions } from "@/hooks/use-task-sessions";
import { useBacklogAutorunScheduler } from "@/hooks/use-backlog-autorun-scheduler";
import { useTaskStartActions } from "@/hooks/use-task-start-actions";
import { useTerminalPanels } from "@/hooks/use-terminal-panels";
import { useWorkspaceSync } from "@/hooks/use-workspace-sync";
import { ManagerAccountsView } from "@/manager/manager-accounts-view";
import { resolveCreateTaskDefaultAgentId } from "@/manager/task-account-picker";
import { OfficeView } from "@/office/office-view";
import { useOfficeViewState } from "@/office/use-office-view-state";
import { LayoutCustomizationsProvider } from "@/resize/layout-customizations";
import { ResizableBottomPane } from "@/resize/resizable-bottom-pane";
import { useProjectNavigationLayout } from "@/resize/use-project-navigation-layout";
import {
	getTaskAgentNavbarHint,
	isTaskAgentSetupSatisfied,
	selectLatestTaskChatMessageForTask,
	selectTaskChatMessagesForTask,
} from "@/runtime/native-agent";
import { fetchRuntimeBlame } from "@/runtime/runtime-config-query";
import type {
	RuntimeClineReasoningEffort,
	RuntimeSavedPlan,
	RuntimeTaskLaunchSettings,
	RuntimeTaskSessionSummary,
} from "@/runtime/types";
import { useRuntimeProjectConfig } from "@/runtime/use-runtime-project-config";
import { useTerminalConnectionReady } from "@/runtime/use-terminal-connection-ready";
import { useWorkspacePersistence } from "@/runtime/use-workspace-persistence";
import { saveWorkspaceState } from "@/runtime/workspace-state-query";
import {
	applyTaskDetailClineSettingsChange,
	clearTaskAutoRun,
	findCardSelection,
	setTaskLaunchSettings,
	setTaskManagerAccount,
} from "@/state/board-state";
import { isTaskInChain } from "@/state/chain-groups";
import {
	getTaskWorkspaceInfo,
	getTaskWorkspaceSnapshot,
	replaceWorkspaceMetadata,
	resetWorkspaceMetadataStore,
	useHomeGitSummaryValue,
} from "@/stores/workspace-metadata-store";
import { DEFAULT_MAX_RUNNING_TASKS, LocalStorageKey } from "@/storage/local-storage-store";
import { useTerminalThemeColors } from "@/terminal/theme-colors";
import type { BoardData } from "@/types";
import { useNumberLocalStorageValue } from "@/utils/react-use";

export default function App(): ReactElement {
	const terminalThemeColors = useTerminalThemeColors();
	const [board, setBoard] = useState<BoardData>(() => createInitialBoardData());
	const [sessions, setSessions] = useState<
		Record<string, RuntimeTaskSessionSummary>
	>({});
	const [canPersistWorkspaceState, setCanPersistWorkspaceState] =
		useState(false);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [settingsInitialSection, setSettingsInitialSection] =
		useState<RuntimeSettingsSection | null>(null);
	const [homeSidebarSection, setHomeSidebarSection] = useState<
		"projects" | "manager" | "plans"
	>("projects");
	const [managerSettingsFocusToken, setManagerSettingsFocusToken] = useState(0);
	const [isClearTrashDialogOpen, setIsClearTrashDialogOpen] = useState(false);
	const [isGitHistoryOpen, setIsGitHistoryOpen] = useState(false);
	const [editingPlan, setEditingPlan] = useState<RuntimeSavedPlan | null>(null);
	const [isCommitDialogOpen, setIsCommitDialogOpen] = useState(false);
	const [isPullRequestDialogOpen, setIsPullRequestDialogOpen] = useState(false);
	const [isWorktreesDialogOpen, setIsWorktreesDialogOpen] = useState(false);
	const [isConflictsDialogOpen, setIsConflictsDialogOpen] = useState(false);
	const homeGitSummary = useHomeGitSummaryValue();
	const [pendingTaskStartAfterEditId, setPendingTaskStartAfterEditId] =
		useState<string | null>(null);
	const taskEditorResetRef = useRef<() => void>(() => {});
	const lastStreamErrorRef = useRef<string | null>(null);
	const handleProjectSwitchStart = useCallback(() => {
		setCanPersistWorkspaceState(false);
		setIsGitHistoryOpen(false);
		setEditingPlan(null);
		setPendingTaskStartAfterEditId(null);
		taskEditorResetRef.current();
	}, []);
	const {
		currentProjectId,
		projects,
		workspaceState: streamedWorkspaceState,
		workspaceMetadata,
		latestTaskChatMessage,
		taskChatMessagesByTaskId,
		latestTaskReadyForReview,
		latestMcpAuthStatuses,
		clineSessionContextVersion,
		manager,
		streamError,
		isRuntimeDisconnected,
		hasReceivedSnapshot,
		navigationCurrentProjectId,
		removingProjectId,
		hasNoProjects,
		isProjectSwitching,
		handleSelectProject,
		handleAddProject,
		handleAddProjectSuccess,
		handleRemoveProject,
		handleClearProjectSelection,
		isAddProjectDialogOpen,
		setIsAddProjectDialogOpen,
		pendingNativeGitInitPath,
		resetProjectNavigationState,
	} = useProjectNavigation({
		onProjectSwitchStart: handleProjectSwitchStart,
	});
	const activeNotificationWorkspaceId = navigationCurrentProjectId;
	const isDocumentVisible = useDocumentVisibility();
	const isInitialRuntimeLoad =
		!hasReceivedSnapshot &&
		currentProjectId === null &&
		projects.length === 0 &&
		!streamError;
	const isAwaitingWorkspaceSnapshot =
		currentProjectId !== null && streamedWorkspaceState === null;
	const {
		config: runtimeProjectConfig,
		isLoading: isRuntimeProjectConfigLoading,
		refresh: refreshRuntimeProjectConfig,
	} = useRuntimeProjectConfig(currentProjectId);
	const { isBlocked: isKanbanAccessBlocked, refresh: refreshKanbanAccess } =
		useKanbanAccessGate({
			workspaceId: currentProjectId,
		});
	const isTaskAgentReady = isTaskAgentSetupSatisfied(runtimeProjectConfig);
	const settingsWorkspaceId = navigationCurrentProjectId ?? currentProjectId;
	const {
		config: settingsRuntimeProjectConfig,
		refresh: refreshSettingsRuntimeProjectConfig,
	} = useRuntimeProjectConfig(settingsWorkspaceId);
	const featurebaseFeedbackState = useFeaturebaseFeedbackWidget({
		workspaceId: settingsWorkspaceId,
		clineProviderSettings:
			settingsRuntimeProjectConfig?.clineProviderSettings ?? null,
	});
	const {
		isStartupOnboardingDialogOpen,
		handleOpenStartupOnboardingDialog,
		handleCloseStartupOnboardingDialog,
		handleSelectOnboardingAgent,
		handleOnboardingClineSetupSaved,
	} = useStartupOnboarding({
		currentProjectId,
		runtimeProjectConfig,
		isRuntimeProjectConfigLoading,
		isTaskAgentReady,
		refreshRuntimeProjectConfig,
		refreshSettingsRuntimeProjectConfig,
	});
	const {
		debugModeEnabled,
		isDebugDialogOpen,
		isResetAllStatePending,
		handleOpenDebugDialog,
		handleShowStartupOnboardingDialog,
		handleDebugDialogOpenChange,
		handleResetAllState,
	} = useDebugTools({
		runtimeProjectConfig,
		settingsRuntimeProjectConfig,
		onOpenStartupOnboardingDialog: handleOpenStartupOnboardingDialog,
	});
	const {
		markConnectionReady: markTerminalConnectionReady,
		prepareWaitForConnection: prepareWaitForTerminalConnectionReady,
	} = useTerminalConnectionReady();
	const readyForReviewNotificationsEnabled =
		runtimeProjectConfig?.readyForReviewNotificationsEnabled ?? true;
	const shortcuts = runtimeProjectConfig?.shortcuts ?? [];
	const selectedShortcutLabel = useMemo(() => {
		if (shortcuts.length === 0) {
			return null;
		}
		const configured = runtimeProjectConfig?.selectedShortcutLabel ?? null;
		if (
			configured &&
			shortcuts.some((shortcut) => shortcut.label === configured)
		) {
			return configured;
		}
		return shortcuts[0]?.label ?? null;
	}, [runtimeProjectConfig?.selectedShortcutLabel, shortcuts]);
	const {
		upsertSession,
		ensureTaskWorkspace,
		startTaskSession,
		stopTaskSession,
		pauseTaskSession,
		resumeTaskSession,
		sendTaskSessionInput,
		sendTaskChatMessage,
		cancelTaskChatTurn,
		fetchTaskChatMessages,
		cleanupTaskWorkspace,
		fetchTaskWorkspaceInfo,
	} = useTaskSessions({
		currentProjectId,
		setSessions,
	});

	const {
		workspacePath,
		workspaceGit,
		workspaceRevision,
		setWorkspaceRevision,
		workspaceHydrationNonce,
		isWorkspaceStateRefreshing,
		isWorkspaceMetadataPending,
		refreshWorkspaceState,
		resetWorkspaceSyncState,
	} = useWorkspaceSync({
		currentProjectId,
		streamedWorkspaceState,
		hasNoProjects,
		hasReceivedSnapshot,
		isDocumentVisible,
		setBoard,
		setSessions,
		setCanPersistWorkspaceState,
	});
	const { selectedTaskId, selectedCard, setSelectedTaskId, handleBack } =
		useDetailTaskNavigation({
			board,
			currentProjectId,
			isAwaitingWorkspaceSnapshot,
			isInitialRuntimeLoad,
			isProjectSwitching,
			isWorkspaceMetadataPending,
			onDetailClosed: () => {
				setIsGitHistoryOpen(false);
				setEditingPlan(null);
			},
		});

	useEffect(() => {
		replaceWorkspaceMetadata(workspaceMetadata);
	}, [workspaceMetadata]);

	useEffect(() => {
		if (!isProjectSwitching) {
			return;
		}
		resetWorkspaceMetadataStore();
	}, [isProjectSwitching]);

	const {
		displayedProjects,
		navigationProjectPath,
		shouldShowProjectLoadingState,
		isProjectListLoading,
		shouldUseNavigationPath,
	} = useProjectUiState({
		board,
		canPersistWorkspaceState,
		currentProjectId,
		projects,
		navigationCurrentProjectId,
		selectedTaskId,
		streamError,
		isProjectSwitching,
		isInitialRuntimeLoad,
		isAwaitingWorkspaceSnapshot,
		isWorkspaceMetadataPending,
		hasReceivedSnapshot,
	});

	useReviewReadyNotifications({
		activeWorkspaceId: activeNotificationWorkspaceId,
		board,
		isDocumentVisible,
		latestTaskReadyForReview,
		taskSessions: sessions,
		readyForReviewNotificationsEnabled,
		workspacePath,
	});

	useReviewStalenessAlert({ board });

	const { createTaskBranchOptions, defaultTaskBranchRef } =
		useTaskBranchOptions({ workspaceGit });
	const queueTaskStartAfterEdit = useCallback((taskId: string) => {
		setPendingTaskStartAfterEditId(taskId);
	}, []);

	const managedManagerAccounts = useMemo(
		() =>
			(manager?.accounts ?? []).filter(
				(account) =>
					account.provider === "claude" || account.provider === "cursor",
			),
		[manager?.accounts],
	);
	const createTaskDefaultAgentId = useMemo(
		() =>
			resolveCreateTaskDefaultAgentId({
				accounts: managedManagerAccounts,
				activeAccountId: manager?.activeAccountId ?? null,
				selectedAgentId: runtimeProjectConfig?.selectedAgentId ?? null,
				installedAgentIds: (runtimeProjectConfig?.agents ?? [])
					.filter((agent) => agent.installed)
					.map((agent) => agent.id),
			}),
		[
			managedManagerAccounts,
			manager?.activeAccountId,
			runtimeProjectConfig?.agents,
			runtimeProjectConfig?.selectedAgentId,
		],
	);

	const {
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
		editTaskAgentId,
		setEditTaskAgentId,
		editTaskClineSettings,
		setEditTaskClineSettings,
		editTaskLaunchSettings,
		setEditTaskLaunchSettings,
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
	} = useTaskEditor({
		board,
		setBoard,
		currentProjectId,
		createTaskBranchOptions,
		defaultTaskBranchRef,
		selectedAgentId: createTaskDefaultAgentId,
		setSelectedTaskId,
		queueTaskStartAfterEdit,
	});
	const { plans: savedPlans, refresh: refreshSavedPlans } = useSavedPlans(currentProjectId);

	useEffect(() => {
		if (!isInlineTaskCreateOpen && !editingTaskId) {
			return;
		}
		void refreshSavedPlans();
	}, [editingTaskId, isInlineTaskCreateOpen, refreshSavedPlans]);

	useEffect(() => {
		taskEditorResetRef.current = resetTaskEditorState;
	}, [resetTaskEditorState]);

	useEffect(() => {
		if (!isProjectSwitching) {
			return;
		}
		resetWorkspaceSyncState();
	}, [isProjectSwitching, resetWorkspaceSyncState]);

	useEffect(() => {
		if (!isProjectSwitching) {
			return;
		}
		resetTaskEditorState();
	}, [isProjectSwitching, resetTaskEditorState]);

	const {
		runningGitAction,
		taskGitActionLoadingByTaskId,
		commitTaskLoadingById,
		openPrTaskLoadingById,
		mergeTaskLoadingById,
		agentCommitTaskLoadingById,
		agentOpenPrTaskLoadingById,
		isDiscardingHomeWorkingChanges,
		gitActionError,
		gitActionErrorTitle,
		clearGitActionError,
		gitHistory,
		runGitAction,
		switchHomeBranch,
		deleteHomeBranch,
		isDeletingHomeBranch,
		createHomeBranch,
		isCreatingHomeBranch,
		cherryPickOntoHomeHead,
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
		handleOpenReviewGitForm,
		handleRetryReviewGitFollowOn,
		reviewGitStatusById,
		canRetryReviewGitFollowOnById,
		reviewBranchSuggestionsByTaskId,
		handleMergeTaskBranch,
		handleAgentCommitTask,
		handleAgentOpenPrTask,
		runAutoReviewGitAction,
		resetGitActionState,
	} = useGitActions({
		currentProjectId,
		board,
		selectedCard,
		runtimeProjectConfig,
		sendTaskSessionInput,
		sendTaskChatMessage,
		fetchTaskWorkspaceInfo,
		isGitHistoryOpen,
		refreshWorkspaceState,
	});
	const agentCommand = runtimeProjectConfig?.effectiveCommand ?? null;
	const {
		homeTerminalTaskId,
		isHomeTerminalOpen,
		isHomeTerminalStarting,
		homeTerminalPaneHeight,
		isDetailTerminalOpen,
		detailTerminalTaskId,
		isDetailTerminalStarting,
		detailTerminalPaneHeight,
		isHomeTerminalExpanded,
		isDetailTerminalExpanded,
		setHomeTerminalPaneHeight,
		setDetailTerminalPaneHeight,
		handleToggleExpandHomeTerminal,
		handleToggleExpandDetailTerminal,
		handleToggleHomeTerminal,
		handleToggleDetailTerminal,
		handleSendAgentCommandToHomeTerminal,
		handleSendAgentCommandToDetailTerminal,
		prepareTerminalForShortcut,
		resetBottomTerminalLayoutCustomizations,
		collapseHomeTerminal,
		collapseDetailTerminal,
		closeHomeTerminal,
		closeDetailTerminal,
		resetTerminalPanelsState,
	} = useTerminalPanels({
		currentProjectId,
		selectedCard,
		workspaceGit,
		agentCommand,
		upsertSession,
		sendTaskSessionInput,
	});
	const homeTerminalSummary = sessions[homeTerminalTaskId] ?? null;
	const {
		runningShortcutLabel,
		handleSelectShortcutLabel,
		handleRunShortcut,
		handleCreateShortcut,
	} = useShortcutActions({
		currentProjectId,
		selectedShortcutLabel: runtimeProjectConfig?.selectedShortcutLabel,
		shortcuts,
		refreshRuntimeProjectConfig,
		prepareTerminalForShortcut,
		prepareWaitForTerminalConnectionReady,
		sendTaskSessionInput,
	});

	const persistWorkspaceStateAsync = useCallback(
		async (input: {
			workspaceId: string;
			payload: Parameters<typeof saveWorkspaceState>[1];
		}) => await saveWorkspaceState(input.workspaceId, input.payload),
		[],
	);
	const handleWorkspaceStateConflict = useCallback(() => {
		showAppToast(
			{
				intent: "warning",
				icon: "warning-sign",
				message:
					"Workspace changed elsewhere. Synced latest state. Retry your last edit if needed.",
				timeout: 5000,
			},
			"workspace-state-conflict",
		);
	}, []);

	useWorkspacePersistence({
		board,
		sessions,
		currentProjectId,
		workspaceRevision,
		hydrationNonce: workspaceHydrationNonce,
		canPersistWorkspaceState,
		isDocumentVisible,
		isWorkspaceStateRefreshing,
		persistWorkspaceState: persistWorkspaceStateAsync,
		refetchWorkspaceState: refreshWorkspaceState,
		onWorkspaceRevisionChange: setWorkspaceRevision,
		onWorkspaceStateConflict: handleWorkspaceStateConflict,
	});

	useEffect(() => {
		if (!streamError) {
			lastStreamErrorRef.current = null;
			return;
		}
		const removedPath = parseRemovedProjectPathFromStreamError(streamError);
		if (removedPath !== null) {
			showAppToast(
				{
					intent: "danger",
					icon: "warning-sign",
					message: removedPath
						? `Project no longer exists and was removed: ${removedPath}`
						: "Project no longer exists and was removed.",
					timeout: 6000,
				},
				`project-removed-${removedPath || "unknown"}`,
			);
			lastStreamErrorRef.current = null;
			return;
		}
		if (isRuntimeDisconnected) {
			lastStreamErrorRef.current = streamError;
			return;
		}
		if (lastStreamErrorRef.current !== streamError) {
			notifyError(streamError, { key: `error:${streamError}` });
		}
		lastStreamErrorRef.current = streamError;
	}, [isRuntimeDisconnected, streamError]);

	useEffect(() => {
		resetTaskEditorState();
		setIsClearTrashDialogOpen(false);
		resetGitActionState();
		resetProjectNavigationState();
		resetTerminalPanelsState();
	}, [
		currentProjectId,
		resetGitActionState,
		resetProjectNavigationState,
		resetTaskEditorState,
		resetTerminalPanelsState,
	]);

	useEffect(() => {
		if (selectedCard) {
			return;
		}
		if (hasNoProjects || !currentProjectId) {
			if (isHomeTerminalOpen) {
				closeHomeTerminal();
			}
			return;
		}
	}, [
		closeHomeTerminal,
		currentProjectId,
		hasNoProjects,
		isHomeTerminalOpen,
		selectedCard,
	]);
	const showHomeBottomTerminal =
		!selectedCard && !hasNoProjects && isHomeTerminalOpen;
	const homeTerminalSubtitle = useMemo(
		() => workspacePath ?? navigationProjectPath ?? null,
		[navigationProjectPath, workspacePath],
	);

	const handleOpenSettings = useCallback((section?: RuntimeSettingsSection) => {
		setSettingsInitialSection(section ?? null);
		setIsSettingsOpen(true);
	}, []);
	const handleCloseGitHistory = useCallback(() => {
		setIsGitHistoryOpen(false);
	}, []);
	const onWillOpenOffice = useCallback(() => {
		setIsGitHistoryOpen(false);
		setEditingPlan(null);
		// Office lives in the home layout, which stays visibility:hidden while a
		// task detail is open — leave detail first or the toggle looks like a no-op.
		if (selectedCard) {
			handleBack();
		}
	}, [handleBack, selectedCard]);
	const { isOfficeOpen, handleToggleOffice } = useOfficeViewState({
		currentProjectId,
		hasNoProjects,
		onWillOpenOffice,
	});
	const handleToggleGitHistory = useCallback(() => {
		if (hasNoProjects) {
			return;
		}
		setIsGitHistoryOpen((current) => !current);
	}, [hasNoProjects]);

	const {
		handleProgrammaticCardMoveReady,
		handleCreateDependency,
		handleDeleteDependency,
		handleReorderChain,
		handleBreakChain,
		handleRunChain,
		handleDragEnd,
		handleStartTask,
		handleDeleteBacklogTask,
		handleStartAllBacklogTasks,
		handleDetailTaskDragEnd,
		handleCardSelect,
		handleMoveToTrash,
		handleMoveReviewCardToTrash,
		handleRestoreTaskFromTrash,
		handleCancelAutomaticTaskAction,
		handleOpenClearTrash,
		handleConfirmClearTrash,
		handleAddReviewComments,
		handleSendReviewComments,
		moveToTrashLoadingById,
		trashTaskCount,
		handleRestartTaskWithCurrentAccount,
		restartTaskLoadingById,
	} = useBoardInteractions({
		board,
		setBoard,
		sessions,
		setSessions,
		selectedCard,
		selectedTaskId,
		currentProjectId,
		setSelectedTaskId,
		setIsClearTrashDialogOpen,
		setIsGitHistoryOpen,
		stopTaskSession,
		cleanupTaskWorkspace,
		ensureTaskWorkspace,
		startTaskSession,
		fetchTaskWorkspaceInfo,
		sendTaskSessionInput,
		readyForReviewNotificationsEnabled,
		taskGitActionLoadingByTaskId,
		runAutoReviewGitAction,
	});

	const {
		handleCreateAndStartTask,
		handleCreateAndStartTasks,
		handleCreateStartAndOpenTask,
		handleStartTaskFromBoard,
		handleStartAllBacklogTasksFromBoard,
	} = useTaskStartActions({
		board,
		handleCreateTask,
		handleCreateTasks,
		handleStartTask,
		handleStartAllBacklogTasks,
		setSelectedTaskId,
	});

	const [maxRunningTasks, setMaxRunningTasks] = useNumberLocalStorageValue(
		LocalStorageKey.MaxRunningTasks,
		DEFAULT_MAX_RUNNING_TASKS,
	);
	useBacklogAutorunScheduler({
		board,
		maxRunningTasks,
		onStartTask: handleStartTaskFromBoard,
	});
	const handleCancelAutoRun = useCallback(
		(taskId: string) => {
			setBoard((currentBoard) => {
				const result = clearTaskAutoRun(currentBoard, taskId);
				return result.updated ? result.board : currentBoard;
			});
		},
		[setBoard],
	);

	useAppHotkeys({
		selectedCard,
		isDetailTerminalOpen,
		isHomeTerminalOpen: showHomeBottomTerminal,
		isHomeGitHistoryOpen: !selectedCard && isGitHistoryOpen,
		canUseCreateTaskShortcut: !hasNoProjects && currentProjectId !== null,
		handleToggleDetailTerminal,
		handleToggleHomeTerminal,
		handleToggleExpandDetailTerminal,
		handleToggleExpandHomeTerminal: handleToggleExpandHomeTerminal,
		handleOpenCreateTask,
		handleOpenSettings,
		handleToggleGitHistory,
		handleCloseGitHistory,
		handleToggleOffice,
		onStartAllTasks: handleStartAllBacklogTasksFromBoard,
	});

	useEffect(() => {
		if (!pendingTaskStartAfterEditId) {
			return;
		}
		const selection = findCardSelection(board, pendingTaskStartAfterEditId);
		if (!selection || selection.column.id !== "backlog") {
			return;
		}
		handleStartTaskFromBoard(pendingTaskStartAfterEditId);
		setPendingTaskStartAfterEditId(null);
	}, [board, handleStartTaskFromBoard, pendingTaskStartAfterEditId]);

	const detailSession = selectedCard
		? (sessions[selectedCard.card.id] ??
			createIdleTaskSession(selectedCard.card.id))
		: null;
	const detailTerminalSummary = detailTerminalTaskId
		? (sessions[detailTerminalTaskId] ?? null)
		: null;
	const detailTerminalSubtitle = useMemo(() => {
		if (!selectedCard) {
			return null;
		}
		return (
			getTaskWorkspaceInfo(selectedCard.card.id, selectedCard.card.baseRef)
				?.path ??
			getTaskWorkspaceSnapshot(selectedCard.card.id)?.path ??
			null
		);
	}, [selectedCard]);

	const runtimeHint = useMemo(() => {
		return getTaskAgentNavbarHint(runtimeProjectConfig, {
			shouldUseNavigationPath,
		});
	}, [runtimeProjectConfig, shouldUseNavigationPath]);

	const activeWorkspacePath = selectedCard
		? (getTaskWorkspaceInfo(selectedCard.card.id, selectedCard.card.baseRef)
				?.path ??
			getTaskWorkspaceSnapshot(selectedCard.card.id)?.path ??
			workspacePath ??
			undefined)
		: shouldUseNavigationPath
			? (navigationProjectPath ?? undefined)
			: (workspacePath ?? undefined);

	const activeWorkspaceHint = useMemo(() => {
		if (!selectedCard) {
			return undefined;
		}
		const activeSelectedTaskWorkspaceInfo = getTaskWorkspaceInfo(
			selectedCard.card.id,
			selectedCard.card.baseRef,
		);
		if (!activeSelectedTaskWorkspaceInfo) {
			return undefined;
		}
		if (!activeSelectedTaskWorkspaceInfo.exists) {
			return selectedCard.column.id === "trash"
				? "Task worktree deleted"
				: "Task worktree not created yet";
		}
		return undefined;
	}, [selectedCard]);

	const sidebarLayout = useProjectNavigationLayout();
	const handleToggleSidebar = useCallback(() => {
		sidebarLayout.setSidebarCollapsed(!sidebarLayout.isCollapsed);
	}, [sidebarLayout]);

	const navbarWorkspacePath = hasNoProjects ? undefined : activeWorkspacePath;
	const navbarWorkspaceHint = hasNoProjects ? undefined : activeWorkspaceHint;
	const navbarRuntimeHint = hasNoProjects ? undefined : runtimeHint;
	const shouldHideProjectDependentTopBarActions =
		!selectedCard &&
		(isProjectSwitching ||
			isAwaitingWorkspaceSnapshot ||
			isWorkspaceMetadataPending);

	const {
		openTargetOptions,
		selectedOpenTargetId,
		onSelectOpenTarget,
		openPlatformOverride,
		onSelectOpenPlatform,
		detectedOpenPlatform,
		onOpenWorkspace,
		canOpenWorkspace,
		isOpeningWorkspace,
	} = useOpenWorkspace({
		currentProjectId,
		workspacePath: activeWorkspacePath,
	});
	const selectedTaskChatMessages = selectTaskChatMessagesForTask(
		selectedCard?.card.id,
		taskChatMessagesByTaskId,
	);
	const latestSelectedTaskChatMessage = selectLatestTaskChatMessageForTask(
		selectedCard?.card.id,
		latestTaskChatMessage,
	);
	const defaultTaskClineProviderId =
		runtimeProjectConfig?.clineProviderSettings?.providerId ??
		runtimeProjectConfig?.clineProviderSettings?.oauthProvider ??
		null;
	const handleClineTaskSettingsChangedForTask = useCallback(
		({
			providerId,
			modelId,
			reasoningEffort,
		}: {
			providerId: string;
			modelId: string;
			reasoningEffort: RuntimeClineReasoningEffort | "";
		}) => {
			if (!selectedCard) {
				return;
			}
			const taskId = selectedCard.card.id;
			setBoard((currentBoard) => {
				const result = applyTaskDetailClineSettingsChange(
					currentBoard,
					taskId,
					{
						providerId,
						modelId,
						reasoningEffort,
					},
					{
						providerId: defaultTaskClineProviderId,
						modelId:
							runtimeProjectConfig?.clineProviderSettings?.modelId ?? null,
					},
				);
				return result.updated ? result.board : currentBoard;
			});
		},
		[defaultTaskClineProviderId, runtimeProjectConfig, selectedCard, setBoard],
	);

	const handleTaskManagerAccountChanged = useCallback(
		(taskId: string, managerAccountId: number | null) => {
			// Pins the card, not the running session: a live session keeps the account
			// it launched with until it is restarted.
			setBoard((currentBoard) => {
				const result = setTaskManagerAccount(
					currentBoard,
					taskId,
					managerAccountId,
				);
				return result.updated ? result.board : currentBoard;
			});
		},
		[setBoard],
	);

	const handleTaskAutoResumeOnUsageLimitChanged = useCallback(
		(taskId: string, enabled: boolean) => {
			// Card-level opt-in; the running session reads it at launch, so a live session
			// keeps its prior setting until restarted (same semantics as the account pin).
			setBoard((currentBoard) => ({
				...currentBoard,
				columns: currentBoard.columns.map((column) => ({
					...column,
					cards: column.cards.map((card) =>
						card.id === taskId
							? { ...card, autoResumeOnUsageLimit: enabled }
							: card,
					),
				})),
			}));
		},
		[setBoard],
	);

	const handleTaskLaunchSettingsChanged = useCallback(
		(taskId: string, nextLaunchSettings: RuntimeTaskLaunchSettings | null) => {
			let previousSettings: RuntimeTaskLaunchSettings | undefined;
			let didUpdate = false;
			setBoard((currentBoard) => {
				previousSettings = findCardSelection(currentBoard, taskId)?.card
					.taskLaunchSettings;
				const result = setTaskLaunchSettings(
					currentBoard,
					taskId,
					nextLaunchSettings,
				);
				didUpdate = result.updated;
				return result.updated ? result.board : currentBoard;
			});
			if (!didUpdate) {
				return;
			}
			// Cursor (and Claude prompt-level) skill/MCP tags are enforced via the
			// conversation. Push an allowlist update into the live session so removing
			// a chip mid-run is reflected without a full restart.
			const summary = sessions[taskId];
			if (
				summary?.state !== "running" &&
				summary?.state !== "awaiting_review"
			) {
				return;
			}
			const notice = buildLaunchTagAllowlistUpdateNotice(
				previousSettings,
				nextLaunchSettings,
			);
			if (!notice) {
				return;
			}
			void (async () => {
				// Paste + Enter matches other long prompt injections into Cursor/Claude PTYs.
				const pasted = await sendTaskSessionInput(taskId, notice, {
					mode: "paste",
					appendNewline: false,
				});
				if (!pasted.ok) {
					if (pasted.message) {
						notifyError(pasted.message);
					}
					return;
				}
				const submitted = await sendTaskSessionInput(taskId, "\r", {
					appendNewline: false,
				});
				if (!submitted.ok && submitted.message) {
					notifyError(submitted.message);
				}
			})();
		},
		[sendTaskSessionInput, sessions, setBoard],
	);

	const handleCreateDialogOpenChange = useCallback(
		(open: boolean) => {
			if (!open) {
				handleCancelCreateTask();
			}
		},
		[handleCancelCreateTask],
	);

	const inlineTaskEditor = editingTaskId ? (
		<TaskInlineCreateCard
			prompt={editTaskPrompt}
			onPromptChange={setEditTaskPrompt}
			images={editTaskImages}
			onImagesChange={setEditTaskImages}
			onCreate={handleSaveEditedTask}
			onCreateAndStart={handleSaveAndStartEditedTask}
			onCancel={handleCancelEditTask}
			startInPlanMode={editTaskStartInPlanMode}
			onStartInPlanModeChange={setEditTaskStartInPlanMode}
			planFilePath={editTaskPlanFilePath}
			onPlanFilePathChange={setEditTaskPlanFilePath}
			savedPlans={savedPlans}
			startInPlanModeDisabled={isEditTaskStartInPlanModeDisabled}
			showAutoCommitOptIn={isTaskInChain(board.dependencies, editingTaskId)}
			autoReviewEnabled={editTaskAutoReviewEnabled}
			onAutoReviewEnabledChange={(enabled) => {
				setEditTaskAutoReviewEnabled(enabled);
				if (enabled) {
					setEditTaskAutoReviewMode("commit");
				}
			}}
			workspaceId={currentProjectId}
			branchRef={editTaskBranchRef}
			branchOptions={createTaskBranchOptions}
			onBranchRefChange={setEditTaskBranchRef}
			agentId={editTaskAgentId}
			onAgentIdChange={setEditTaskAgentId}
			clineSettings={editTaskClineSettings}
			onClineSettingsChange={setEditTaskClineSettings}
			taskLaunchSettings={editTaskLaunchSettings}
			onTaskLaunchSettingsChange={setEditTaskLaunchSettings}
			defaultAgentId={createTaskDefaultAgentId}
			defaultProviderId={defaultTaskClineProviderId}
			defaultModelId={
				runtimeProjectConfig?.clineProviderSettings?.modelId ?? null
			}
			defaultReasoningEffort={
				runtimeProjectConfig?.clineProviderSettings?.reasoningEffort ?? null
			}
			managerAccounts={managedManagerAccounts}
			managerActiveAccountId={manager?.activeAccountId ?? null}
			mode="edit"
			idPrefix={`inline-edit-task-${editingTaskId}`}
		/>
	) : undefined;

	if (isRuntimeDisconnected) {
		return <RuntimeDisconnectedFallback />;
	}
	if (isKanbanAccessBlocked) {
		return <KanbanAccessBlockedFallback />;
	}

	return (
		<LayoutCustomizationsProvider
			onResetBottomTerminalLayoutCustomizations={
				resetBottomTerminalLayoutCustomizations
			}
		>
			<div className="flex h-[100svh] min-w-0 overflow-hidden">
				{!selectedCard ? (
					<ProjectNavigationPanel
						projects={displayedProjects}
						isLoadingProjects={isProjectListLoading}
						currentProjectId={navigationCurrentProjectId}
						removingProjectId={removingProjectId}
						activeSection={homeSidebarSection}
						onActiveSectionChange={setHomeSidebarSection}
						managerOnline={manager !== null && manager.stale !== true}
						managerState={manager}
						selectedAgentId={
							settingsRuntimeProjectConfig?.selectedAgentId ?? null
						}
						clineProviderSettings={
							settingsRuntimeProjectConfig?.clineProviderSettings ?? null
						}
						featurebaseFeedbackState={featurebaseFeedbackState}
						onSelectProject={(projectId) => {
							void handleSelectProject(projectId);
						}}
						onRemoveProject={handleRemoveProject}
						onAddProject={() => {
							void handleAddProject();
						}}
						sidebarWidth={sidebarLayout.sidebarWidth}
						setExpandedSidebarWidth={sidebarLayout.setExpandedSidebarWidth}
						isCollapsed={sidebarLayout.isCollapsed}
						setSidebarCollapsed={sidebarLayout.setSidebarCollapsed}
						managerSettingsFocusToken={managerSettingsFocusToken}
						onOpenPlan={setEditingPlan}
					/>
				) : null}
				<div className="flex flex-col flex-1 min-w-0 overflow-hidden">
					<TopBar
						onToggleSidebar={!selectedCard ? handleToggleSidebar : undefined}
						onBack={selectedCard ? handleBack : undefined}
						workspacePath={navbarWorkspacePath}
						isWorkspacePathLoading={shouldShowProjectLoadingState}
						workspaceHint={navbarWorkspaceHint}
						runtimeHint={navbarRuntimeHint}
						selectedTaskId={selectedCard?.card.id ?? null}
						selectedTaskBaseRef={selectedCard?.card.baseRef ?? null}
						showHomeGitSummary={!hasNoProjects && !selectedCard}
						runningGitAction={
							selectedCard || hasNoProjects ? null : runningGitAction
						}
						onGitFetch={
							selectedCard
								? undefined
								: () => {
										void runGitAction("fetch");
									}
						}
						onGitPull={
							selectedCard
								? undefined
								: () => {
										void runGitAction("pull");
									}
						}
						onGitPush={
							selectedCard
								? undefined
								: () => {
										void runGitAction("push");
									}
						}
						onGitStash={
							selectedCard
								? undefined
								: () => {
										void runGitAction("stash");
									}
						}
						onGitStashPop={
							selectedCard
								? undefined
								: () => {
										void runGitAction("stash-pop");
									}
						}
						onGitCommit={
							selectedCard ? undefined : () => setIsCommitDialogOpen(true)
						}
						onGitPullRequest={
							selectedCard ? undefined : () => setIsPullRequestDialogOpen(true)
						}
						onGitWorktrees={
							selectedCard ? undefined : () => setIsWorktreesDialogOpen(true)
						}
						onGitConflicts={
							selectedCard ? undefined : () => setIsConflictsDialogOpen(true)
						}
						onToggleTerminal={
							hasNoProjects
								? undefined
								: selectedCard
									? handleToggleDetailTerminal
									: handleToggleHomeTerminal
						}
						isTerminalOpen={
							selectedCard ? isDetailTerminalOpen : showHomeBottomTerminal
						}
						isTerminalLoading={
							selectedCard ? isDetailTerminalStarting : isHomeTerminalStarting
						}
						onOpenSettings={handleOpenSettings}
						showDebugButton={debugModeEnabled}
						onOpenDebugDialog={
							debugModeEnabled ? handleOpenDebugDialog : undefined
						}
						shortcuts={shortcuts}
						selectedShortcutLabel={selectedShortcutLabel}
						onSelectShortcutLabel={handleSelectShortcutLabel}
						runningShortcutLabel={runningShortcutLabel}
						onRunShortcut={handleRunShortcut}
						onCreateFirstShortcut={
							currentProjectId ? handleCreateShortcut : undefined
						}
						openTargetOptions={openTargetOptions}
						selectedOpenTargetId={selectedOpenTargetId}
						onSelectOpenTarget={onSelectOpenTarget}
						openPlatformOverride={openPlatformOverride}
						onSelectOpenPlatform={onSelectOpenPlatform}
						detectedOpenPlatform={detectedOpenPlatform}
						onOpenWorkspace={onOpenWorkspace}
						canOpenWorkspace={canOpenWorkspace}
						isOpeningWorkspace={isOpeningWorkspace}
						onToggleGitHistory={
							hasNoProjects ? undefined : handleToggleGitHistory
						}
						isGitHistoryOpen={isGitHistoryOpen}
						onToggleOffice={hasNoProjects ? undefined : handleToggleOffice}
						isOfficeOpen={isOfficeOpen}
						hideProjectDependentActions={
							shouldHideProjectDependentTopBarActions
						}
					/>
					<div className="relative flex flex-1 min-h-0 min-w-0 overflow-hidden">
						<div
							className="kb-home-layout"
							aria-hidden={selectedCard ? true : undefined}
							style={selectedCard ? { visibility: "hidden" } : undefined}
						>
							{shouldShowProjectLoadingState ? (
								<div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-4 bg-surface-0">
									<Spinner size={30} />
									<Button
										variant="default"
										size="sm"
										onClick={handleClearProjectSelection}
									>
										Clear stuck project
									</Button>
								</div>
							) : hasNoProjects ? (
								<div className="flex flex-1 min-h-0 items-center justify-center bg-surface-0 p-6">
									<div className="flex flex-col items-center justify-center gap-3 text-text-tertiary">
										<FolderOpen size={48} strokeWidth={1} />
										<h3 className="text-sm font-semibold text-text-primary">
											No projects yet
										</h3>
										<p className="text-[13px] text-text-secondary">
											Add a git repository to start using Kanban.
										</p>
										<Button
											variant="primary"
											onClick={() => {
												void handleAddProject();
											}}
										>
											Add Project
										</Button>
									</div>
								</div>
							) : (
								<div className="flex flex-1 flex-col min-h-0 min-w-0">
									<div className="flex flex-1 min-h-0 min-w-0">
										{editingPlan ? (
											<PlanEditorView
												plan={editingPlan}
												workspaceId={currentProjectId}
												onClose={() => setEditingPlan(null)}
											/>
										) : isGitHistoryOpen ? (
											<GitHistoryView
												workspaceId={currentProjectId}
												gitHistory={gitHistory}
												onCheckoutBranch={(branch) => {
													void switchHomeBranch(branch);
												}}
												onDeleteBranch={(branch) => {
													void deleteHomeBranch(branch);
												}}
												isDeleteBranchPending={
													isDeletingHomeBranch
												}
												onCreateBranch={(
													newBranch,
													startPoint,
												) => {
													void createHomeBranch({
														newBranch,
														startPoint,
													});
												}}
												isCreateBranchPending={
													isCreatingHomeBranch
												}
												onMergeIntoCurrent={(branch) => {
													void mergeHomeBranchIntoCurrent(branch);
												}}
												onRebaseCurrentOnto={(branch) => {
													void rebaseHomeCurrentOnto(branch);
												}}
												onCherryPickCommit={(commitHash) => {
													void cherryPickOntoHomeHead(commitHash);
												}}
												onDiscardWorkingChanges={() => {
													void discardHomeWorkingChanges();
												}}
												isDiscardWorkingChangesPending={
													isDiscardingHomeWorkingChanges
												}
											/>
										) : (
											<HomeTriplePane
												rightColumnOpen={isOfficeOpen}
												center={
													<KanbanBoard
														data={board}
														taskSessions={sessions}
														workspacePath={workspacePath}
														onCardSelect={handleCardSelect}
														onCreateTask={handleOpenCreateTask}
														onStartTask={handleStartTaskFromBoard}
														onPauseTask={pauseTaskSession}
														onResumeTask={resumeTaskSession}
														onCancelAutoRun={handleCancelAutoRun}
														onDeleteTask={handleDeleteBacklogTask}
														onStartAllTasks={
															handleStartAllBacklogTasksFromBoard
														}
														onClearTrash={handleOpenClearTrash}
														editingTaskId={editingTaskId}
														inlineTaskEditor={inlineTaskEditor}
														onEditTask={handleOpenEditTask}
														onSaveTaskTitle={handleSaveTaskTitle}
														onCommitTask={handleCommitTask}
														onOpenPrTask={handleOpenPrTask}
														onSubmitReviewGit={handleReviewCommitWithBranch}
														onCancelReviewGitForm={handleCancelReviewGitForm}
														onOpenReviewGitForm={handleOpenReviewGitForm}
														onRetryReviewGitFollowOn={handleRetryReviewGitFollowOn}
														reviewGitStatusById={reviewGitStatusById}
														canRetryReviewGitFollowOnById={canRetryReviewGitFollowOnById}
														reviewBranchSuggestionsByTaskId={reviewBranchSuggestionsByTaskId}
														onMergeTask={handleMergeTaskBranch}
														onCancelAutomaticTaskAction={
															handleCancelAutomaticTaskAction
														}
														commitTaskLoadingById={commitTaskLoadingById}
														mergeTaskLoadingById={mergeTaskLoadingById}
														openPrTaskLoadingById={openPrTaskLoadingById}
														moveToTrashLoadingById={moveToTrashLoadingById}
														onMoveToTrashTask={handleMoveReviewCardToTrash}
														onRestoreFromTrashTask={handleRestoreTaskFromTrash}
														dependencies={board.dependencies}
														onCreateDependency={handleCreateDependency}
														onDeleteDependency={handleDeleteDependency}
														onReorderChain={handleReorderChain}
														onBreakChain={handleBreakChain}
														onRunChain={handleRunChain}
														onRequestProgrammaticCardMoveReady={
															selectedCard
																? undefined
																: handleProgrammaticCardMoveReady
														}
														onDragEnd={handleDragEnd}
														defaultClineModelId={
															runtimeProjectConfig?.clineProviderSettings
																?.modelId ?? null
														}
													/>
												}
												watch={
													<ManagerAccountsView
														online={manager !== null && manager.stale !== true}
														manager={manager}
													/>
												}
												office={
													<OfficeView
														board={board}
														sessions={sessions}
														workspaceId={currentProjectId}
														manager={manager}
														onSelectTask={handleCardSelect}
													/>
												}
											/>
										)}
									</div>
									{showHomeBottomTerminal ? (
										<ResizableBottomPane
											minHeight={200}
											initialHeight={homeTerminalPaneHeight}
											onHeightChange={setHomeTerminalPaneHeight}
											onCollapse={collapseHomeTerminal}
											isExpanded={isHomeTerminalExpanded}
										>
											<div
												style={{
													display: "flex",
													flex: "1 1 0",
													minWidth: 0,
													paddingLeft: 12,
													paddingRight: 12,
												}}
											>
												<AgentTerminalPanel
													key={`home-shell-${homeTerminalTaskId}`}
													taskId={homeTerminalTaskId}
													workspaceId={currentProjectId}
													summary={homeTerminalSummary}
													onSummary={upsertSession}
													showSessionToolbar={false}
													autoFocus
													onClose={closeHomeTerminal}
													minimalHeaderTitle="Terminal"
													minimalHeaderSubtitle={homeTerminalSubtitle}
													panelBackgroundColor="var(--color-surface-1)"
													terminalBackgroundColor={
														terminalThemeColors.surfaceRaised
													}
													cursorColor={terminalThemeColors.textPrimary}
													onConnectionReady={markTerminalConnectionReady}
													agentCommand={agentCommand}
													onSendAgentCommand={
														handleSendAgentCommandToHomeTerminal
													}
													isExpanded={isHomeTerminalExpanded}
													onToggleExpand={handleToggleExpandHomeTerminal}
												/>
											</div>
										</ResizableBottomPane>
									) : null}
								</div>
							)}
						</div>
						{selectedCard && detailSession ? (
							<div className="absolute inset-0 flex min-h-0 min-w-0">
								<CardDetailView
									selection={selectedCard}
									currentProjectId={currentProjectId}
									workspacePath={workspacePath}
									selectedAgentId={
										runtimeProjectConfig?.selectedAgentId ?? null
									}
									runtimeConfig={runtimeProjectConfig ?? null}
									sessionSummary={detailSession}
									taskSessions={sessions}
									onSessionSummary={upsertSession}
									onCardSelect={handleCardSelect}
									onTaskDragEnd={handleDetailTaskDragEnd}
									onCreateTask={handleOpenCreateTask}
									onStartTask={handleStartTaskFromBoard}
									onPauseTask={pauseTaskSession}
									onResumeTask={resumeTaskSession}
									onCancelAutoRun={handleCancelAutoRun}
									onStartAllTasks={handleStartAllBacklogTasksFromBoard}
									onClearTrash={handleOpenClearTrash}
									editingTaskId={editingTaskId}
									inlineTaskEditor={inlineTaskEditor}
									onEditTask={(task) => {
										handleOpenEditTask(task, { preserveDetailSelection: true });
									}}
									onSaveTaskTitle={handleSaveTaskTitle}
									onCommitTask={handleCommitTask}
									onOpenPrTask={handleOpenPrTask}
									onAgentCommitTask={handleAgentCommitTask}
									onAgentOpenPrTask={handleAgentOpenPrTask}
									commitTaskLoadingById={commitTaskLoadingById}
									openPrTaskLoadingById={openPrTaskLoadingById}
									agentCommitTaskLoadingById={agentCommitTaskLoadingById}
									agentOpenPrTaskLoadingById={agentOpenPrTaskLoadingById}
									moveToTrashLoadingById={moveToTrashLoadingById}
									onMoveReviewCardToTrash={handleMoveReviewCardToTrash}
									onRestoreTaskFromTrash={handleRestoreTaskFromTrash}
									onCancelAutomaticTaskAction={handleCancelAutomaticTaskAction}
									onAddReviewComments={(taskId: string, text: string) => {
										void handleAddReviewComments(taskId, text);
									}}
									onSendReviewComments={(taskId: string, text: string) => {
										void handleSendReviewComments(taskId, text);
									}}
									onRevertFile={(path: string) => {
										void revertTaskFile(
											selectedCard.card.id,
											selectedCard.card.baseRef,
											path,
										);
									}}
									onRevertHunk={(path: string, hunkIndex: number) => {
										void revertTaskHunk(
											selectedCard.card.id,
											selectedCard.card.baseRef,
											path,
											hunkIndex,
										);
									}}
									onRequestBlame={async (path: string) => {
										const response = await fetchRuntimeBlame(currentProjectId, {
											path,
											taskInfo: {
												taskId: selectedCard.card.id,
												baseRef: selectedCard.card.baseRef,
											},
										});
										return response.ok ? response.lines : null;
									}}
									onSendClineChatMessage={sendTaskChatMessage}
									onCancelClineChatTurn={cancelTaskChatTurn}
									onLoadClineChatMessages={fetchTaskChatMessages}
									latestClineChatMessage={latestSelectedTaskChatMessage}
									streamedClineChatMessages={selectedTaskChatMessages}
									onMoveToTrash={handleMoveToTrash}
									isMoveToTrashLoading={
										moveToTrashLoadingById[selectedCard.card.id] ?? false
									}
									gitHistoryPanel={
										isGitHistoryOpen ? (
											<GitHistoryView
												workspaceId={currentProjectId}
												gitHistory={gitHistory}
											/>
										) : undefined
									}
									onCloseGitHistory={handleCloseGitHistory}
									bottomTerminalOpen={isDetailTerminalOpen}
									bottomTerminalTaskId={detailTerminalTaskId}
									bottomTerminalSummary={detailTerminalSummary}
									bottomTerminalSubtitle={detailTerminalSubtitle}
									onBottomTerminalClose={closeDetailTerminal}
									onBottomTerminalCollapse={collapseDetailTerminal}
									bottomTerminalPaneHeight={detailTerminalPaneHeight}
									onBottomTerminalPaneHeightChange={setDetailTerminalPaneHeight}
									onBottomTerminalConnectionReady={markTerminalConnectionReady}
									bottomTerminalAgentCommand={agentCommand}
									onBottomTerminalSendAgentCommand={
										handleSendAgentCommandToDetailTerminal
									}
									isBottomTerminalExpanded={isDetailTerminalExpanded}
									onBottomTerminalToggleExpand={
										handleToggleExpandDetailTerminal
									}
									isDocumentVisible={isDocumentVisible}
									onClineSettingsSaved={refreshRuntimeProjectConfig}
									onTaskClineSettingsChanged={
										handleClineTaskSettingsChangedForTask
									}
									managerAccounts={managedManagerAccounts}
									managerActiveAccountId={manager?.activeAccountId ?? null}
									onTaskManagerAccountChanged={handleTaskManagerAccountChanged}
									onRestartTaskWithAccount={handleRestartTaskWithCurrentAccount}
									restartTaskLoadingById={restartTaskLoadingById}
									onTaskLaunchSettingsChanged={handleTaskLaunchSettingsChanged}
									onTaskAutoResumeOnUsageLimitChanged={
										handleTaskAutoResumeOnUsageLimitChanged
									}
								/>
							</div>
						) : null}
					</div>
				</div>
				<RuntimeSettingsDialog
					open={isSettingsOpen}
					workspaceId={settingsWorkspaceId}
					initialConfig={settingsRuntimeProjectConfig}
					liveMcpAuthStatuses={latestMcpAuthStatuses}
					initialSection={settingsInitialSection}
					maxRunningTasks={maxRunningTasks}
					onMaxRunningTasksChange={setMaxRunningTasks}
					onOpenChange={(nextOpen) => {
						setIsSettingsOpen(nextOpen);
						if (!nextOpen) {
							setSettingsInitialSection(null);
						}
					}}
					onSaved={() => {
						refreshRuntimeProjectConfig();
						refreshSettingsRuntimeProjectConfig();
					}}
					onAccountSwitched={refreshKanbanAccess}
				/>
				<DebugDialog
					open={isDebugDialogOpen}
					onOpenChange={handleDebugDialogOpenChange}
					isResetAllStatePending={isResetAllStatePending}
					onShowStartupOnboardingDialog={handleShowStartupOnboardingDialog}
					onResetAllState={handleResetAllState}
				/>
				<CommitComposerDialog
					open={isCommitDialogOpen}
					onOpenChange={setIsCommitDialogOpen}
					changedFiles={homeGitSummary?.changedFiles ?? 0}
					onCommit={commitHomeChanges}
				/>
				<PullRequestDialog
					open={isPullRequestDialogOpen}
					onOpenChange={setIsPullRequestDialogOpen}
					defaultTitle={homeGitSummary?.currentBranch ?? undefined}
					onCreate={createHomePullRequest}
				/>
				<WorktreesDialog
					open={isWorktreesDialogOpen}
					onOpenChange={setIsWorktreesDialogOpen}
					workspaceId={currentProjectId}
				/>
				<ConflictsDialog
					open={isConflictsDialogOpen}
					onOpenChange={setIsConflictsDialogOpen}
					workspaceId={currentProjectId}
				/>
				<TaskCreateDialog
					open={isInlineTaskCreateOpen}
					onOpenChange={handleCreateDialogOpenChange}
					prompt={newTaskPrompt}
					onPromptChange={setNewTaskPrompt}
					images={newTaskImages}
					onImagesChange={setNewTaskImages}
					onCreate={handleCreateTask}
					onCreateAndStart={handleCreateAndStartTask}
					onCreateStartAndOpen={handleCreateStartAndOpenTask}
					onCreateMultiple={handleCreateTasks}
					onCreateAndStartMultiple={handleCreateAndStartTasks}
					startInPlanMode={newTaskStartInPlanMode}
					onStartInPlanModeChange={setNewTaskStartInPlanMode}
					planFilePath={newTaskPlanFilePath}
					onPlanFilePathChange={setNewTaskPlanFilePath}
					savedPlans={savedPlans}
					startInPlanModeDisabled={isNewTaskStartInPlanModeDisabled}
					autoRunDelayMinutes={newTaskAutoRunDelayMinutes}
					onAutoRunDelayMinutesChange={setNewTaskAutoRunDelayMinutes}
					workspaceId={currentProjectId}
					branchRef={newTaskBranchRef}
					branchOptions={createTaskBranchOptions}
					onBranchRefChange={setNewTaskBranchRef}
					agentId={newTaskAgentId}
					onAgentIdChange={setNewTaskAgentId}
					clineSettings={newTaskClineSettings}
					onClineSettingsChange={setNewTaskClineSettings}
					taskLaunchSettings={newTaskLaunchSettings}
					onTaskLaunchSettingsChange={setNewTaskLaunchSettings}
					defaultAgentId={createTaskDefaultAgentId}
					defaultProviderId={defaultTaskClineProviderId}
					defaultModelId={
						runtimeProjectConfig?.clineProviderSettings?.modelId ?? null
					}
					defaultReasoningEffort={
						runtimeProjectConfig?.clineProviderSettings?.reasoningEffort ?? null
					}
					managerAccounts={managedManagerAccounts}
					managerActiveAccountId={manager?.activeAccountId ?? null}
					managerAccountId={newTaskManagerAccountId}
					onManagerAccountIdChange={setNewTaskManagerAccountId}
				/>
				<ClearTrashDialog
					open={isClearTrashDialogOpen}
					taskCount={trashTaskCount}
					onCancel={() => setIsClearTrashDialogOpen(false)}
					onConfirm={handleConfirmClearTrash}
				/>
				<StartupOnboardingDialog
					open={isStartupOnboardingDialogOpen}
					onClose={handleCloseStartupOnboardingDialog}
					selectedAgentId={runtimeProjectConfig?.selectedAgentId ?? null}
					agents={runtimeProjectConfig?.agents ?? []}
					clineProviderSettings={
						runtimeProjectConfig?.clineProviderSettings ?? null
					}
					workspaceId={currentProjectId}
					runtimeConfig={runtimeProjectConfig ?? null}
					onSelectAgent={handleSelectOnboardingAgent}
					onClineSetupSaved={handleOnboardingClineSetupSaved}
				/>

				<AddProjectDialog
					open={isAddProjectDialogOpen}
					onOpenChange={setIsAddProjectDialogOpen}
					onProjectAdded={handleAddProjectSuccess}
					currentProjectId={currentProjectId}
					initialGitInitPath={pendingNativeGitInitPath}
				/>

				<UpdateNotificationController />

				<AlertDialog
					open={gitActionError !== null}
					onOpenChange={(open) => {
						if (!open) {
							clearGitActionError();
						}
					}}
				>
					<AlertDialogHeader>
						<AlertDialogTitle>{gitActionErrorTitle}</AlertDialogTitle>
					</AlertDialogHeader>
					<AlertDialogBody>
						<p>{gitActionError?.message}</p>
						{gitActionError?.output ? (
							<pre className="max-h-[220px] overflow-auto rounded-md bg-surface-0 p-3 font-mono text-xs text-text-secondary whitespace-pre-wrap">
								{gitActionError.output}
							</pre>
						) : null}
					</AlertDialogBody>
					<AlertDialogFooter className="justify-end">
						<AlertDialogAction asChild>
							<Button variant="default" onClick={clearGitActionError}>
								Close
							</Button>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialog>
			</div>
		</LayoutCustomizationsProvider>
	);
}
