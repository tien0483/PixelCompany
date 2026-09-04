export enum LocalStorageKey {
	TaskStartInPlanMode = "kanban.task-start-in-plan-mode",
	TaskAutoReviewEnabled = "kanban.task-auto-review-enabled",
	TaskAutoReviewMode = "kanban.task-auto-review-mode",
	/** Whether the native Cline chat panel renders model reasoning ("thinking") text. Defaults to visible. */
	ClineShowReasoning = "kanban.cline-show-reasoning",
	AgentTipsDismissed = "kanban.agent-tips-dismissed",
	/** Claude model the Review tab's one-shot agents run on. Defaults to Haiku. */
	ReviewAgentModel = "kanban.review-agent-model",
	ReviewPolishComments = "kanban.review-polish-comments",
	/** Whether the review comment composer opens in rich or plain text mode. */
	ReviewCommentEditorMode = "kanban.review-comment-editor-mode",
	/** Whether the review diff pane's draggable tag strip is expanded. Defaults to open. */
	ReviewTagStripExpanded = "kanban.review-tag-strip-expanded",
	TaskCreatePrimaryStartAction = "kanban.task-create-primary-start-action",
	BottomTerminalPaneHeight = "kanban.bottom-terminal-pane-height",
	DetailAgentPanelRatio = "kanban.detail-agent-panel-ratio",
	DetailTaskCardsPanelRatio = "kanban.detail-task-cards-panel-ratio",
	DetailDiffFileTreePanelRatio = "kanban.detail-diff-file-tree-panel-ratio",
	DetailExpandedDiffFileTreePanelRatio = "kanban.detail-expanded-diff-file-tree-panel-ratio",
	ProjectNavigationPanelWidth = "kb-sidebar-width",
	ProjectNavigationPanelCollapsed = "kanban.project-navigation-panel-collapsed",
	GitHistoryRefsPanelWidth = "kanban.git-history-refs-panel-width",
	GitHistoryCommitsPanelWidth = "kanban.git-history-commits-panel-width",
	GitDiffFileTreePanelRatio = "kanban.git-diff-file-tree-panel-ratio",
	OnboardingDialogShown = "kanban.onboarding.dialog.shown",
	NotificationPermissionPrompted = "kanban.notifications.permission-prompted",
	PreferredOpenTarget = "kanban.preferred-open-target",
	PreferredOpenPlatform = "kanban.preferred-open-platform",
	OfficeViewOpen = "kanban.office-view-open",
	HomeRightColumnWidth = "kanban.home-right-column-width",
	HomeRightSplitRatio = "kanban.home-right-split-ratio",
	NotificationBadgeClearEvent = "kanban.notification-badge-clear.v1",
	TabVisibilityPresence = "kanban.tab-visibility-presence.v1",
	Theme = "kanban.theme",
	/** Max cards allowed to run concurrently; the backlog auto-run scheduler defers past this. */
	MaxRunningTasks = "kanban.max-running-tasks",
	PlansLastImportFolder = "kanban.plans-last-import-folder",
	PlanEditorRawPaneRatio = "kanban.plan-editor-raw-pane-ratio",
	PlanEditorTemplatePaneWidth = "kanban.plan-editor-template-pane-width",
	PlanEditorTemplatePaneCollapsed = "kanban.plan-editor-template-pane-collapsed",
	/** Which of the plan editor's panes are on screen: "editor", "split" or "preview". */
	PlanEditorPaneViewMode = "kanban.plan-editor-pane-view-mode",
	LearningHealthPanelExpanded = "kanban.learning-health-panel-expanded",
	AddProjectLastBrowseFolder = "kanban.add-project-last-browse-folder",
	/**
	 * Seats "Max donate" toggle: whether every eligible seat was pushed to a 100%
	 * donate cap, plus each seat's cap from before, so it can be put back.
	 * Deliberately not a layout key — resetting the layout must not strand a
	 * boosted fleet with no way to restore it.
	 */
	ManagerDonateBoost = "kanban.manager-donate-boost.v1",
}

/** Default concurrent-running cap used by the backlog auto-run scheduler. */
export const DEFAULT_MAX_RUNNING_TASKS = 3;

export const LAYOUT_CUSTOMIZATION_LOCAL_STORAGE_KEYS = [
	LocalStorageKey.BottomTerminalPaneHeight,
	LocalStorageKey.DetailAgentPanelRatio,
	LocalStorageKey.DetailTaskCardsPanelRatio,
	LocalStorageKey.DetailDiffFileTreePanelRatio,
	LocalStorageKey.DetailExpandedDiffFileTreePanelRatio,
	LocalStorageKey.ProjectNavigationPanelWidth,
	LocalStorageKey.ProjectNavigationPanelCollapsed,
	LocalStorageKey.GitHistoryRefsPanelWidth,
	LocalStorageKey.GitHistoryCommitsPanelWidth,
	LocalStorageKey.GitDiffFileTreePanelRatio,
	LocalStorageKey.HomeRightColumnWidth,
	LocalStorageKey.HomeRightSplitRatio,
	LocalStorageKey.PlanEditorRawPaneRatio,
	LocalStorageKey.PlanEditorTemplatePaneWidth,
	LocalStorageKey.PlanEditorTemplatePaneCollapsed,
	LocalStorageKey.PlanEditorPaneViewMode,
] as const;

function getLocalStorage(): Storage | null {
	if (typeof window === "undefined") {
		return null;
	}
	return window.localStorage;
}

export function readLocalStorageItem(key: LocalStorageKey): string | null {
	const storage = getLocalStorage();
	if (!storage) {
		return null;
	}
	try {
		return storage.getItem(key);
	} catch {
		return null;
	}
}

export function writeLocalStorageItem(key: LocalStorageKey, value: string): void {
	const storage = getLocalStorage();
	if (!storage) {
		return;
	}
	try {
		storage.setItem(key, value);
	} catch {
		// Ignore storage write failures.
	}
}

export function removeLocalStorageItem(key: LocalStorageKey): void {
	const storage = getLocalStorage();
	if (!storage) {
		return;
	}
	try {
		storage.removeItem(key);
	} catch {
		// Ignore storage removal failures.
	}
}

export function resetLayoutCustomizationLocalStorageItems(): void {
	for (const key of LAYOUT_CUSTOMIZATION_LOCAL_STORAGE_KEYS) {
		removeLocalStorageItem(key);
	}
}
