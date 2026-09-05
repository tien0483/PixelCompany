import { Draggable } from "@hello-pangea/dnd";
import { getRuntimeAgentCatalogEntry } from "@runtime-agent-catalog";
import { formatClineToolCallLabel } from "@runtime-cline-tool-call-display";
import { buildTaskWorktreeDisplayPath } from "@runtime-task-worktree-path";
import {
	AlertCircle,
	AlertTriangle,
	Bot,
	Clock,
	GitBranch,
	GitCommit,
	GitMerge,
	Hourglass,
	Pause,
	Pencil,
	Play,
	RotateCcw,
	Trash2,
	X,
} from "lucide-react";
import type { KeyboardEvent, MouseEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	BoardCardReviewGitActions,
	type ReviewGitBranchedSubmit,
} from "@/components/board-card-review-git-actions";
import {
	formatClineReasoningEffortLabel,
	formatClineSelectedModelButtonText,
	resolveClineModelDisplayName,
} from "@/components/detail-panels/cline-model-picker-options";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { getTaskCommitsAhead, resolveTaskGitReadiness } from "@/git-actions/task-git-readiness";
import { useCountdownMs, useElapsedMs } from "@/hooks/use-elapsed-timer";
import { isSessionPausedLive, isSessionPausedOffline, pausedOfflineBadgeLabel } from "@/runtime/session-status";
import type { RuntimeAuthFailoverOutcome, RuntimeTaskSessionSummary } from "@/runtime/types";
import { useTaskWorkspaceInfoValue, useTaskWorkspaceSnapshotValue } from "@/stores/workspace-metadata-store";
import type { BoardCard as BoardCardModel, BoardColumnId } from "@/types";
import { getTaskAutoReviewCancelButtonLabel } from "@/types";
import { formatElapsed } from "@/utils/format-elapsed";
import { formatPathForDisplay } from "@/utils/path-display";
import { useMeasure } from "@/utils/react-use";
import {
	clampTextWithInlineSuffix,
	getTaskPromptDescription,
	normalizePromptForDisplay,
	truncateTaskPromptLabel,
} from "@/utils/task-prompt";
import {
	DEFAULT_TEXT_MEASURE_FONT,
	measureTextWidth,
	readElementFontShorthand,
} from "@/utils/text-measure";

interface CardSessionActivity {
	dotColor: string;
	text: string;
}

const SESSION_ACTIVITY_COLOR = {
	thinking: "var(--color-status-blue)",
	success: "var(--color-status-green)",
	waiting: "var(--color-status-gold)",
	error: "var(--color-status-red)",
	warning: "var(--color-status-orange)",
	muted: "var(--color-text-tertiary)",
	secondary: "var(--color-text-secondary)",
} as const;

const DESCRIPTION_COLLAPSE_LINES = 3;
const DESCRIPTION_EXPANDED_MAX_LINES = 10;
const DESCRIPTION_EXPAND_LABEL = "See more";
const DESCRIPTION_COLLAPSE_LABEL = "Less";
const DESCRIPTION_COLLAPSE_SUFFIX = `… ${DESCRIPTION_EXPAND_LABEL}`;
const DESCRIPTION_EXPANDED_SUFFIX = `… ${DESCRIPTION_COLLAPSE_LABEL}`;

function reconstructTaskWorktreeDisplayPath(
	taskId: string,
	workspacePath: string | null | undefined,
): string | null {
	if (!workspacePath) {
		return null;
	}
	try {
		return buildTaskWorktreeDisplayPath(taskId, workspacePath);
	} catch {
		return null;
	}
}

function extractToolInputSummaryFromActivityText(
	activityText: string,
	toolName: string,
): string | null {
	const escapedToolName = toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = activityText.match(
		new RegExp(
			`^(?:Using|Completed|Failed|Calling)\\s+${escapedToolName}(?::\\s*(.+))?$`,
		),
	);
	if (!match) {
		return null;
	}
	const rawSummary = match[1]?.trim() ?? "";
	if (!rawSummary) {
		return null;
	}
	if (activityText.startsWith("Failed ")) {
		const [operationSummary] = rawSummary.split(": ");
		return operationSummary?.trim() || null;
	}
	return rawSummary;
}

function parseToolCallFromActivityText(
	activityText: string,
): { toolName: string; toolInputSummary: string | null } | null {
	const match = activityText.match(
		/^(?:Using|Completed|Failed|Calling)\s+([^:()]+?)(?::\s*(.+))?$/,
	);
	if (!match?.[1]) {
		return null;
	}
	const toolName = match[1].trim();
	if (!toolName) {
		return null;
	}
	const rawSummary = match[2]?.trim() ?? "";
	if (!rawSummary) {
		return { toolName, toolInputSummary: null };
	}
	if (activityText.startsWith("Failed ")) {
		const [operationSummary] = rawSummary.split(": ");
		return {
			toolName,
			toolInputSummary: operationSummary?.trim() || null,
		};
	}
	return {
		toolName,
		toolInputSummary: rawSummary,
	};
}

