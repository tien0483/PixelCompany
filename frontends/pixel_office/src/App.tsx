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
import { CleanupDialog } from "@/components/cleanup-dialog";
import { ClearTrashDialog } from "@/components/clear-trash-dialog";
import { AgentStudioView } from "@/agents/agent-studio-view";
import { DebugDialog } from "@/components/debug-dialog";
import type { AgentStudioTarget } from "@/components/home-sidebar-agents";
import { SiteDocsView } from "@/site/site-docs-view";
import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import {
	CommitComposerDialog,
	PullRequestDialog,
} from "@/components/git-composer-dialogs";
import { ConflictsDialog } from "@/components/conflicts/conflicts-dialog";
import { GitHistoryView } from "@/components/git-history-view";
import { WorktreesDialog } from "@/components/git-inspector-dialogs";
import { HomeTriplePane } from "@/components/home-triple-pane";
import { KanbanBoard } from "@/components/kanban-board";
import { PlanEditorView } from "@/components/plan-editor/plan-editor-view";
import { ReviewWorkspaceView } from "@/components/review/review-workspace-view";
import {
	type HomeSidebarSection,
	ProjectNavigationPanel,
} from "@/components/project-navigation-panel";
import {
	RuntimeSettingsDialog,
	type RuntimeSettingsSection,
} from "@/components/runtime-settings-dialog";
import { StackControlDialog } from "@/components/stack-control-dialog";
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
import { useBacklogAutorunScheduler } from "@/hooks/use-backlog-autorun-scheduler";
import { useBoardInteractions } from "@/hooks/use-board-interactions";
import { useCleanupTools } from "@/hooks/use-cleanup-tools";
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
import type { ReviewTarget } from "@/review/review-target";
import { useSavedPlans } from "@/hooks/use-saved-plans";
import { useShortcutActions } from "@/hooks/use-shortcut-actions";
import { useStackControl } from "@/hooks/use-stack-control";
import { useStartupOnboarding } from "@/hooks/use-startup-onboarding";
import {
	ensureBranchOptionPresent,
	useTaskBranchOptions,
} from "@/hooks/use-task-branch-options";
import { useTaskEditor } from "@/hooks/use-task-editor";
import { useTaskSessions } from "@/hooks/use-task-sessions";
import { useTaskStartActions } from "@/hooks/use-task-start-actions";
import { useHomeCenterView } from "@/hooks/use-home-center-view";
import {
	AGENT_STUDIO_NEW_FLOW_ID,
	HOME_ROUTE_BOARD,
	homeRouteSidebarSection,
	sectionHomeRoute,
} from "@/hooks/home-route";
import { type NavigateHomeRouteOptions, useHomeRoute } from "@/hooks/use-home-route";
import { useAgentStudioTarget } from "@/agents/use-agent-studio-target";
import { useTerminalPanels } from "@/hooks/use-terminal-panels";
import { useWorkspaceSync } from "@/hooks/use-workspace-sync";
import { LearningView } from "@/learning/learning-view";
import { UnderstandView } from "@/understand/understand-view";
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
	RuntimeSeatPreset,
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
	setTaskApiSeat,
	setTaskLaunchSettings,
	setTaskManagerAccount,
	setTaskSeatPreset,
} from "@/state/board-state";
import { isTaskInChain } from "@/state/chain-groups";
import {
	DEFAULT_MAX_RUNNING_TASKS,
	LocalStorageKey,
} from "@/storage/local-storage-store";
import {
	getTaskWorkspaceInfo,
	getTaskWorkspaceSnapshot,
	replaceWorkspaceMetadata,
	resetWorkspaceMetadataStore,
	useHomeGitSummaryValue,
} from "@/stores/workspace-metadata-store";
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
	const [managerSettingsFocusToken, setManagerSettingsFocusToken] = useState(0);
	const [isClearTrashDialogOpen, setIsClearTrashDialogOpen] = useState(false);
	/**
	 * Caches, not state: *whether* a plan editor or an agent studio is open is the route's
	 * business now, and these only hold the object the sidebar already had so the warm path
	 * renders without a round trip. A cold deep link finds them empty and resolves the id
	 * against `savedPlans` / the studio's own queries instead.
	 */
	const [openedPlan, setOpenedPlan] = useState<RuntimeSavedPlan | null>(null);
	const [agentStudioSeed, setAgentStudioSeed] =
		useState<AgentStudioTarget | null>(null);
	const [isCommitDialogOpen, setIsCommitDialogOpen] = useState(false);
	const [isPullRequestDialogOpen, setIsPullRequestDialogOpen] = useState(false);
	const [isWorktreesDialogOpen, setIsWorktreesDialogOpen] = useState(false);
	const [isConflictsDialogOpen, setIsConflictsDialogOpen] = useState(false);
	// Set when a failed merge/rebase/cherry-pick names the worktree holding its
	// conflict, so the dialog opens on that one. Null means "show whatever is
	// stopped" — the dialog enumerates every worktree of the repo either way.
	const [conflictWorktreePath, setConflictWorktreePath] = useState<
		string | null
	>(null);
	const homeGitSummary = useHomeGitSummaryValue();
	const [pendingTaskStartAfterEditId, setPendingTaskStartAfterEditId] =
		useState<string | null>(null);
	const taskEditorResetRef = useRef<() => void>(() => {});
	/**
	 * Same late-binding trick as `taskEditorResetRef`: the center-view hook needs
	 * `hasNoProjects`, which `useProjectNavigation` produces — and that call takes this
	 * callback as an argument. The reset is only ever invoked from an event, never during
	 * the render that assigns it.
	 */
	const centerViewResetRef = useRef<(options?: NavigateHomeRouteOptions) => void>(
		() => {},
	);
	const lastStreamErrorRef = useRef<string | null>(null);
	const handleProjectSwitchStart = useCallback(() => {
		setCanPersistWorkspaceState(false);
		// `replace`: nobody navigated to this board — the project switch did — so Back must not
		// have to step through it on the way out of the previous project's view.
		centerViewResetRef.current({ replace: true });
		setOpenedPlan(null);
		setAgentStudioSeed(null);
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
	/**
	 * `useOfficeViewState` is declared much further down (it needs `handleBack`), so the
	 * center-view hook reaches its `closeOffice` through a ref rather than the two hooks
	 * being reordered around each other. Stable identity, so nothing downstream re-renders
	 * on it.
	 */
	const closeOfficeRef = useRef<() => void>(() => {});
	const closeHomeOfficeColumn = useCallback(() => {
		closeOfficeRef.current();
	}, []);
	const { route: homeRoute, navigate: navigateHome } = useHomeRoute({
		projectId: navigationCurrentProjectId,
		hasNoProjects,
	});
	const homeSidebarSection = homeRouteSidebarSection(homeRoute);
	const {
		isDocsOpen,
		isGitHistoryOpen,
		isLearningOpen,
		isUnderstandOpen,
		toggleView,
		resetToBoard: resetHomeCenterView,
		closeGitHistory,
	} = useHomeCenterView({
		route: homeRoute,
		navigate: navigateHome,
		closeOffice: closeHomeOfficeColumn,
	});
	centerViewResetRef.current = resetHomeCenterView;
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
		isCleanupDialogOpen,
		handleOpenCleanupDialog,
		handleCleanupDialogOpenChange,
		reclaimableBytes: cleanupReclaimableBytes,
	} = useCleanupTools(currentProjectId);
	const {
		isStackDialogOpen,
		handleOpenStackDialog,
		handleStackDialogOpenChange,
	} = useStackControl();
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
		setTaskChatModel,
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
			// No `onDetailClosed`. It used to close the git history and the plan editor, because
			// the home layout behind the card detail was invisible state nobody could see coming
			// back; it is a URL now, so closing a card reveals whatever the address bar says.
			// It also *had* to stop navigating: `useDetailTaskNavigation` fires that callback on
			// every `popstate`, including the ones the route pushed, so a Back that moved the
			// route would have been answered by a push back to where the route used to be.
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
					account.provider === "claude" ||
					account.provider === "cursor" ||
					account.provider === "antigravity",
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
		handleNewTaskAgentIdChange,
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
		handleEditTaskAgentIdChange,
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
		editTaskAutoFailoverOnUsageLimit,
		setEditTaskAutoFailoverOnUsageLimit,
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
		defaultSubagentSeatProviderId: runtimeProjectConfig?.defaultSubagentSeatProviderId ?? null,
		setSelectedTaskId,
		queueTaskStartAfterEdit,
		fetchTaskWorkspaceInfo,
	});
	const {
		plans: savedPlans,
		hasLoaded: hasLoadedSavedPlans,
		refresh: refreshSavedPlans,
	} = useSavedPlans(currentProjectId);

	const handleOpenPlan = useCallback(
		(plan: RuntimeSavedPlan) => {
			setOpenedPlan(plan);
			navigateHome({ kind: "plans", planId: plan.id });
		},
		[navigateHome],
	);

	const handleSavePlan = useCallback(
		(plan: RuntimeSavedPlan) => {
			// A plan saved from a session is not in `savedPlans` until the refresh lands, so the
			// cache is what keeps the editor on screen across the navigation.
			handleOpenPlan(plan);
			void refreshSavedPlans();
		},
		[handleOpenPlan, refreshSavedPlans],
	);

	/**
	 * The three full-pane surfaces are all *inside* a project — a plan id resolves against that
	 * project's plans, a review against its rules key, a flow against its studio. Until the
	 * runtime reports a project there is nothing to resolve against, so a deep link waits in
	 * the loading branch below instead of rendering a view pointed at no workspace.
	 */
	const projectScopedRoute = currentProjectId === null ? HOME_ROUTE_BOARD : homeRoute;
	const routedPlanId =
		projectScopedRoute.kind === "plans" ? projectScopedRoute.planId : null;
	const editingPlan = useMemo(() => {
		if (routedPlanId === null) {
			return null;
		}
		return (
			savedPlans.find((plan) => plan.id === routedPlanId) ??
			(openedPlan?.id === routedPlanId ? openedPlan : null)
		);
	}, [openedPlan, routedPlanId, savedPlans]);
	/**
	 * A cold deep link arrives before `plans.list` answers. Holding the pane rather than
	 * falling through to the board is what stops `/…/plans/<id>` from flashing the board and
	 * then swapping — and, when the id is bogus, the fall-through is the whole error message.
	 */
	const isResolvingRoutedPlan =
		routedPlanId !== null && editingPlan === null && !hasLoadedSavedPlans;

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
		isCleaningStash,
		cleanStash,
		switchHomeBranch,
		deleteHomeBranch,
		isDeletingHomeBranch,
		createHomeBranch,
		isCreatingHomeBranch,
		cherryPickOntoHomeHead,
		mergeHomeBranchIntoCurrent,
		rebaseHomeCurrentOnto,
		pushHomeBranch,
		pushTaskBranch,
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
		taskSessions: sessions,
		isGitHistoryOpen,
		refreshWorkspaceState,
		onOpenConflicts: (worktreePath) => {
			setConflictWorktreePath(worktreePath);
			setIsConflictsDialogOpen(true);
		},
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
	const onWillOpenOffice = useCallback(() => {
		// The office needs the board in the center, so every routed full-pane surface — center
		// view, plan editor, review, studio — goes away with one navigation.
		navigateHome(HOME_ROUTE_BOARD);
		// Office lives in the home layout, which stays visibility:hidden while a
		// task detail is open — leave detail first or the toggle looks like a no-op.
		if (selectedCard) {
			handleBack();
		}
	}, [handleBack, navigateHome, selectedCard]);
	const { isOfficeOpen, handleToggleOffice, closeOffice } = useOfficeViewState({
		currentProjectId,
		hasNoProjects,
		onWillOpenOffice,
	});
	closeOfficeRef.current = closeOffice;
	/**
	 * Brand logo = "go home". Every full-pane surface closes, the right column
	 * collapses and the sidebar returns to Projects; the selected project is
	 * untouched. Kept as one callback so a new full-pane view has exactly one
	 * place to register itself.
	 */
	const handleReturnToBoard = useCallback(() => {
		// One navigation now covers what used to be four resets: the board route *is* "no
		// full-pane surface, sidebar on Projects".
		navigateHome(HOME_ROUTE_BOARD);
		closeOffice();
	}, [closeOffice, navigateHome]);
	/**
	 * Picking a sidebar tab is a navigation, so it closes whatever full-pane surface was open.
	 * That is a change from the old independent-state behaviour, and it is the point: the
	 * surface is now one Back press away instead of being reachable only through its own ✕.
	 */
	const handleSelectHomeSidebarSection = useCallback(
		(section: HomeSidebarSection) => {
			navigateHome(sectionHomeRoute(section));
		},
		[navigateHome],
	);
	const handleOpenMergeRequest = useCallback(
		(target: ReviewTarget) => {
			navigateHome({
				kind: "review",
				target: { host: target.host, projectId: target.projectId, iid: target.iid },
			});
		},
		[navigateHome],
	);
	const handleOpenAgentStudio = useCallback(
		(target: AgentStudioTarget) => {
			setAgentStudioSeed(target);
			navigateHome({
				kind: "agents",
				flowId: target.flow?.id ?? AGENT_STUDIO_NEW_FLOW_ID,
			});
		},
		[navigateHome],
	);
	const handleToggleGitHistory = useCallback(() => {
		toggleView("git");
	}, [toggleView]);
	const handleToggleDocs = useCallback(() => {
		toggleView("docs");
	}, [toggleView]);
	const handleToggleLearning = useCallback(() => {
		toggleView("learning");
	}, [toggleView]);
	const handleToggleUnderstand = useCallback(() => {
		toggleView("understand");
	}, [toggleView]);

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
		closeGitHistory,
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
		handleCloseGitHistory: closeGitHistory,
		handleToggleOffice,
		handleToggleDocs: hasNoProjects ? undefined : handleToggleDocs,
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
			getTaskWorkspaceInfo(selectedCard.card.id)?.path ??
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
		? (getTaskWorkspaceInfo(selectedCard.card.id)?.path ??
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

	/**
	 * Key the Review rules bundle is stored under. The project's path is used rather
	 * than its id or name: ids are per-install, and names collide across GitLab
	 * namespaces, so either would hand one project another's rules.
	 */
	const reviewProjectKey = navigationProjectPath ?? workspacePath ?? "default";
	/**
	 * The review target rebuilds from the URL with no lookup at all: the path carries the whole
	 * identity (`host`/`projectId`/`iid`), the rules key is this project's, and `title` is only
	 * the tab label shown before the merge request loads — `!<iid>` is already what the sidebar
	 * itself falls back to for a stored session.
	 */
	const routedReviewTarget =
		projectScopedRoute.kind === "review" ? projectScopedRoute.target : null;
	const reviewTarget = useMemo<ReviewTarget | null>(() => {
		if (routedReviewTarget === null) {
			return null;
		}
		return {
			host: routedReviewTarget.host,
			projectId: routedReviewTarget.projectId,
			iid: routedReviewTarget.iid,
			title: `!${routedReviewTarget.iid}`,
			projectKey: reviewProjectKey,
		};
	}, [reviewProjectKey, routedReviewTarget]);
	const { target: agentStudioTarget, isResolving: isResolvingAgentStudio } =
		useAgentStudioTarget({
			workspaceId: currentProjectId,
			flowId: projectScopedRoute.kind === "agents" ? projectScopedRoute.flowId : null,
			seed: agentStudioSeed,
		});
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

	const handleTaskSeatPresetChanged = useCallback(
		(taskId: string, seatPreset: RuntimeSeatPreset | null) => {
			// Same "card, not session" rule as the pin above: a live session keeps the seat
			// and model it launched with until it is restarted.
			setBoard((currentBoard) => {
				const result = setTaskSeatPreset(currentBoard, taskId, seatPreset);
				return result.updated ? result.board : currentBoard;
			});
		},
		[setBoard],
	);

	const handleTaskApiSeatChanged = useCallback(
		(
			taskId: string,
			seat: { providerId: string; modelId: string | null } | null,
		) => {
			setBoard((currentBoard) => {
				const result = setTaskApiSeat(currentBoard, taskId, seat);
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

	const handleTaskAutoFailoverOnUsageLimitChanged = useCallback(
		(taskId: string, enabled: boolean) => {
			setBoard((currentBoard) => ({
				...currentBoard,
				columns: currentBoard.columns.map((column) => ({
					...column,
					cards: column.cards.map((card) =>
						card.id === taskId
							? { ...card, autoFailoverOnUsageLimit: enabled }
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
			branchOptions={ensureBranchOptionPresent(
				createTaskBranchOptions,
				editTaskBranchRef,
			)}
			onBranchRefChange={setEditTaskBranchRef}
			branchSelectDisabled={isEditTaskBaseRefLocked}
			branchSelectDisabledReason="Base ref is fixed once the task has started."
			agentId={editTaskAgentId}
			onAgentIdChange={handleEditTaskAgentIdChange}
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
			managerAccountId={editTaskManagerAccountId}
			onManagerAccountIdChange={setEditTaskManagerAccountId}
			seatPreset={editTaskSeatPreset ?? null}
			onSeatPresetChange={setEditTaskSeatPreset}
			autoRunDelayMinutes={editTaskAutoRunDelayMinutes}
			onAutoRunDelayMinutesChange={setEditTaskAutoRunDelayMinutes}
			autoResumeOnUsageLimit={editTaskAutoResumeOnUsageLimit}
			onAutoResumeOnUsageLimitChange={setEditTaskAutoResumeOnUsageLimit}
			autoFailoverOnUsageLimit={editTaskAutoFailoverOnUsageLimit}
			onAutoFailoverOnUsageLimitChange={setEditTaskAutoFailoverOnUsageLimit}
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
						onActiveSectionChange={handleSelectHomeSidebarSection}
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
						onOpenPlan={handleOpenPlan}
						reviewProjectKey={reviewProjectKey}
						onOpenMergeRequest={handleOpenMergeRequest}
						onOpenAgentStudio={handleOpenAgentStudio}
						onReturnToBoard={handleReturnToBoard}
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
						onCleanStash={
							selectedCard
								? undefined
								: () => {
										void cleanStash();
									}
						}
						isCleaningStash={isCleaningStash}
						onGitCommit={
							selectedCard ? undefined : () => setIsCommitDialogOpen(true)
						}
						onGitPullRequest={
							selectedCard ? undefined : () => setIsPullRequestDialogOpen(true)
						}
						onGitWorktrees={
							selectedCard ? undefined : () => setIsWorktreesDialogOpen(true)
						}
						// Not gated on `selectedCard`: a conflict is *most* likely to be in
						// the selected card's own worktree, and hiding the button there is
						// what made it unreachable exactly when it was needed.
						onGitConflicts={() => {
							setConflictWorktreePath(null);
							setIsConflictsDialogOpen(true);
						}}
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
						onOpenStack={handleOpenStackDialog}
						onOpenCleanup={hasNoProjects ? undefined : handleOpenCleanupDialog}
						cleanupReclaimableBytes={cleanupReclaimableBytes}
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
						onToggleDocs={hasNoProjects ? undefined : handleToggleDocs}
						isDocsOpen={isDocsOpen}
						onToggleLearning={
							hasNoProjects ? undefined : handleToggleLearning
						}
						isLearningOpen={isLearningOpen}
						onToggleUnderstand={
							hasNoProjects ? undefined : handleToggleUnderstand
						}
						isUnderstandOpen={isUnderstandOpen}
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
							{reviewTarget ? (
								// Same remount discipline as the plan editor below: the review view
								// holds in-flight SSE streams and draft state keyed to the instance,
								// so a prop swap would leak one merge request's drafts into the next.
								<ReviewWorkspaceView
									key={`${reviewTarget.host}-${reviewTarget.projectId}-${reviewTarget.iid}`}
									target={reviewTarget}
									workspaceId={currentProjectId}
									managerAccounts={managedManagerAccounts}
									managerActiveAccountId={manager?.activeAccountId ?? null}
									localRepoPath={navigationProjectPath ?? workspacePath ?? undefined}
									onClose={() => navigateHome(sectionHomeRoute("review"))}
								/>
							) : editingPlan ? (
								<PlanEditorView
									// Load-bearing: this key forces a full remount on every plan switch.
									// PlanEditorView's internal state (brief/generated-HTML refs, in-flight
									// SSE streams, autosave timers) is keyed to the component instance, not
									// to the `plan` prop, so a same-instance prop swap would leak a
									// previous plan's brief/HTML into the new plan's file. Do not remove.
									key={editingPlan.id}
									plan={editingPlan}
									workspaceId={currentProjectId}
									managerAccounts={managedManagerAccounts}
									managerActiveAccountId={manager?.activeAccountId ?? null}
									onClose={() => navigateHome(sectionHomeRoute("plans"))}
								/>
							) : agentStudioTarget ? (
								<AgentStudioView
									target={agentStudioTarget}
									onClose={() => navigateHome(sectionHomeRoute("agents"))}
								/>
							) : isResolvingRoutedPlan || isResolvingAgentStudio ? (
								// A deep link names a plan or a flow the shell has not fetched yet. Holding
								// the pane here is what stops `/…/plans/<id>` from flashing the board on
								// every cold load; when the id turns out to be unknown, both flags go false
								// and the fall-through renders the section the id belonged to.
								<div className="flex flex-1 min-h-0 items-center justify-center bg-surface-0">
									<Spinner size={30} />
								</div>
							) : shouldShowProjectLoadingState ? (
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
											Add a git repository to start using PIXTiel.
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
										{isDocsOpen ? (
											<SiteDocsView
												workspaceId={currentProjectId}
												onClose={handleToggleDocs}
											/>
										) : isLearningOpen ? (
											<LearningView
												workspaceId={currentProjectId}
												onClose={handleToggleLearning}
											/>
										) : isUnderstandOpen ? (
											<UnderstandView
												workspaceId={currentProjectId}
												projectPath={
													navigationProjectPath ?? workspacePath ?? null
												}
												managerAccounts={managedManagerAccounts}
												onClose={handleToggleUnderstand}
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
												isDeleteBranchPending={isDeletingHomeBranch}
												onCreateBranch={(newBranch, startPoint) => {
													void createHomeBranch({
														newBranch,
														startPoint,
													});
												}}
												isCreateBranchPending={isCreatingHomeBranch}
												onMergeIntoCurrent={(branch) => {
													void mergeHomeBranchIntoCurrent(branch);
												}}
												onRebaseCurrentOnto={(branch) => {
													void rebaseHomeCurrentOnto(branch);
												}}
												onPushBranch={(branch) => {
													void pushHomeBranch(branch);
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
												onCollapse={handleToggleOffice}
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
														onResumeEndedSession={
															handleRestartTaskWithCurrentAccount
														}
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
														onRetryReviewGitFollowOn={
															handleRetryReviewGitFollowOn
														}
														reviewGitStatusById={reviewGitStatusById}
														canRetryReviewGitFollowOnById={
															canRetryReviewGitFollowOnById
														}
														reviewBranchSuggestionsByTaskId={
															reviewBranchSuggestionsByTaskId
														}
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
													onResumeEndedSession={
														handleRestartTaskWithCurrentAccount
													}
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
									onResumeEndedSession={handleRestartTaskWithCurrentAccount}
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
									onSavePlan={handleSavePlan}
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
									onApplyClineChatModel={setTaskChatModel}
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
												onPushBranch={(branch) => {
													void pushTaskBranch(
														selectedCard.card.id,
														selectedCard.card.baseRef,
														branch,
													);
												}}
											/>
										) : undefined
									}
									onCloseGitHistory={closeGitHistory}
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
									onTaskSeatPresetChanged={handleTaskSeatPresetChanged}
									onTaskApiSeatChanged={handleTaskApiSeatChanged}
									onRestartTaskSession={handleRestartTaskWithCurrentAccount}
									restartTaskLoadingById={restartTaskLoadingById}
									onTaskLaunchSettingsChanged={handleTaskLaunchSettingsChanged}
									onTaskAutoResumeOnUsageLimitChanged={
										handleTaskAutoResumeOnUsageLimitChanged
									}
									onTaskAutoFailoverOnUsageLimitChanged={
										handleTaskAutoFailoverOnUsageLimitChanged
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
				<CleanupDialog
					open={isCleanupDialogOpen}
					onOpenChange={handleCleanupDialogOpenChange}
					workspaceId={currentProjectId}
				/>
				{/* Workspace-independent: the switchboard state lives in the agent-stack
					sandbox, not in the open project. */}
				<StackControlDialog
					open={isStackDialogOpen}
					onOpenChange={handleStackDialogOpenChange}
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
					scope={
						conflictWorktreePath
							? { worktreePath: conflictWorktreePath }
							: null
					}
					onResolved={() => {
						void refreshWorkspaceState();
					}}
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
					onAgentIdChange={handleNewTaskAgentIdChange}
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
					seatPreset={newTaskSeatPreset ?? null}
					onSeatPresetChange={setNewTaskSeatPreset}
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
