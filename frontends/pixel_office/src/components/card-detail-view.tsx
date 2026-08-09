import type { DropResult } from "@hello-pangea/dnd";
import * as Collapsible from "@radix-ui/react-collapsible";
import {
	ChevronDown,
	ChevronRight,
	Files,
	GitCompareArrows,
	Maximize2,
	MessageSquare,
	Minimize2,
	Play,
	X,
} from "lucide-react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { showAppToast } from "@/components/app-toaster";
import { isPlanReadyForSave } from "@/components/board-card";
import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import {
	ClineAgentChatPanel,
	type ClineAgentChatPanelHandle,
} from "@/components/detail-panels/cline-agent-chat-panel";
import { ColumnContextPanel } from "@/components/detail-panels/column-context-panel";
import {
	type DiffLineComment,
	DiffViewerPanel,
} from "@/components/detail-panels/diff-viewer-panel";
import { FileTreePanel } from "@/components/detail-panels/file-tree-panel";
import { PlanMarkdownPreview } from "@/components/plan-editor/plan-markdown-preview";
import { TaskLaunchSettingsPicker } from "@/components/task-launch-settings";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import type { ClineChatActionResult } from "@/hooks/use-cline-chat-runtime-actions";
import type { ClineChatMessage } from "@/hooks/use-cline-chat-session";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useSavePlanFromSession } from "@/hooks/use-save-plan-from-session";
import { useStackDevtools } from "@/hooks/use-stack-devtools";
import {
	applyTaskSubagentSeatSelection,
	filterManagerAccountsForAgent,
	shouldClearManagerAccountPin,
	TaskAccountPicker,
} from "@/manager/task-account-picker";
import { ResizableBottomPane } from "@/resize/resizable-bottom-pane";
import { ResizeHandle } from "@/resize/resize-handle";
import { useCardDetailLayout } from "@/resize/use-card-detail-layout";
import { useResizeDrag } from "@/resize/use-resize-drag";
import { isNativeClineAgentSelected } from "@/runtime/native-agent";
import { isSessionPausedOffline } from "@/runtime/session-status";
import type {
	RuntimeAgentId,
	RuntimeClineReasoningEffort,
	RuntimeConfigResponse,
	RuntimeGitBlameLine,
	RuntimeManagerAccount,
	RuntimeSavedPlan,
	RuntimeTaskLaunchSettings,
	RuntimeTaskSessionMode,
	RuntimeTaskSessionSummary,
	RuntimeWorkspaceChangesMode,
} from "@/runtime/types";
import { useClineApiSeats } from "@/runtime/use-cline-api-seats";
import { useRuntimeWorkspaceChanges } from "@/runtime/use-runtime-workspace-changes";
import { useTaskWorkspaceStateVersionValue } from "@/stores/workspace-metadata-store";
import { trackPlanSaved } from "@/telemetry/events";
import { useTerminalThemeColors } from "@/terminal/theme-colors";
import {
	type BoardCard,
	type CardSelection,
	getTaskAutoReviewCancelButtonLabel,
} from "@/types";
import { useWindowEvent } from "@/utils/react-use";

// We still poll the open detail diff because line content can change without changing
// the overall file or line counts that drive the shared workspace metadata stream.
const DETAIL_DIFF_POLL_INTERVAL_MS = 1_000;
const DIFF_MODE_ACTIVE_BACKGROUND =
	"color-mix(in srgb, var(--color-surface-3) 80%, var(--color-text-primary))";

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	return (
		target.tagName === "INPUT" ||
		target.tagName === "TEXTAREA" ||
		target.isContentEditable
	);
}

function isEventInsideDialog(target: EventTarget | null): boolean {
	return (
		target instanceof Element && target.closest("[role='dialog']") !== null
	);
}

/** Shared factory for the three horizontal resize-drag handlers in the detail view. */
function useResizeHandler(
	containerRef: React.RefObject<HTMLDivElement | null>,
	ratio: number,
	setRatio: (r: number) => void,
	startDrag: ReturnType<typeof useResizeDrag>["startDrag"],
	invert = false,
): (event: ReactMouseEvent<HTMLDivElement>) => void {
	return useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
			const container = containerRef.current;
			if (!container) {
				return;
			}
			const containerWidth = Math.max(container.offsetWidth, 1);
			const startX = event.clientX;
			const sign = invert ? -1 : 1;
			const applyDelta = (pointerX: number) => {
				setRatio(ratio + sign * ((pointerX - startX) / containerWidth));
			};
			startDrag(event, {
				axis: "x",
				cursor: "ew-resize",
				onMove: applyDelta,
				onEnd: applyDelta,
			});
		},
		[containerRef, ratio, setRatio, startDrag, invert],
	);
}

function SkeletonLine({
	width,
	mb,
}: {
	width: string;
	mb?: boolean;
}): React.ReactElement {
	return (
		<div
			className={cn("kb-skeleton h-[13px] rounded-sm", mb && "mb-[7px]")}
			style={{ width }}
		/>
	);
}

function SkeletonFileRow({ width }: { width: string }): React.ReactElement {
	return (
		<div className="mb-0.5 flex items-center gap-2 px-2 py-1.5">
			<div className="kb-skeleton h-3 w-3 rounded-sm" />
			<div className="kb-skeleton h-[13px] rounded-sm" style={{ width }} />
		</div>
	);
}

function WorkspaceChangesLoadingPanel({
	panelFlex,
}: {
	panelFlex: string;
}): React.ReactElement {
	return (
		<div
			className="flex min-h-0 min-w-0 bg-surface-0"
			style={{ flex: "1.6 1 0" }}
		>
			<div className="flex flex-1 flex-col border-r border-divider">
				<div className="px-2.5 pt-2.5 pb-1.5">
					<div className="mb-2.5 flex items-center gap-2">
						<div
							className="kb-skeleton h-3.5 rounded-sm"
							style={{ width: "62%" }}
						/>
						<div className="kb-skeleton h-4 w-[42px] rounded-full" />
					</div>
					<SkeletonLine width="92%" mb />
					<SkeletonLine width="84%" mb />
					<SkeletonLine width="95%" mb />
					<SkeletonLine width="79%" mb />
					<SkeletonLine width="88%" mb />
					<SkeletonLine width="76%" />
				</div>
				<div className="flex-1" />
			</div>
			<div className="flex flex-col px-2 py-2.5" style={{ flex: panelFlex }}>
				<SkeletonFileRow width="61%" />
				<SkeletonFileRow width="70%" />
				<SkeletonFileRow width="53%" />
				<div className="flex-1" />
			</div>
		</div>
	);
}