function resolveToolCallLabel(
	activityText: string | undefined,
	toolName: string | null,
	toolInputSummary: string | null,
): string | null {
	if (toolName) {
		const parsedSummary = extractToolInputSummaryFromActivityText(
			activityText ?? "",
			toolName,
		);
		if (!toolInputSummary && !parsedSummary) {
			return null;
		}
		return formatClineToolCallLabel(
			toolName,
			toolInputSummary ?? parsedSummary,
		);
	}
	if (!activityText) {
		return null;
	}
	const parsed = parseToolCallFromActivityText(activityText);
	if (!parsed) {
		return null;
	}
	return formatClineToolCallLabel(parsed.toolName, parsed.toolInputSummary);
}

function isCardCreditLimitError(
	summary: RuntimeTaskSessionSummary | undefined,
): boolean {
	if (!summary) {
		return false;
	}
	if (
		summary.state !== "awaiting_review" &&
		summary.state !== "failed" &&
		summary.state !== "interrupted"
	) {
		return false;
	}
	return summary.latestHookActivity?.notificationType === "credit_limit";
}

export function isPlanReadyForSave(
	card: BoardCardModel,
	summary: RuntimeTaskSessionSummary | undefined,
): boolean {
	return Boolean(
		card.startInPlanMode &&
			summary?.state === "awaiting_review" &&
			summary.latestHookActivity?.toolName === "ExitPlanMode" &&
			summary.latestHookActivity?.planText,
	);
}

/** "Paused · resumes 5:00 PM" for a usage-limit-paused card; bare "Paused" when the reset is unknown. */
function formatUsagePausedLabel(resumeAt: number | null | undefined): string {
	if (typeof resumeAt !== "number" || !Number.isFinite(resumeAt)) {
		return "Paused — waiting for usage reset";
	}
	const resetTime = new Date(resumeAt).toLocaleTimeString([], {
		hour: "numeric",
		minute: "2-digit",
	});
	return `Paused · resumes ${resetTime}`;
}

/** Short, card-sized explanation for why Claude's automatic seat failover didn't restart the task. */
function formatAuthFailoverOutcomeLabel(
	outcome: RuntimeAuthFailoverOutcome | null | undefined,
	detail: string | null | undefined,
): string | null {
	switch (outcome) {
		case "cap_reached":
			return "Retry limit reached — switch seats manually";
		case "no_healthy_seat":
			return "No other healthy seat available";
		case "seat_prep_failed":
			return "Couldn't prepare the new seat's credentials";
		case "restart_failed":
			return detail ? `Restart failed: ${detail.trim().slice(0, 80)}` : "Restart failed";
		case "login_recovery_restarted":
			return "Login expired — restarted on the same seat";
		case "login_recovery_failed":
			return detail
				? `Login recovery failed: ${detail.trim().slice(0, 80)}`
				: "Login recovery failed — seat needs /login";
		default:
			return null;
	}
}

function getCardSessionActivity(
	summary: RuntimeTaskSessionSummary | undefined,
): CardSessionActivity | null {
	if (!summary) {
		return null;
	}
	if (
		summary.state === "awaiting_review" &&
		summary.reviewReason === "usage_paused"
	) {
		return {
			dotColor: SESSION_ACTIVITY_COLOR.waiting,
			text: formatUsagePausedLabel(summary.resumeAt),
		};
	}
	if (isCardCreditLimitError(summary)) {
		return { dotColor: SESSION_ACTIVITY_COLOR.warning, text: "Out of credits" };
	}
	if (
		summary.state === "awaiting_review" &&
		summary.latestHookActivity?.toolName === "ExitPlanMode" &&
		summary.latestHookActivity?.planText
	) {
		return {
			dotColor: SESSION_ACTIVITY_COLOR.success,
			text: "Plan ready for review",
		};
	}
	const hookActivity = summary.latestHookActivity;
	const activityText = hookActivity?.activityText?.trim();
	const toolName = hookActivity?.toolName?.trim() ?? null;
	const toolInputSummary = hookActivity?.toolInputSummary?.trim() ?? null;
	const finalMessage = hookActivity?.finalMessage?.trim();
	const hookEventName = hookActivity?.hookEventName?.trim() ?? null;
	if (
		(summary.state === "awaiting_review" && summary.reviewReason === "error") ||
		summary.state === "failed"
	) {
		const failoverText = formatAuthFailoverOutcomeLabel(summary.authFailoverOutcome, summary.authFailoverOutcomeDetail);
		return {
			dotColor: SESSION_ACTIVITY_COLOR.error,
			text: failoverText ?? finalMessage ?? summary.warningMessage?.trim() ?? "Agent failed",
		};
	}
	if (summary.state === "awaiting_review" && finalMessage) {
		return { dotColor: SESSION_ACTIVITY_COLOR.success, text: finalMessage };
	}
	if (
		finalMessage &&
		!toolName &&
		(hookEventName === "assistant_delta" ||
			hookEventName === "agent_end" ||
			hookEventName === "turn_start")
	) {
		return {
			dotColor:
				summary.state === "running"
					? SESSION_ACTIVITY_COLOR.thinking
					: SESSION_ACTIVITY_COLOR.success,
			text: finalMessage,
		};
	}
	if (activityText) {
		let dotColor: string = SESSION_ACTIVITY_COLOR.thinking;
		let text = activityText;
		const toolCallLabel = resolveToolCallLabel(
			activityText,
			toolName,
			toolInputSummary,
		);
		if (toolCallLabel) {
			if (text.startsWith("Failed ")) {
				dotColor = SESSION_ACTIVITY_COLOR.error;
			}
			return {
				dotColor,
				text: toolCallLabel,
			};
		}
		if (text.startsWith("Final: ")) {
			dotColor = SESSION_ACTIVITY_COLOR.success;
			text = text.slice(7);
		} else if (text.startsWith("Agent: ")) {
			text = text.slice(7);
		} else if (text.startsWith("Waiting for approval")) {
			dotColor = SESSION_ACTIVITY_COLOR.waiting;
		} else if (text.startsWith("Waiting for review")) {
			dotColor = SESSION_ACTIVITY_COLOR.success;
		} else if (text.startsWith("Failed ")) {
			dotColor = SESSION_ACTIVITY_COLOR.error;
		} else if (
			text === "Agent active" ||
			text === "Working on task" ||
			text.startsWith("Resumed")
		) {
			return { dotColor: SESSION_ACTIVITY_COLOR.thinking, text: "Thinking..." };
		}
		return { dotColor, text };
	}
	if (summary.state === "awaiting_review") {
		return {
			dotColor: SESSION_ACTIVITY_COLOR.success,
			text: "Waiting for review",
		};
	}
	if (summary.state === "running") {
		return { dotColor: SESSION_ACTIVITY_COLOR.thinking, text: "Thinking..." };
	}
	return null;
}