function BottomTerminalSection({
	taskId,
	workspaceId,
	summary,
	onSummary,
	onClose,
	subtitle,
	terminalThemeColors,
	onConnectionReady,
	agentCommand,
	onSendAgentCommand,
	paneHeight,
	onPaneHeightChange,
	onCollapse,
	isExpanded,
	onToggleExpand,
	onResumeEndedSession,
}: {
	taskId: string;
	workspaceId: string | null;
	summary: RuntimeTaskSessionSummary | null;
	onSummary: (summary: RuntimeTaskSessionSummary) => void;
	onClose: () => void;
	subtitle?: string | null;
	terminalThemeColors: { surfaceRaised: string; textPrimary: string };
	onConnectionReady?: (taskId: string) => void;
	agentCommand?: string | null;
	onSendAgentCommand?: () => void;
	paneHeight?: number;
	onPaneHeightChange?: (height: number) => void;
	onCollapse?: () => void;
	isExpanded?: boolean;
	onToggleExpand?: () => void;
	onResumeEndedSession?: (taskId: string) => void;
}): React.ReactElement {
	return (
		<ResizableBottomPane
			minHeight={200}
			initialHeight={paneHeight}
			onHeightChange={onPaneHeightChange}
			onCollapse={onCollapse}
			isExpanded={isExpanded}
		>
			<div className="flex min-w-0 flex-1 px-3">
				<AgentTerminalPanel
					taskId={taskId}
					workspaceId={workspaceId}
					summary={summary}
					onSummary={onSummary}
					showSessionToolbar={false}
					autoFocus
					onClose={onClose}
					minimalHeaderTitle="Terminal"
					minimalHeaderSubtitle={subtitle}
					panelBackgroundColor="var(--color-surface-1)"
					terminalBackgroundColor={terminalThemeColors.surfaceRaised}
					cursorColor={terminalThemeColors.textPrimary}
					onConnectionReady={onConnectionReady}
					agentCommand={agentCommand}
					onSendAgentCommand={onSendAgentCommand}
					isExpanded={isExpanded}
					onToggleExpand={onToggleExpand}
					onResumeEndedSession={onResumeEndedSession}
				/>
			</div>
		</ResizableBottomPane>
	);
}

function WorkspaceChangesEmptyPanel({
	title,
}: {
	title: string;
}): React.ReactElement {
	return (
		<div
			className="flex min-h-0 min-w-0 bg-surface-0"
			style={{ flex: "1.6 1 0" }}
		>
			<div className="kb-empty-state-center flex-1">
				<div className="flex flex-col items-center justify-center gap-3 py-12 text-text-tertiary">
					<GitCompareArrows size={40} />
					<h3 className="font-semibold text-text-secondary">{title}</h3>
				</div>
			</div>
		</div>
	);
}

type MobileTab = "chat" | "diff" | "files";

const MOBILE_TABS: {
	id: MobileTab;
	label: string;
	icon: React.ReactElement;
}[] = [
	{ id: "chat", label: "Chat", icon: <MessageSquare size={14} /> },
	{ id: "diff", label: "Diff", icon: <GitCompareArrows size={14} /> },
	{ id: "files", label: "Files", icon: <Files size={14} /> },
];

function MobileDetailTabBar({
	activeTab,
	onTabChange,
}: {
	activeTab: MobileTab;
	onTabChange: (tab: MobileTab) => void;
}): React.ReactElement {
	const tabs = MOBILE_TABS;
	return (
		<div
			className="flex items-center border-b border-border"
			style={{ minHeight: 36 }}
		>
			{tabs.map((tab) => (
				<button
					key={tab.id}
					type="button"
					className={cn(
						"relative flex flex-1 items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium transition-colors",
						activeTab === tab.id ? "text-accent" : "text-text-secondary",
					)}
					onClick={() => onTabChange(tab.id)}
				>
					{tab.icon}
					{tab.label}
					{activeTab === tab.id ? (
						<span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />
					) : null}
				</button>
			))}
		</div>
	);
}

function DiffModeButton({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}): React.ReactElement {
	return (
		<Button
			variant="ghost"
			size="sm"
			onClick={onClick}
			aria-pressed={active}
			className="h-5 rounded-sm text-xs"
			style={
				active
					? {
							backgroundColor: DIFF_MODE_ACTIVE_BACKGROUND,
							color: "var(--color-text-primary)",
						}
					: undefined
			}
		>
			{children}
		</Button>
	);
}

/**
 * Views the diff panel can show. "devtools" hosts the agent-stack DevTools
 * dashboard alongside All Changes / Last Turn, so per-session token and subagent
 * activity sits next to the diff for that session instead of in a separate tab.
 */
type DiffPanelView = "changes" | "plan" | "devtools";

function DiffToolbar({
	mode,
	onModeChange,
	isExpanded,
	onToggleExpand,
	hideExpand,
	planReady,
	devtoolsReady,
	activeView,
	onViewChange,
}: {
	mode: RuntimeWorkspaceChangesMode;
	onModeChange: (mode: RuntimeWorkspaceChangesMode) => void;
	isExpanded: boolean;
	onToggleExpand: () => void;
	hideExpand?: boolean;
	planReady?: boolean;
	devtoolsReady?: boolean;
	activeView: DiffPanelView;
	onViewChange: (view: DiffPanelView) => void;
}): React.ReactElement {
	return (
		<div className="flex items-center gap-1 border-b border-divider px-2 py-1">
			{isExpanded ? (
				<Button
					variant="ghost"
					size="sm"
					icon={<X size={14} />}
					onClick={onToggleExpand}
					className="h-5"
					aria-label="Collapse expanded diff view"
				/>
			) : null}
			<div className="inline-flex items-center gap-0.5 rounded-md p-0.5">
				<DiffModeButton
					active={activeView === "changes" && mode === "working_copy"}
					onClick={() => {
						onModeChange("working_copy");
						onViewChange("changes");
					}}
				>
					All Changes
				</DiffModeButton>
				<DiffModeButton
					active={activeView === "changes" && mode === "last_turn"}
					onClick={() => {
						onModeChange("last_turn");
						onViewChange("changes");
					}}
				>
					Last Turn
				</DiffModeButton>
				{planReady ? (
					<DiffModeButton
						active={activeView === "plan"}
						onClick={() => onViewChange("plan")}
					>
						Plan
					</DiffModeButton>
				) : null}
				{devtoolsReady ? (
					<DiffModeButton
						active={activeView === "devtools"}
						onClick={() => onViewChange("devtools")}
					>
						DevTools
					</DiffModeButton>
				) : null}
			</div>
			{!hideExpand ? (
				<Button
					variant="ghost"
					size="sm"
					icon={isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
					onClick={onToggleExpand}
					className="ml-auto h-5"
					aria-label={
						isExpanded ? "Collapse split diff view" : "Expand split diff view"
					}
				/>
			) : null}
		</div>
	);
}

export function CardDetailView({
	selection,
	currentProjectId,
	workspacePath,
	selectedAgentId = null,
	runtimeConfig = null,
	sessionSummary,
	taskSessions,
	onSessionSummary,
	onCardSelect,
	onTaskDragEnd,
	onCreateTask,
	onStartTask,
	onPauseTask,
	onResumeTask,
	onCancelAutoRun,
	onStartAllTasks,
	onClearTrash,
	editingTaskId,
	inlineTaskEditor,
	onEditTask,
	onSaveTaskTitle,
	onCommitTask,
	onOpenPrTask,
	onAgentCommitTask,
	onAgentOpenPrTask,
	onMoveReviewCardToTrash,
	onRestoreTaskFromTrash,
	onCancelAutomaticTaskAction,
	commitTaskLoadingById,
	openPrTaskLoadingById,
	agentCommitTaskLoadingById,
	agentOpenPrTaskLoadingById,
	moveToTrashLoadingById,
	onAddReviewComments,
	onSendReviewComments,
	onRevertFile,
	onRevertHunk,
	onRequestBlame,
	onSendClineChatMessage,
	onCancelClineChatTurn,
	onLoadClineChatMessages,
	latestClineChatMessage,
	streamedClineChatMessages,
	onMoveToTrash,
	isMoveToTrashLoading,
	gitHistoryPanel,
	onCloseGitHistory,
	bottomTerminalOpen,
	bottomTerminalTaskId,
	bottomTerminalSummary,
	bottomTerminalSubtitle,
	onBottomTerminalClose,
	onBottomTerminalCollapse,
	bottomTerminalPaneHeight,
	onBottomTerminalPaneHeightChange,
	onBottomTerminalConnectionReady,
	bottomTerminalAgentCommand,
	onBottomTerminalSendAgentCommand,
	isBottomTerminalExpanded,
	onBottomTerminalToggleExpand,
	isDocumentVisible = true,
	onClineSettingsSaved,
	onTaskClineSettingsChanged,
	onTaskApiSeatChanged,
	managerAccounts,
	managerActiveAccountId = null,
	onTaskManagerAccountChanged,
	onRestartTaskSession,
	restartTaskLoadingById,
	onResumeEndedSession,
	onTaskLaunchSettingsChanged,
	onTaskAutoResumeOnUsageLimitChanged,
	onSavePlan,
}: {
	selection: CardSelection;
	currentProjectId: string | null;
	workspacePath?: string | null;
	selectedAgentId?: RuntimeAgentId | null;
	runtimeConfig?: RuntimeConfigResponse | null;
	sessionSummary: RuntimeTaskSessionSummary | null;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onSessionSummary: (summary: RuntimeTaskSessionSummary) => void;
	onCardSelect: (taskId: string) => void;
	onTaskDragEnd: (result: DropResult) => void;
	onCreateTask?: () => void;
	onStartTask?: (taskId: string) => void;
	onPauseTask?: (taskId: string) => void;
	onResumeTask?: (taskId: string) => void;
	onCancelAutoRun?: (taskId: string) => void;
	onStartAllTasks?: () => void;
	onClearTrash?: () => void;
	editingTaskId?: string | null;
	inlineTaskEditor?: ReactNode;
	onEditTask?: (card: BoardCard) => void;
	onSaveTaskTitle?: (taskId: string, title: string) => void;
	onCommitTask?: (taskId: string) => void;
	onOpenPrTask?: (taskId: string) => void;
	onAgentCommitTask?: (taskId: string) => void;
	onAgentOpenPrTask?: (taskId: string) => void;
	onMoveReviewCardToTrash?: (taskId: string) => void;
	onRestoreTaskFromTrash?: (taskId: string) => void;
	onCancelAutomaticTaskAction?: (taskId: string) => void;
	commitTaskLoadingById?: Record<string, boolean>;
	openPrTaskLoadingById?: Record<string, boolean>;
	agentCommitTaskLoadingById?: Record<string, boolean>;
	agentOpenPrTaskLoadingById?: Record<string, boolean>;
	moveToTrashLoadingById?: Record<string, boolean>;
	onAddReviewComments?: (taskId: string, text: string) => void;
	onSendReviewComments?: (taskId: string, text: string) => void;
	onRevertFile?: (path: string) => void;
	onRevertHunk?: (path: string, hunkIndex: number) => void;
	onRequestBlame?: (path: string) => Promise<RuntimeGitBlameLine[] | null>;
	onSendClineChatMessage?: (
		taskId: string,
		text: string,
		options?: { mode?: RuntimeTaskSessionMode },
	) => Promise<ClineChatActionResult>;
	onCancelClineChatTurn?: (
		taskId: string,
	) => Promise<{ ok: boolean; message?: string }>;
	onLoadClineChatMessages?: (
		taskId: string,
	) => Promise<ClineChatMessage[] | null>;
	latestClineChatMessage?: ClineChatMessage | null;
	streamedClineChatMessages?: ClineChatMessage[] | null;
	onMoveToTrash: () => void;
	isMoveToTrashLoading?: boolean;
	gitHistoryPanel?: ReactNode;
	onCloseGitHistory?: () => void;
	bottomTerminalOpen: boolean;
	bottomTerminalTaskId: string | null;
	bottomTerminalSummary: RuntimeTaskSessionSummary | null;
	bottomTerminalSubtitle?: string | null;
	onBottomTerminalClose: () => void;
	onBottomTerminalCollapse?: () => void;
	bottomTerminalPaneHeight?: number;
	onBottomTerminalPaneHeightChange?: (height: number) => void;
	onBottomTerminalConnectionReady?: (taskId: string) => void;
	bottomTerminalAgentCommand?: string | null;
	onBottomTerminalSendAgentCommand?: () => void;
	isBottomTerminalExpanded?: boolean;
	onBottomTerminalToggleExpand?: () => void;
	isDocumentVisible?: boolean;
	onClineSettingsSaved?: () => void;
	onTaskClineSettingsChanged?: (settings: {
		providerId: string;
		modelId: string;
		reasoningEffort: RuntimeClineReasoningEffort | "";
	}) => void;
	/** Claude accounts jacked knows about; enables per-task account pinning when non-empty. */
	managerAccounts?: RuntimeManagerAccount[];
	/** Account jacked currently has active, used to label the Auto option. */
	managerActiveAccountId?: number | null;
	onTaskManagerAccountChanged?: (
		taskId: string,
		managerAccountId: number | null,
	) => void;
	/** Moves the card onto (or off) an API-key seat, which implies the Cline agent. */
	onTaskApiSeatChanged?: (
		taskId: string,
		seat: { providerId: string; modelId: string | null } | null,
	) => void;
	/** Stops the live session and relaunches it pinned to the task's newly-picked manager account (also reused, unpinned, to resume a paused-offline session via `--continue`). */
	onRestartTaskSession?: (taskId: string) => void;
	restartTaskLoadingById?: Record<string, boolean>;
	/** Resumes a paused-offline terminal-panel session; forwarded to the embedded/bottom `AgentTerminalPanel` instances. */
	onResumeEndedSession?: (taskId: string) => void;
	onTaskLaunchSettingsChanged?: (
		taskId: string,
		settings: RuntimeTaskLaunchSettings | null,
	) => void;
	onTaskAutoResumeOnUsageLimitChanged?: (
		taskId: string,
		enabled: boolean,
	) => void;
	onSavePlan?: (plan: RuntimeSavedPlan) => void;
}): React.ReactElement {
	const isMobile = useIsMobile();
	const [mobileTab, setMobileTab] = useState<MobileTab>("chat");
	const terminalThemeColors = useTerminalThemeColors();
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [diffComments, setDiffComments] = useState<
		Map<string, DiffLineComment>
	>(new Map());
	const [diffMode, setDiffMode] =
		useState<RuntimeWorkspaceChangesMode>("working_copy");
	const [diffPanelView, setDiffPanelView] = useState<DiffPanelView>("changes");
	// Only poll the switchboard while a session detail is actually open.
	const { devtoolsUrl } = useStackDevtools(true);
	const wasPlanReadyRef = useRef(false);
	const [isDiffExpanded, setIsDiffExpanded] = useState(false);
	const [savedPlanTextKey, setSavedPlanTextKey] = useState<string | null>(null);
	const { savePlan, isSaving: isSavingPlan } =
		useSavePlanFromSession(currentProjectId);
	const planReadyForSave = isPlanReadyForSave(
		selection.card,
		sessionSummary ?? undefined,
	);
	const planTextForSave = sessionSummary?.latestHookActivity?.planText ?? null;
	const planAlreadySaved =
		typeof planTextForSave === "string" && savedPlanTextKey === planTextForSave;
	const [isTaskConfigExpanded, setIsTaskConfigExpanded] = useState(
		() => !sessionSummary,
	);
	useEffect(() => {
		if (planReadyForSave && planTextForSave && !wasPlanReadyRef.current) {
			setDiffPanelView("plan");
		}
		wasPlanReadyRef.current = planReadyForSave && Boolean(planTextForSave);
	}, [planReadyForSave, planTextForSave]);
	useEffect(() => {
		if (!planReadyForSave && diffPanelView === "plan") {
			setDiffPanelView("changes");
		}
	}, [planReadyForSave, diffPanelView]);
	// Same guard for DevTools: if the daemon goes down while its tab is open, fall
	// back to the diff rather than leaving a dead iframe on screen.
	useEffect(() => {
		if (!devtoolsUrl && diffPanelView === "devtools") {
			setDiffPanelView("changes");
		}
	}, [devtoolsUrl, diffPanelView]);
	const {
		taskCardsPanelRatio,
		setTaskCardsPanelRatio,
		agentPanelRatio,
		setAgentPanelRatio,
		detailDiffFileTreeRatio,
		setDetailDiffFileTreeRatio,
	} = useCardDetailLayout({
		isDiffExpanded,
	});
	const { startDrag: startTaskCardsPanelResize } = useResizeDrag();
	const { startDrag: startAgentPanelResize } = useResizeDrag();
	const { startDrag: startDetailDiffResize } = useResizeDrag();
	const detailLayoutRef = useRef<HTMLDivElement | null>(null);
	const hasExplicitTaskClineSettings =
		selection.card.agentId === "cline" ||
		selection.card.clineSettings !== undefined;
	const mainRowRef = useRef<HTMLDivElement | null>(null);
	const detailDiffRowRef = useRef<HTMLDivElement | null>(null);
	const clineAgentChatPanelRef = useRef<ClineAgentChatPanelHandle | null>(null);

	const handleSeparatorMouseDown = useResizeHandler(
		detailLayoutRef,
		taskCardsPanelRatio,
		setTaskCardsPanelRatio,
		startTaskCardsPanelResize,
	);
	const handleAgentDiffSeparatorMouseDown = useResizeHandler(
		mainRowRef,
		agentPanelRatio,
		setAgentPanelRatio,
		startAgentPanelResize,
	);
	const handleDetailDiffSeparatorMouseDown = useResizeHandler(
		detailDiffRowRef,
		detailDiffFileTreeRatio,
		setDetailDiffFileTreeRatio,
		startDetailDiffResize,
		true,
	);
	const taskWorkspaceStateVersion = useTaskWorkspaceStateVersionValue(
		selection.card.id,
	);
	const lastTurnViewKey =
		diffMode === "last_turn"
			? [
					sessionSummary?.state ?? "none",
					sessionSummary?.latestTurnCheckpoint?.commit ?? "none",
					sessionSummary?.previousTurnCheckpoint?.commit ?? "none",
				].join(":")
			: null;
	const { changes: workspaceChanges, isRuntimeAvailable } =
		useRuntimeWorkspaceChanges(
			selection.card.id,
			currentProjectId,
			selection.card.baseRef,
			diffMode,
			taskWorkspaceStateVersion,
			isDocumentVisible && !gitHistoryPanel && selection.column.id !== "trash"
				? DETAIL_DIFF_POLL_INTERVAL_MS
				: null,
			lastTurnViewKey,
			true,
		);
	const runtimeFiles = workspaceChanges?.files ?? null;
	const isWorkspaceChangesPending =
		isRuntimeAvailable && workspaceChanges === null;
	const hasNoWorkspaceFileChanges =
		isRuntimeAvailable &&
		workspaceChanges !== null &&
		runtimeFiles !== null &&
		runtimeFiles.length === 0;
	const emptyDiffTitle =
		diffMode === "last_turn"
			? "No changes since last turn"
			: "No working changes";
	const taskCardsPanelPercent = `${(taskCardsPanelRatio * 100).toFixed(1)}%`;
	const detailContentPanelPercent = `${((1 - taskCardsPanelRatio) * 100).toFixed(1)}%`;
	const agentPanelPercent = `${(agentPanelRatio * 100).toFixed(1)}%`;
	const diffPanelPercent = `${((1 - agentPanelRatio) * 100).toFixed(1)}%`;
	const detailDiffFileTreePanelPercent = `${(detailDiffFileTreeRatio * 100).toFixed(1)}%`;
	const detailDiffContentPanelPercent = `${((1 - detailDiffFileTreeRatio) * 100).toFixed(1)}%`;
	const detailDiffFileTreePanelFlex = `0 0 ${detailDiffFileTreePanelPercent}`;
	const showMoveToTrashActions =
		selection.column.id === "review" || selection.column.id === "in_progress";
	const isTaskTerminalEnabled =
		selection.column.id === "in_progress" || selection.column.id === "review";
	const isSessionPausedOfflineForTask = sessionSummary
		? isSessionPausedOffline(sessionSummary)
		: false;
	const effectiveTaskAgentId =
		sessionSummary?.agentId ?? selection.card.agentId ?? selectedAgentId;
	const taskManagerAccounts = useMemo(
		() =>
			filterManagerAccountsForAgent(
				managerAccounts ?? [],
				effectiveTaskAgentId,
				{
					kanbanEligibleOnly: true,
				},
			),
		[effectiveTaskAgentId, managerAccounts],
	);
	const { seats: apiSeats } = useClineApiSeats(currentProjectId);
	const pinnedManagerAccount = useMemo(
		() =>
			(managerAccounts ?? []).find(
				(account) => account.id === selection.card.managerAccountId,
			) ?? null,
		[managerAccounts, selection.card.managerAccountId],
	);
	// Clear a pin the task can no longer use so Auto can resolve a seat instead:
	// a cross-provider leftover (Claude seat on a Cursor task after an agent
	// switch) or a seat that has since been disabled in Manager.
	useEffect(() => {
		if (!onTaskManagerAccountChanged) {
			return;
		}
		const shouldClear = shouldClearManagerAccountPin({
			pinnedAccountId: selection.card.managerAccountId,
			snapshotAccounts: managerAccounts ?? [],
			eligibleAccounts: taskManagerAccounts,
		});
		if (!shouldClear) {
			return;
		}
		onTaskManagerAccountChanged(selection.card.id, null);
	}, [
		managerAccounts,
		onTaskManagerAccountChanged,
		selection.card.id,
		selection.card.managerAccountId,
		taskManagerAccounts,
	]);
	const showClineAgentChatPanel =
		isNativeClineAgentSelected(effectiveTaskAgentId);
	const availablePaths = useMemo(() => {
		if (!runtimeFiles || runtimeFiles.length === 0) {
			return [];
		}
		return runtimeFiles.map((file) => file.path);
	}, [runtimeFiles]);

	const handleSelectAdjacentCard = useCallback(
		(step: number) => {
			const cards = selection.column.cards;
			const currentIndex = cards.findIndex(
				(card) => card.id === selection.card.id,
			);
			if (currentIndex === -1) {
				return;
			}
			const nextIndex = (currentIndex + step + cards.length) % cards.length;
			const nextCard = cards[nextIndex];
			if (nextCard) {
				onCardSelect(nextCard.id);
			}
		},
		[onCardSelect, selection.card.id, selection.column.cards],
	);

	useHotkeys(
		"up,left",
		() => {
			handleSelectAdjacentCard(-1);
		},
		{
			ignoreEventWhen: (event) => isTypingTarget(event.target),
			preventDefault: true,
		},
		[handleSelectAdjacentCard],
	);

	useWindowEvent(
		"keydown",
		useCallback(
			(event: KeyboardEvent) => {
				if (
					event.key !== "Escape" ||
					event.defaultPrevented ||
					isEventInsideDialog(event.target)
				) {
					return;
				}
				if (gitHistoryPanel && onCloseGitHistory) {
					event.preventDefault();
					onCloseGitHistory();
					return;
				}
				if (isTypingTarget(event.target)) {
					return;
				}
				if (isDiffExpanded) {
					event.preventDefault();
					setIsDiffExpanded(false);
				}
			},
			[gitHistoryPanel, isDiffExpanded, onCloseGitHistory],
		),
	);

	useHotkeys(
		"down,right",
		() => {
			handleSelectAdjacentCard(1);
		},
		{
			ignoreEventWhen: (event) => isTypingTarget(event.target),
			preventDefault: true,
		},
		[handleSelectAdjacentCard],
	);

	useEffect(() => {
		if (selectedPath && availablePaths.includes(selectedPath)) {
			return;
		}
		setSelectedPath(availablePaths[0] ?? null);
	}, [availablePaths, selectedPath]);

	useEffect(() => {
		setDiffComments(new Map());
		setDiffMode("working_copy");
	}, [selection.card.id]);

	const handleToggleDiffExpand = useCallback(() => {
		if (!isDiffExpanded && bottomTerminalOpen) {
			onBottomTerminalClose();
		}
		setIsDiffExpanded((previous) => !previous);
	}, [bottomTerminalOpen, isDiffExpanded, onBottomTerminalClose]);

	const handleAddDiffComments = useCallback(
		(formatted: string) => {
			if (showClineAgentChatPanel) {
				clineAgentChatPanelRef.current?.appendToDraft(formatted);
				setIsDiffExpanded(false);
				return;
			}
			onAddReviewComments?.(selection.card.id, formatted);
		},
		[onAddReviewComments, selection.card.id, showClineAgentChatPanel],
	);

	const handleSendDiffComments = useCallback(
		(formatted: string) => {
			if (showClineAgentChatPanel) {
				void clineAgentChatPanelRef.current?.sendText(formatted);
				setIsDiffExpanded(false);
				return;
			}
			onSendReviewComments?.(selection.card.id, formatted);
			setIsDiffExpanded(false);
		},
		[onSendReviewComments, selection.card.id, showClineAgentChatPanel],
	);

	const showBottomTerminal = bottomTerminalOpen && !!bottomTerminalTaskId;

	const agentChatPanel = showClineAgentChatPanel ? (
		<ClineAgentChatPanel
			ref={clineAgentChatPanelRef}
			taskId={selection.card.id}
			summary={sessionSummary}
			taskColumnId={selection.column.id}
			defaultMode="act"
			showComposerModeToggle={false}
			workspaceId={currentProjectId}
			runtimeConfig={runtimeConfig}
			taskClineSettings={selection.card.clineSettings}
			taskHasExplicitClineSettings={hasExplicitTaskClineSettings}
			onClineSettingsSaved={onClineSettingsSaved}
			onTaskClineSettingsChanged={onTaskClineSettingsChanged}
			onSendMessage={onSendClineChatMessage}
			onCancelTurn={onCancelClineChatTurn}
			onLoadMessages={onLoadClineChatMessages}
			incomingMessages={streamedClineChatMessages}
			incomingMessage={latestClineChatMessage}
			onCommit={
				onAgentCommitTask
					? () => onAgentCommitTask(selection.card.id)
					: undefined
			}
			isCommitLoading={agentCommitTaskLoadingById?.[selection.card.id] ?? false}
			showMoveToTrash={showMoveToTrashActions}
			onMoveToTrash={onMoveToTrash}
			isMoveToTrashLoading={isMoveToTrashLoading}
			onCancelAutomaticAction={
				selection.card.autoReviewEnabled === true && onCancelAutomaticTaskAction
					? () => onCancelAutomaticTaskAction(selection.card.id)
					: undefined
			}
			cancelAutomaticActionLabel={
				selection.card.autoReviewEnabled === true
					? getTaskAutoReviewCancelButtonLabel(selection.card.autoReviewMode)
					: null
			}
		/>
	) : (
		<AgentTerminalPanel
			taskId={selection.card.id}
			workspaceId={currentProjectId}
			terminalEnabled={isTaskTerminalEnabled}
			summary={sessionSummary}
			onSummary={onSessionSummary}
			onCommit={
				onAgentCommitTask
					? () => onAgentCommitTask(selection.card.id)
					: undefined
			}
			isCommitLoading={agentCommitTaskLoadingById?.[selection.card.id] ?? false}
			showSessionToolbar={false}
			autoFocus
			showMoveToTrash={showMoveToTrashActions}
			onMoveToTrash={onMoveToTrash}
			isMoveToTrashLoading={isMoveToTrashLoading}
			onCancelAutomaticAction={
				selection.card.autoReviewEnabled === true && onCancelAutomaticTaskAction
					? () => onCancelAutomaticTaskAction(selection.card.id)
					: undefined
			}
			cancelAutomaticActionLabel={
				selection.card.autoReviewEnabled === true
					? getTaskAutoReviewCancelButtonLabel(selection.card.autoReviewMode)
					: null
			}
			panelBackgroundColor="var(--color-surface-0)"
			terminalBackgroundColor={terminalThemeColors.surfacePrimary}
			cursorColor={terminalThemeColors.textPrimary}
			taskColumnId={selection.column.id}
			onResumeEndedSession={onResumeEndedSession}
		/>
	);

	if (isMobile) {
		return (
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-0">
				<MobileDetailTabBar activeTab={mobileTab} onTabChange={setMobileTab} />
				<div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
					<div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
						{/* Chat panel */}
						<div
							className="min-h-0 min-w-0 flex-1 flex-col"
							style={{ display: mobileTab === "chat" ? "flex" : "none" }}
						>
							{agentChatPanel}
						</div>
						{/* Diff panel */}
						<div
							className="min-h-0 min-w-0 flex-1 flex-col"
							style={{ display: mobileTab === "diff" ? "flex" : "none" }}
						>
							{isRuntimeAvailable ? (
								<DiffToolbar
									mode={diffMode}
									onModeChange={setDiffMode}
									isExpanded={false}
									onToggleExpand={handleToggleDiffExpand}
									hideExpand
									activeView="changes"
									onViewChange={() => {}}
								/>
							) : null}
							<div className="flex min-h-0 flex-1">
								{isWorkspaceChangesPending ? (
									<WorkspaceChangesLoadingPanel panelFlex="1 1 0" />
								) : hasNoWorkspaceFileChanges ? (
									<WorkspaceChangesEmptyPanel title={emptyDiffTitle} />
								) : (
									<DiffViewerPanel
										workspaceFiles={isRuntimeAvailable ? runtimeFiles : null}
										selectedPath={selectedPath}
										onSelectedPathChange={setSelectedPath}
										viewMode="unified"
										onAddToTerminal={
											onAddReviewComments || showClineAgentChatPanel
												? handleAddDiffComments
												: undefined
										}
										onSendToTerminal={
											onSendReviewComments || showClineAgentChatPanel
												? handleSendDiffComments
												: undefined
										}
										comments={diffComments}
										onCommentsChange={setDiffComments}
										onRevertFile={onRevertFile}
										onRevertHunk={onRevertHunk}
										onRequestBlame={onRequestBlame}
									/>
								)}
							</div>
						</div>
						{/* Files panel */}
						<div
							className="min-h-0 min-w-0 flex-1 flex-col"
							style={{ display: mobileTab === "files" ? "flex" : "none" }}
						>
							<FileTreePanel
								workspaceFiles={isRuntimeAvailable ? runtimeFiles : null}
								selectedPath={selectedPath}
								onSelectPath={(path: string) => {
									setSelectedPath(path);
									setMobileTab("diff");
								}}
								panelFlex="1 1 0"
							/>
						</div>
					</div>
					{/* Terminal panel — bottom overlay */}
					{showBottomTerminal ? (
						<div className="absolute bottom-0 left-0 right-0 z-20">
							<BottomTerminalSection
								taskId={bottomTerminalTaskId}
								workspaceId={currentProjectId}
								summary={bottomTerminalSummary}
								onSummary={onSessionSummary}
								onClose={onBottomTerminalClose}
								subtitle={bottomTerminalSubtitle}
								terminalThemeColors={terminalThemeColors}
								onConnectionReady={onBottomTerminalConnectionReady}
								agentCommand={bottomTerminalAgentCommand}
								onSendAgentCommand={onBottomTerminalSendAgentCommand}
								paneHeight={bottomTerminalPaneHeight}
								onPaneHeightChange={onBottomTerminalPaneHeightChange}
								onCollapse={onBottomTerminalCollapse}
								isExpanded={isBottomTerminalExpanded}
								onToggleExpand={onBottomTerminalToggleExpand}
								onResumeEndedSession={onResumeEndedSession}
							/>
						</div>
					) : null}
				</div>
			</div>
		);
	}

	return (
		<div
			ref={detailLayoutRef}
			className="flex min-h-0 flex-1 overflow-hidden bg-surface-0"
		>
			{!isDiffExpanded ? (
				<>
					<div
						className="flex min-h-0 min-w-0"
						style={{ width: taskCardsPanelPercent }}
					>
						<ColumnContextPanel
							selection={selection}
							workspacePath={workspacePath}
							onCardSelect={onCardSelect}
							taskSessions={taskSessions}
							onTaskDragEnd={onTaskDragEnd}
							onCreateTask={onCreateTask}
							onStartTask={onStartTask}
							onPauseTask={onPauseTask}
							onResumeTask={onResumeTask}
							onResumeEndedSession={onResumeEndedSession}
							onCancelAutoRun={onCancelAutoRun}
							onStartAllTasks={onStartAllTasks}
							onClearTrash={onClearTrash}
							editingTaskId={editingTaskId}
							inlineTaskEditor={inlineTaskEditor}
							onEditTask={onEditTask}
							onSaveTaskTitle={onSaveTaskTitle}
							onCommitTask={onCommitTask}
							onOpenPrTask={onOpenPrTask}
							onMoveToTrashTask={onMoveReviewCardToTrash}
							onRestoreFromTrashTask={onRestoreTaskFromTrash}
							commitTaskLoadingById={commitTaskLoadingById}
							openPrTaskLoadingById={openPrTaskLoadingById}
							moveToTrashLoadingById={moveToTrashLoadingById}
							panelWidth="100%"
							defaultClineModelId={
								runtimeConfig?.clineProviderSettings?.modelId ?? null
							}
						/>
					</div>
					<ResizeHandle
						orientation="vertical"
						ariaLabel="Resize task cards and detail panels"
						onMouseDown={handleSeparatorMouseDown}
						className="z-10"
					/>
				</>
			) : null}
			<div
				className="flex min-h-0 min-w-0 flex-col overflow-hidden"
				style={{ width: isDiffExpanded ? "100%" : detailContentPanelPercent }}
			>
				{gitHistoryPanel ? (
					<div className="flex min-h-0 flex-1 overflow-hidden">
						{gitHistoryPanel}
					</div>
				) : (
					<>
						{isSessionPausedOfflineForTask ? (
							<div
								data-testid="resume-ended-session-strip"
								className="flex shrink-0 items-center justify-between gap-2 border-b border-status-orange/30 bg-status-orange/10 px-3 py-2"
							>
								<p className="m-0 text-[12px] text-text-secondary">
									Paused — session ended when the app closed. Resume to continue
									with full history.
								</p>
								<Button
									variant="primary"
									size="sm"
									data-testid="resume-ended-session"
									icon={
										restartTaskLoadingById?.[selection.card.id] ? (
											<Spinner size={14} />
										) : (
											<Play size={14} />
										)
									}
									disabled={
										restartTaskLoadingById?.[selection.card.id] === true
									}
									onClick={() => onRestartTaskSession?.(selection.card.id)}
								>
									Resume agent
								</Button>
							</div>
						) : null}
						<Collapsible.Root
							open={isTaskConfigExpanded}
							onOpenChange={setIsTaskConfigExpanded}
							className="shrink-0 border-b border-border bg-surface-1"
						>
							<Collapsible.Trigger asChild>
								<button
									type="button"
									data-testid="task-config-toggle"
									className="flex w-full items-center justify-between gap-2 px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-2"
								>
									<span>Task configuration</span>
									{isTaskConfigExpanded ? (
										<ChevronDown size={14} />
									) : (
										<ChevronRight size={14} />
									)}
								</button>
							</Collapsible.Trigger>
							<Collapsible.Content className="overflow-hidden data-[state=closed]:animate-[kb-collapsible-up_200ms_ease-out] data-[state=open]:animate-[kb-collapsible-down_200ms_ease-out]">
								{onTaskManagerAccountChanged &&
								(taskManagerAccounts.length > 0 || apiSeats.length > 0) ? (
									<div
										data-testid="task-account-pin-strip"
										className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-1"
									>
										<TaskAccountPicker
											accounts={taskManagerAccounts}
											apiSeats={apiSeats}
											value={selection.card.managerAccountId}
											clineProviderId={
												selection.card.clineSettings?.providerId ?? null
											}
											activeAccountId={managerActiveAccountId}
											agentId={effectiveTaskAgentId}
											onChange={(seatSelection) => {
												if (seatSelection.kind === "api") {
													onTaskApiSeatChanged?.(selection.card.id, {
														providerId: seatSelection.providerId,
														modelId: seatSelection.modelId,
													});
													return;
												}
												if (effectiveTaskAgentId === "cline") {
													onTaskApiSeatChanged?.(selection.card.id, null);
												}
												onTaskManagerAccountChanged(
													selection.card.id,
													seatSelection.kind === "manager"
														? seatSelection.accountId
														: null,
												);
											}}
											subagentSeatProviderId={
												selection.card.taskLaunchSettings?.subagentSeatProviderId ??
												null
											}
											{...(onTaskLaunchSettingsChanged
												? {
														onSubagentSeatChange: (subagentSelection) => {
															onTaskLaunchSettingsChanged(
																selection.card.id,
																applyTaskSubagentSeatSelection(
																	subagentSelection,
																	selection.card.taskLaunchSettings,
																) ?? null,
															);
														},
													}
												: {})}
										/>
										{/* Only offer a restart when the card has an explicit pin that differs from the running session. */}
										{typeof sessionSummary?.managerAccountId === "number" &&
										typeof selection.card.managerAccountId === "number" &&
										sessionSummary.managerAccountId !==
											selection.card.managerAccountId &&
										(sessionSummary.state === "running" ||
											sessionSummary.state === "awaiting_review") ? (
											<button
												type="button"
												data-testid="restart-task-with-account"
												disabled={
													restartTaskLoadingById?.[selection.card.id] === true
												}
												onClick={() =>
													onRestartTaskSession?.(selection.card.id)
												}
												className="text-[10px] text-accent underline underline-offset-2 disabled:opacity-50 disabled:no-underline"
											>
												{restartTaskLoadingById?.[selection.card.id]
													? "Restarting…"
													: `Restart with ${
															pinnedManagerAccount?.displayName ??
															pinnedManagerAccount?.email ??
															`account ${selection.card.managerAccountId}`
														}`}
											</button>
										) : null}
									</div>
								) : null}
								{onTaskAutoResumeOnUsageLimitChanged ? (
									<div className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-1">
										<label
											className="flex cursor-pointer items-center gap-1.5 text-[11px] text-text-secondary"
											title="If this task hits the Claude usage limit, park it and auto-continue once the window resets."
										>
											<input
												type="checkbox"
												className="accent-accent"
												checked={selection.card.autoResumeOnUsageLimit === true}
												onChange={(event) => {
													onTaskAutoResumeOnUsageLimitChanged(
														selection.card.id,
														event.target.checked,
													);
												}}
											/>
											Auto-resume on usage limit
										</label>
									</div>
								) : null}
								{onTaskLaunchSettingsChanged ? (
									<div
										data-testid="task-launch-settings-strip"
										className="px-2 py-2"
									>
										<TaskLaunchSettingsPicker
											active
											agentId={selection.card.agentId}
											defaultAgentId={selectedAgentId}
											workspaceId={currentProjectId}
											value={selection.card.taskLaunchSettings}
											sessionAppliesOnRestart={
												sessionSummary?.state === "running" ||
												sessionSummary?.state === "awaiting_review"
											}
											onChange={(next) => {
												onTaskLaunchSettingsChanged(
													selection.card.id,
													next ?? null,
												);
											}}
										/>
									</div>
								) : null}
							</Collapsible.Content>
						</Collapsible.Root>
						<div
							ref={mainRowRef}
							className="flex min-h-0 flex-1 overflow-hidden"
						>
							<div
								className="min-h-0 min-w-0"
								style={{
									display: isDiffExpanded ? "none" : "flex",
									width: agentPanelPercent,
								}}
							>
								{agentChatPanel}
							</div>
							{!isDiffExpanded ? (
								<ResizeHandle
									orientation="vertical"
									ariaLabel="Resize agent and diff panels"
									onMouseDown={handleAgentDiffSeparatorMouseDown}
									className="z-10"
								/>
							) : null}
							<div
								className="flex min-h-0 min-w-0 flex-col"
								style={{ width: isDiffExpanded ? "100%" : diffPanelPercent }}
							>
								{isRuntimeAvailable ||
								(planReadyForSave && planTextForSave) ||
								devtoolsUrl ? (
									<DiffToolbar
										mode={diffMode}
										onModeChange={setDiffMode}
										isExpanded={isDiffExpanded}
										onToggleExpand={handleToggleDiffExpand}
										planReady={Boolean(planReadyForSave && planTextForSave)}
										devtoolsReady={Boolean(devtoolsUrl)}
										activeView={diffPanelView}
										onViewChange={setDiffPanelView}
									/>
								) : null}
								<div className="flex min-h-0 flex-1">
									{diffPanelView === "devtools" && devtoolsUrl ? (
										<iframe
											src={devtoolsUrl}
											title="Claude DevTools"
											data-testid="detail-devtools-frame"
											className="min-h-0 min-w-0 flex-1 border-0"
										/>
									) : diffPanelView === "plan" &&
										planReadyForSave &&
										planTextForSave ? (
										<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
											<div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
												<span className="text-[12px] font-medium text-text-primary">
													Plan ready for review
												</span>
												<Button
													type="button"
													variant="primary"
													size="sm"
													data-testid="save-plan-button"
													disabled={planAlreadySaved || isSavingPlan}
													onClick={() => {
														void (async () => {
															try {
																const plan = await savePlan({
																	name:
																		selection.card.title.trim() ||
																		"Untitled plan",
																	content: planTextForSave,
																});
																setSavedPlanTextKey(planTextForSave);
																trackPlanSaved({
																	plan_id: plan.id,
																	name_character_count: plan.name.length,
																	content_character_count:
																		planTextForSave.length,
																});
																showAppToast({
																	intent: "success",
																	message: `Saved plan "${plan.name}".`,
																});
																onSavePlan?.(plan);
															} catch (error) {
																showAppToast({
																	intent: "danger",
																	message:
																		error instanceof Error
																			? error.message
																			: "Failed to save plan.",
																});
															}
														})();
													}}
												>
													{planAlreadySaved
														? "Plan Saved"
														: isSavingPlan
															? "Saving…"
															: "Save Plan"}
												</Button>
											</div>
											<div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-[12px]">
												<PlanMarkdownPreview
													content={planTextForSave}
													planId={null}
												/>
											</div>
										</div>
									) : isWorkspaceChangesPending ? (
										<WorkspaceChangesLoadingPanel
											panelFlex={detailDiffFileTreePanelFlex}
										/>
									) : hasNoWorkspaceFileChanges ? (
										<WorkspaceChangesEmptyPanel title={emptyDiffTitle} />
									) : (
										<div ref={detailDiffRowRef} className="flex min-w-0 flex-1">
											<div
												className="flex min-h-0 min-w-0"
												style={{ flex: `0 0 ${detailDiffContentPanelPercent}` }}
											>
												<DiffViewerPanel
													workspaceFiles={
														isRuntimeAvailable ? runtimeFiles : null
													}
													selectedPath={selectedPath}
													onSelectedPathChange={setSelectedPath}
													viewMode={isDiffExpanded ? "split" : "unified"}
													onAddToTerminal={
														onAddReviewComments || showClineAgentChatPanel
															? handleAddDiffComments
															: undefined
													}
													onSendToTerminal={
														onSendReviewComments || showClineAgentChatPanel
															? handleSendDiffComments
															: undefined
													}
													comments={diffComments}
													onCommentsChange={setDiffComments}
													onRevertFile={onRevertFile}
													onRevertHunk={onRevertHunk}
													onRequestBlame={onRequestBlame}
												/>
											</div>
											<ResizeHandle
												orientation="vertical"
												ariaLabel="Resize detail diff panels"
												onMouseDown={handleDetailDiffSeparatorMouseDown}
												className="z-10"
											/>
											<div
												className="flex min-h-0 min-w-0"
												style={{
													flex: `0 0 ${detailDiffFileTreePanelPercent}`,
												}}
											>
												<FileTreePanel
													workspaceFiles={
														isRuntimeAvailable ? runtimeFiles : null
													}
													selectedPath={selectedPath}
													onSelectPath={setSelectedPath}
													panelFlex="1 1 0"
												/>
											</div>
										</div>
									)}
								</div>
							</div>
						</div>
						{bottomTerminalOpen && bottomTerminalTaskId ? (
							<BottomTerminalSection
								taskId={bottomTerminalTaskId}
								workspaceId={currentProjectId}
								summary={bottomTerminalSummary}
								onSummary={onSessionSummary}
								onClose={onBottomTerminalClose}
								subtitle={bottomTerminalSubtitle}
								terminalThemeColors={terminalThemeColors}
								onConnectionReady={onBottomTerminalConnectionReady}
								agentCommand={bottomTerminalAgentCommand}
								onSendAgentCommand={onBottomTerminalSendAgentCommand}
								paneHeight={bottomTerminalPaneHeight}
								onPaneHeightChange={onBottomTerminalPaneHeightChange}
								onCollapse={onBottomTerminalCollapse}
								isExpanded={isBottomTerminalExpanded}
								onToggleExpand={onBottomTerminalToggleExpand}
								onResumeEndedSession={onResumeEndedSession}
							/>
						) : null}
					</>
				)}
			</div>
		</div>
	);
}