export function BoardCard({
	card,
	index,
	columnId,
	sessionSummary,
	selected = false,
	onClick,
	onStart,
	onPause,
	onResume,
	onResumeEndedSession,
	onCancelAutoRun,
	onDelete,
	onMoveToTrash,
	onRestoreFromTrash,
	onSaveTitle,
	onCommit,
	onOpenPr: _onOpenPr,
	onSubmitReviewGit,
	onCancelReviewGitForm,
	onOpenReviewGitForm,
	onRetryReviewGitFollowOn,
	reviewGitStatusMessage = null,
	canRetryReviewGitFollowOn = false,
	branchSuggestions,
	onMerge,
	onCancelAutomaticAction,
	isCommitLoading = false,
	isOpenPrLoading: _isOpenPrLoading = false,
	isMergeLoading = false,
	isMoveToTrashLoading = false,
	onDependencyPointerDown,
	onDependencyPointerEnter,
	isDependencySource = false,
	isDependencyTarget = false,
	isDependencyLinking = false,
	workspacePath,
	defaultClineModelId = null,
}: {
	card: BoardCardModel;
	index: number;
	columnId: BoardColumnId;
	sessionSummary?: RuntimeTaskSessionSummary;
	selected?: boolean;
	onClick?: () => void;
	onStart?: (taskId: string) => void;
	onPause?: (taskId: string) => void;
	onResume?: (taskId: string) => void;
	/** Resumes a paused-offline (PTY already exited) session via `--continue`, instead of writing "continue" to a live PTY. */
	onResumeEndedSession?: (taskId: string) => void;
	onCancelAutoRun?: (taskId: string) => void;
	onDelete?: (taskId: string) => void;
	onMoveToTrash?: (taskId: string) => void;
	onRestoreFromTrash?: (taskId: string) => void;
	onSaveTitle?: (taskId: string, title: string) => void;
	onCommit?: (taskId: string) => void;
	/** @deprecated Prefer onSubmitReviewGit; kept for call-site compatibility during migration. */
	onOpenPr?: (taskId: string) => void;
	onSubmitReviewGit?: (taskId: string, input: ReviewGitBranchedSubmit) => void;
	onCancelReviewGitForm?: (taskId: string) => void;
	onOpenReviewGitForm?: (taskId: string) => void;
	onRetryReviewGitFollowOn?: (taskId: string) => void;
	reviewGitStatusMessage?: string | null;
	canRetryReviewGitFollowOn?: boolean;
	branchSuggestions?: readonly string[];
	onMerge?: (taskId: string) => void;
	onCancelAutomaticAction?: (taskId: string) => void;
	isCommitLoading?: boolean;
	isOpenPrLoading?: boolean;
	isMergeLoading?: boolean;
	isMoveToTrashLoading?: boolean;
	onDependencyPointerDown?: (
		taskId: string,
		event: MouseEvent<HTMLElement>,
		options?: { viaHandle?: boolean },
	) => void;
	onDependencyPointerEnter?: (taskId: string) => void;
	isDependencySource?: boolean;
	isDependencyTarget?: boolean;
	isDependencyLinking?: boolean;
	workspacePath?: string | null;
	defaultClineModelId?: string | null;
}): React.ReactElement {
	const [isHovered, setIsHovered] = useState(false);
	const [isEditingTitle, setIsEditingTitle] = useState(false);
	const [draftTitle, setDraftTitle] = useState(card.title);
	const titleInputRef = useRef<HTMLInputElement | null>(null);
	const titleEditCancelledRef = useRef(false);
	const [descriptionContainerRef, descriptionRect] =
		useMeasure<HTMLDivElement>();
	const descriptionRef = useRef<HTMLParagraphElement | null>(null);
	const [descriptionWidthFallback, setDescriptionWidthFallback] = useState(0);
	const [descriptionFont, setDescriptionFont] = useState(
		DEFAULT_TEXT_MEASURE_FONT,
	);
	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
	const reviewWorkspaceSnapshot = useTaskWorkspaceSnapshotValue(card.id);
	const taskWorkspaceInfo = useTaskWorkspaceInfoValue(card.id);
	const baseRefHint = taskWorkspaceInfo?.baseRef ?? card.baseRef;
	const isTrashCard = columnId === "trash";
	const isCardInteractive = !isTrashCard;
	const descriptionWidth =
		descriptionRect.width > 0
			? descriptionRect.width
			: descriptionWidthFallback;
	const rawSessionActivity = useMemo(
		() => getCardSessionActivity(sessionSummary),
		[sessionSummary],
	);
	const lastSessionActivityRef = useRef<CardSessionActivity | null>(null);
	const lastSessionActivityCardIdRef = useRef<string | null>(null);
	if (lastSessionActivityCardIdRef.current !== card.id) {
		lastSessionActivityCardIdRef.current = card.id;
		lastSessionActivityRef.current = null;
	}
	if (rawSessionActivity) {
		lastSessionActivityRef.current = rawSessionActivity;
	}
	const sessionActivity = rawSessionActivity ?? lastSessionActivityRef.current;
	const isPaused = sessionSummary?.pausedAt != null;
	const isPausedOffline = sessionSummary ? isSessionPausedOffline(sessionSummary) : false;
	const isPausedLive = sessionSummary ? isSessionPausedLive(sessionSummary) : false;
	const pausedByMaxRuntime = sessionSummary?.pauseReason === "max_runtime";
	const elapsedMs = useElapsedMs(sessionSummary);
	const showElapsed =
		columnId === "in_progress" &&
		sessionSummary != null &&
		(sessionSummary.runningSince != null ||
			sessionSummary.activeRunMs > 0 ||
			isPaused);
	const autoRunRemainingMs = useCountdownMs(
		columnId === "backlog" ? card.autoRunAt : null,
	);
	const showAutoRunCountdown =
		columnId === "backlog" && autoRunRemainingMs != null;
	const displayTitle = useMemo(
		() =>
			normalizePromptForDisplay(card.title) ||
			truncateTaskPromptLabel(card.prompt),
		[card.prompt, card.title],
	);
	const displayDescription = useMemo(
		() => getTaskPromptDescription(card.prompt, displayTitle),
		[card.prompt, displayTitle],
	);

	useLayoutEffect(() => {
		if (descriptionRect.width > 0 || !displayDescription) {
			return;
		}
		const nextWidth =
			descriptionRef.current?.parentElement?.getBoundingClientRect().width ?? 0;
		if (nextWidth > 0 && nextWidth !== descriptionWidthFallback) {
			setDescriptionWidthFallback(nextWidth);
		}
	}, [descriptionRect.width, descriptionWidthFallback, displayDescription]);

	useLayoutEffect(() => {
		setDescriptionFont(
			readElementFontShorthand(
				descriptionRef.current,
				DEFAULT_TEXT_MEASURE_FONT,
			),
		);
	}, [descriptionWidth, displayDescription]);

	useEffect(() => {
		setIsDescriptionExpanded(false);
	}, [card.id, displayDescription]);

	useEffect(() => {
		setDraftTitle(card.title);
		setIsEditingTitle(false);
	}, [card.id, card.title]);

	useEffect(() => {
		if (!isEditingTitle) {
			return;
		}
		window.requestAnimationFrame(() => {
			titleInputRef.current?.focus();
			titleInputRef.current?.select();
		});
	}, [isEditingTitle]);

	const stopEvent = (event: MouseEvent<HTMLElement>) => {
		event.preventDefault();
		event.stopPropagation();
	};

	const submitTitle = () => {
		if (titleEditCancelledRef.current) {
			titleEditCancelledRef.current = false;
			return;
		}
		setIsEditingTitle(false);
		if (!onSaveTitle) {
			return;
		}
		const trimmed = draftTitle.trim();
		if (trimmed === card.title) {
			return;
		}
		onSaveTitle(card.id, trimmed);
	};

	const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			event.preventDefault();
			event.stopPropagation();
			titleInputRef.current?.blur();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			titleEditCancelledRef.current = true;
			setDraftTitle(card.title);
			setIsEditingTitle(false);
			titleInputRef.current?.blur();
		}
	};

	const isDescriptionMeasured = descriptionRect.width > 0;

	const descriptionDisplay = useMemo(() => {
		if (!displayDescription) {
			return {
				collapsed: { text: "", isTruncated: false },
				expanded: { text: "", isTruncated: false },
			};
		}
		if (descriptionWidth <= 0) {
			return {
				collapsed: { text: displayDescription, isTruncated: false },
				expanded: { text: displayDescription, isTruncated: false },
			};
		}
		const measure = (value: string) => measureTextWidth(value, descriptionFont);
		return {
			collapsed: clampTextWithInlineSuffix(displayDescription, {
				maxWidthPx: descriptionWidth,
				maxLines: DESCRIPTION_COLLAPSE_LINES,
				suffix: DESCRIPTION_COLLAPSE_SUFFIX,
				measureText: measure,
			}),
			expanded: clampTextWithInlineSuffix(displayDescription, {
				maxWidthPx: descriptionWidth,
				maxLines: DESCRIPTION_EXPANDED_MAX_LINES,
				suffix: DESCRIPTION_EXPANDED_SUFFIX,
				measureText: measure,
			}),
		};
	}, [descriptionFont, descriptionWidth, displayDescription]);

	const isCreditLimit = isCardCreditLimitError(sessionSummary);
	const renderStatusMarker = () => {
		if (isCreditLimit) {
			return <AlertTriangle size={12} className="text-status-orange" />;
		}
		if (columnId === "in_progress") {
			if (sessionSummary?.state === "failed") {
				return <AlertCircle size={12} className="text-status-red" />;
			}
			return <Spinner size={12} />;
		}
		return null;
	};
	const statusMarker = renderStatusMarker();
	const showWorkspaceStatus =
		columnId === "in_progress" || columnId === "review" || isTrashCard;
	const reviewWorkspacePath = reviewWorkspaceSnapshot
		? formatPathForDisplay(reviewWorkspaceSnapshot.path)
		: isTrashCard
			? reconstructTaskWorktreeDisplayPath(card.id, workspacePath)
			: null;
	const reviewRefLabel =
		reviewWorkspaceSnapshot?.branch ??
		reviewWorkspaceSnapshot?.headCommit?.slice(0, 8) ??
		"HEAD";
	const gitReadiness = resolveTaskGitReadiness(reviewWorkspaceSnapshot);
	const commitsAhead = getTaskCommitsAhead(reviewWorkspaceSnapshot);
	// A committed-and-clean worktree renders "0 files +0 -0", which reads as "nothing was
	// done". The commit counter below is the honest signal there, so drop the summary.
	const reviewChangeSummary =
		reviewWorkspaceSnapshot && reviewWorkspaceSnapshot.changedFiles != null && gitReadiness !== "ready"
			? {
					filesLabel: `${reviewWorkspaceSnapshot.changedFiles} ${reviewWorkspaceSnapshot.changedFiles === 1 ? "file" : "files"}`,
					additions: reviewWorkspaceSnapshot.additions ?? 0,
					deletions: reviewWorkspaceSnapshot.deletions ?? 0,
				}
			: null;
	const showReviewGitActions = columnId === "review" && gitReadiness === "dirty";
	const canMergeToBase = columnId === "review" && (gitReadiness === "dirty" || gitReadiness === "ready");
	const isAnyGitActionLoading = isCommitLoading || isMergeLoading;
	const cancelAutomaticActionLabel =
		!isTrashCard && card.autoReviewEnabled
			? getTaskAutoReviewCancelButtonLabel(card.autoReviewMode)
			: null;
	const agentOverrideLabel = useMemo(
		() =>
			card.agentId
				? (getRuntimeAgentCatalogEntry(card.agentId)?.label ?? card.agentId)
				: null,
		[card.agentId],
	);
	const modelOverrideLabel = useMemo(() => {
		if (card.clineSettings === undefined) {
			return null;
		}
		const explicitReasoningLabel = card.clineSettings.reasoningEffort
			? formatClineReasoningEffortLabel(card.clineSettings.reasoningEffort)
			: !card.clineSettings.providerId && !card.clineSettings.modelId
				? "Default"
				: null;
		if (card.clineSettings.providerId && !card.clineSettings.modelId) {
			const providerLabel = `Provider: ${card.clineSettings.providerId}`;
			return explicitReasoningLabel
				? `${providerLabel} (${explicitReasoningLabel})`
				: providerLabel;
		}
		const effectiveModelId = card.clineSettings.modelId ?? defaultClineModelId;
		if (!effectiveModelId) {
			return explicitReasoningLabel
				? `Default model (${explicitReasoningLabel})`
				: null;
		}
		const modelName = resolveClineModelDisplayName(effectiveModelId);
		if (explicitReasoningLabel) {
			return `${modelName} (${explicitReasoningLabel})`;
		}
		const inheritedReasoningEffort = "";
		return formatClineSelectedModelButtonText({
			modelName,
			reasoningEffort: inheritedReasoningEffort,
			showReasoningEffort: Boolean(inheritedReasoningEffort),
		});
	}, [card.clineSettings, defaultClineModelId]);
	const taskAgentSettingsLabel = useMemo(() => {
		const parts = [agentOverrideLabel, modelOverrideLabel].filter(
			(value): value is string => Boolean(value),
		);
		return parts.length > 0 ? parts.join(" · ") : null;
	}, [agentOverrideLabel, modelOverrideLabel]);

	const activeDescriptionDisplay = isDescriptionExpanded
		? descriptionDisplay.expanded
		: descriptionDisplay.collapsed;

	return (
		<Draggable draggableId={card.id} index={index} isDragDisabled={false}>
			{(provided, snapshot) => {
				const isDragging = snapshot.isDragging;
				const draggableContent = (
					<div
						ref={provided.innerRef}
						{...provided.draggableProps}
						{...provided.dragHandleProps}
						className="kb-board-card-shell"
						data-task-id={card.id}
						data-column-id={columnId}
						data-selected={selected}
						onMouseDownCapture={(event) => {
							if (!isCardInteractive) {
								return;
							}
							if (isDependencyLinking) {
								event.preventDefault();
								event.stopPropagation();
								return;
							}
							if (!event.metaKey && !event.ctrlKey) {
								return;
							}
							const target = event.target as HTMLElement | null;
							if (
								target?.closest(
									"button, a, input, textarea, [contenteditable='true']",
								)
							) {
								return;
							}
							event.preventDefault();
							event.stopPropagation();
							onDependencyPointerDown?.(card.id, event);
						}}
						onClick={(event) => {
							if (!isCardInteractive) {
								return;
							}
							if (isDependencyLinking) {
								event.preventDefault();
								event.stopPropagation();
								return;
							}
							if (event.metaKey || event.ctrlKey) {
								return;
							}
							const target = event.target as HTMLElement | null;
							if (
								target?.closest(
									"button, a, input, textarea, [contenteditable='true']",
								)
							) {
								return;
							}
							if (!snapshot.isDragging && onClick) {
								onClick();
							}
						}}
						style={{
							...provided.draggableProps.style,
							marginBottom: 6,
							cursor: "grab",
						}}
						onMouseEnter={() => {
							setIsHovered(true);
							onDependencyPointerEnter?.(card.id);
						}}
						onMouseMove={() => {
							if (!isDependencyLinking) {
								return;
							}
							onDependencyPointerEnter?.(card.id);
						}}
						onMouseLeave={() => setIsHovered(false)}
					>
						<div
							title={card.prompt}
							className={cn(
								"relative rounded-md border border-border-bright bg-surface-2 p-2.5",
								isCardInteractive &&
									"cursor-pointer hover:bg-surface-3 hover:border-border-bright",
								isDragging && "shadow-lg",
								isHovered &&
									isCardInteractive &&
									"bg-surface-3 border-border-bright",
								isDependencySource && "kb-board-card-dependency-source",
								isDependencyTarget && "kb-board-card-dependency-target",
							)}
						>
							{isCardInteractive && onDependencyPointerDown ? (
								<button
									type="button"
									aria-label="Drag onto another task to link"
									title="Drag onto another task to link. Two Backlog tasks form a chain (shared worktree)."
									className={cn(
										"kb-board-card-link-handle",
										(isHovered || isDependencyLinking) &&
											"kb-board-card-link-handle-visible",
									)}
									onMouseDown={(event) => {
										event.preventDefault();
										event.stopPropagation();
										onDependencyPointerDown(card.id, event, {
											viaHandle: true,
										});
									}}
									onClick={stopEvent}
								/>
							) : null}
							<div
								className="flex items-center gap-2"
								style={{ minHeight: 24 }}
							>
								{statusMarker ? (
									<div className="inline-flex items-center">{statusMarker}</div>
								) : null}
								<div className="flex-1 min-w-0">
									{isEditingTitle ? (
										<input
											ref={titleInputRef}
											value={draftTitle}
											onChange={(event) =>
												setDraftTitle(event.currentTarget.value)
											}
											onBlur={submitTitle}
											onKeyDown={handleTitleKeyDown}
											onMouseDown={(event) => {
												event.stopPropagation();
											}}
											className="h-7 w-full rounded-md border border-border-focus bg-surface-2 px-2 text-sm font-medium text-text-primary focus:outline-none"
										/>
									) : onSaveTitle ? (
										<div className="flex items-center gap-1 min-w-0">
											<p
												className={cn(
													"kb-line-clamp-1 m-0 min-w-0 font-medium text-sm",
													isTrashCard && "line-through text-text-tertiary",
												)}
											>
												{displayTitle}
											</p>
											<button
												type="button"
												aria-label="Edit task title"
												onMouseDown={stopEvent}
												onClick={(event) => {
													stopEvent(event);
													setDraftTitle(card.title);
													setIsEditingTitle(true);
												}}
												className={cn(
													"shrink-0 cursor-pointer rounded-sm p-0.5 text-text-tertiary hover:text-text-primary focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
													isHovered ? "opacity-100" : "opacity-0",
												)}
											>
												<Pencil size={12} />
											</button>
										</div>
									) : (
										<p
											className={cn(
												"kb-line-clamp-1 m-0 font-medium text-sm",
												isTrashCard && "line-through text-text-tertiary",
											)}
										>
											{displayTitle}
										</p>
									)}
								</div>
								{columnId === "backlog" ? (
									<>
										<Button
											icon={<Trash2 size={13} />}
											variant="ghost"
											size="sm"
											className="text-status-red hover:text-status-red"
											aria-label="Delete task"
											onMouseDown={stopEvent}
											onClick={(event) => {
												stopEvent(event);
												onDelete?.(card.id);
											}}
										/>
										<Button
											icon={<Play size={14} />}
											variant="ghost"
											size="sm"
											aria-label="Start task"
											onMouseDown={stopEvent}
											onClick={(event) => {
												stopEvent(event);
												onStart?.(card.id);
											}}
										/>
									</>
								) : columnId === "review" ? (
									<Button
										icon={
											isMoveToTrashLoading ? (
												<Spinner size={13} />
											) : (
												<Trash2 size={13} />
											)
										}
										variant="ghost"
										size="sm"
										disabled={isMoveToTrashLoading}
										aria-label="Move task to done"
										onMouseDown={stopEvent}
										onClick={(event) => {
											stopEvent(event);
											onMoveToTrash?.(card.id);
										}}
									/>
								) : columnId === "trash" ? (
									<Tooltip
										side="bottom"
										content={
											<>
												Restore session
												<br />
												in new worktree
											</>
										}
									>
										<Button
											icon={<RotateCcw size={12} />}
											variant="ghost"
											size="sm"
											aria-label="Restore task from done"
											onMouseDown={stopEvent}
											onClick={(event) => {
												stopEvent(event);
												onRestoreFromTrash?.(card.id);
											}}
										/>
									</Tooltip>
								) : columnId === "in_progress" ? (
									<Button
										icon={isPaused ? <Play size={14} /> : <Pause size={13} />}
										variant="ghost"
										size="sm"
										aria-label={isPaused ? "Resume task" : "Pause task"}
										title={isPaused ? "Resume agent" : "Pause agent (Esc)"}
										onMouseDown={stopEvent}
										onClick={(event) => {
											stopEvent(event);
											if (isPausedLive) {
												onResume?.(card.id);
											} else if (isPausedOffline) {
												onResumeEndedSession?.(card.id);
											} else {
												onPause?.(card.id);
											}
										}}
									/>
								) : null}
							</div>
							{displayDescription ? (
								<div ref={descriptionContainerRef}>
									<p
										ref={descriptionRef}
										className={cn(
											"text-sm leading-[1.4]",
											isTrashCard
												? "text-text-tertiary"
												: "text-text-secondary",
											!isDescriptionMeasured &&
												!isDescriptionExpanded &&
												"line-clamp-3",
										)}
										style={{
											margin: "2px 0 0",
										}}
									>
										{activeDescriptionDisplay.isTruncated
											? activeDescriptionDisplay.text
											: displayDescription}
										{activeDescriptionDisplay.isTruncated ? (
											<>
												{"… "}
												<button
													type="button"
													className="inline cursor-pointer rounded-sm text-text-tertiary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [font:inherit]"
													aria-expanded={isDescriptionExpanded}
													aria-label={
														isDescriptionExpanded
															? "Collapse task description"
															: "Expand task description"
													}
													onMouseDown={stopEvent}
													onClick={(event) => {
														stopEvent(event);
														setIsDescriptionExpanded(!isDescriptionExpanded);
													}}
												>
													{isDescriptionExpanded
														? DESCRIPTION_COLLAPSE_LABEL
														: DESCRIPTION_EXPAND_LABEL}
												</button>
											</>
										) : isDescriptionExpanded &&
											descriptionDisplay.collapsed.isTruncated ? (
											<>
												{" "}
												<button
													type="button"
													className="inline cursor-pointer rounded-sm text-text-tertiary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [font:inherit]"
													aria-expanded={isDescriptionExpanded}
													aria-label="Collapse task description"
													onMouseDown={stopEvent}
													onClick={(event) => {
														stopEvent(event);
														setIsDescriptionExpanded(false);
													}}
												>
													{DESCRIPTION_COLLAPSE_LABEL}
												</button>
											</>
										) : null}
									</p>
								</div>
							) : null}
							{taskAgentSettingsLabel ? (
								<div className="mt-1">
									<span
										className={cn(
											"inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs",
											isTrashCard
												? "border-border text-text-tertiary bg-surface-1"
												: "border-status-blue/30 bg-status-blue/10 text-status-blue",
										)}
									>
										<Bot size={12} className="shrink-0" />
										<span className="truncate">{taskAgentSettingsLabel}</span>
									</span>
								</div>
							) : null}
							{sessionActivity ? (
								<div
									className="flex gap-1.5 items-start mt-[6px]"
									style={{
										color: isTrashCard
											? SESSION_ACTIVITY_COLOR.muted
											: undefined,
									}}
								>
									<span
										className="inline-block shrink-0 rounded-full"
										style={{
											width: 6,
											height: 6,
											backgroundColor: isTrashCard
												? SESSION_ACTIVITY_COLOR.muted
												: sessionActivity.dotColor,
											marginTop: 4,
										}}
									/>
									<div className="min-w-0 flex-1">
										<p
											className="m-0 font-mono truncate"
											style={{ fontSize: 12 }}
										>
											{sessionActivity.text}
										</p>
									</div>
								</div>
							) : null}
							{showElapsed ? (
								<div
									className="flex items-center gap-1.5 mt-[6px] font-mono"
									style={{ fontSize: 12 }}
								>
									<Clock
										size={11}
										className={
											isPaused ? "text-status-orange" : "text-text-tertiary"
										}
									/>
									<span
										className={
											isPaused ? "text-status-orange" : "text-text-secondary"
										}
									>
										{formatElapsed(elapsedMs)}
									</span>
									{isPausedOffline ? (
										<span className="text-status-orange">· {pausedOfflineBadgeLabel()}</span>
									) : isPaused ? (
										<span className="text-status-orange">
											· Paused{pausedByMaxRuntime ? " (max runtime)" : ""}
										</span>
									) : null}
								</div>
							) : null}
							{showAutoRunCountdown ? (
								<div
									className="flex items-center gap-1.5 mt-[6px] font-mono"
									style={{ fontSize: 12 }}
								>
									<Hourglass size={11} className="text-status-blue" />
									<span className="text-status-blue">
										{autoRunRemainingMs && autoRunRemainingMs > 0
											? `Auto-run in ${formatElapsed(autoRunRemainingMs)}`
											: "Ready — starting soon"}
									</span>
									{onCancelAutoRun ? (
										<button
											type="button"
											aria-label="Cancel auto-run"
											title="Cancel auto-run"
											className="ml-0.5 text-text-tertiary hover:text-text-primary"
											onMouseDown={stopEvent}
											onClick={(event) => {
												stopEvent(event);
												onCancelAutoRun(card.id);
											}}
										>
											<X size={11} />
										</button>
									) : null}
								</div>
							) : null}
							{showWorkspaceStatus && reviewWorkspacePath ? (
								<p
									className="font-mono"
									style={{
										margin: "4px 0 0",
										fontSize: 12,
										lineHeight: 1.4,
										whiteSpace: "normal",
										overflowWrap: "anywhere",
										color: isTrashCard
											? SESSION_ACTIVITY_COLOR.muted
											: undefined,
									}}
								>
									{isTrashCard ? (
										<span
											style={{
												color: SESSION_ACTIVITY_COLOR.muted,
												textDecoration: "line-through",
											}}
										>
											{reviewWorkspacePath}
										</span>
									) : reviewWorkspaceSnapshot ? (
										<>
											<span style={{ color: SESSION_ACTIVITY_COLOR.secondary }}>
												{reviewWorkspacePath}
											</span>
											<GitBranch
												size={10}
												style={{
													display: "inline",
													color: SESSION_ACTIVITY_COLOR.secondary,
													margin: "0px 4px 2px",
													verticalAlign: "middle",
												}}
											/>
											<span style={{ color: SESSION_ACTIVITY_COLOR.secondary }}>
												{reviewRefLabel}
											</span>
											{reviewChangeSummary ? (
												<>
													<span style={{ color: SESSION_ACTIVITY_COLOR.muted }}>
														{" "}
														(
													</span>
													<span style={{ color: SESSION_ACTIVITY_COLOR.muted }}>
														{reviewChangeSummary.filesLabel}
													</span>
													<span className="text-status-green">
														{" "}
														+{reviewChangeSummary.additions}
													</span>
													<span className="text-status-red">
														{" "}
														-{reviewChangeSummary.deletions}
													</span>
													<span style={{ color: SESSION_ACTIVITY_COLOR.muted }}>
														)
													</span>
												</>
											) : null}
											{/* The whole point of this chip: a clean worktree that already
											    holds commits is otherwise indistinguishable on the board
											    from one where nothing happened. */}
											{commitsAhead > 0 ? (
												<Tooltip
													content={`${commitsAhead} commit${commitsAhead === 1 ? "" : "s"} on ${reviewWorkspaceSnapshot?.branch ?? "this task's branch"} not in ${baseRefHint}`}
												>
													<span
														className={cn(
															"ml-1.5 inline-flex items-center gap-0.5 align-middle",
															gitReadiness === "ready"
																? "text-status-green"
																: "text-text-secondary",
														)}
													>
														<GitCommit size={10} />
														{commitsAhead} commit
														{commitsAhead === 1 ? "" : "s"}
													</span>
												</Tooltip>
											) : null}
										</>
									) : null}
								</p>
							) : null}
							{showReviewGitActions ? (
								<BoardCardReviewGitActions
									disabled={isAnyGitActionLoading}
									isCommitLoading={isCommitLoading}
									statusMessage={reviewGitStatusMessage}
									canRetryFollowOn={canRetryReviewGitFollowOn}
									baseRefHint={baseRefHint}
									branchSuggestions={branchSuggestions ?? []}
									onCommit={() => onCommit?.(card.id)}
									onSubmitBranched={(input) =>
										onSubmitReviewGit?.(card.id, input)
									}
									onCancelForm={() => onCancelReviewGitForm?.(card.id)}
									onOpenForm={() => onOpenReviewGitForm?.(card.id)}
									onRetryFollowOn={
										onRetryReviewGitFollowOn
											? () => onRetryReviewGitFollowOn(card.id)
											: undefined
									}
								/>
							) : null}
							{canMergeToBase && onMerge ? (
								<div className="flex mt-1.5">
									{/* Name the target: the base ref is pinned when the worktree is
									    created, so it is not necessarily the branch the home repo
									    currently has checked out. */}
									<Tooltip
										content={`Merge ${reviewWorkspaceSnapshot?.branch ?? "this task's branch"} into ${baseRefHint}`}
									>
										<Button
											size="sm"
											fill
											icon={
												isMergeLoading ? (
													<Spinner size={12} />
												) : (
													<GitMerge size={12} />
												)
											}
											disabled={isAnyGitActionLoading}
											onMouseDown={stopEvent}
											onClick={(event) => {
												stopEvent(event);
												onMerge(card.id);
											}}
										>
											Merge to base
										</Button>
									</Tooltip>
								</div>
							) : null}
							{cancelAutomaticActionLabel && onCancelAutomaticAction ? (
								<Button
									size="sm"
									fill
									style={{ marginTop: 12 }}
									onMouseDown={stopEvent}
									onClick={(event) => {
										stopEvent(event);
										onCancelAutomaticAction(card.id);
									}}
								>
									{cancelAutomaticActionLabel}
								</Button>
							) : null}
						</div>
					</div>
				);

				if (isDragging && typeof document !== "undefined") {
					return createPortal(draggableContent, document.body);
				}
				return draggableContent;
			}}
		</Draggable>
	);
}
