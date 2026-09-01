import type {
	RuntimeAgentId,
	RuntimeBoardColumnId,
	RuntimeSeatPreset,
	RuntimeTaskAutoReviewMode,
	RuntimeTaskClineSettings,
	RuntimeTaskImage,
	RuntimeTaskLaunchSettings,
} from "@/runtime/types";

export type BoardColumnId = RuntimeBoardColumnId;

export type TaskAutoReviewMode = RuntimeTaskAutoReviewMode;
export type TaskImage = RuntimeTaskImage;

export const DEFAULT_TASK_AUTO_REVIEW_MODE: TaskAutoReviewMode = "commit";

export function resolveTaskAutoReviewMode(mode: TaskAutoReviewMode | null | undefined): TaskAutoReviewMode {
	if (mode === "pr") {
		return mode;
	}
	return DEFAULT_TASK_AUTO_REVIEW_MODE;
}

export function getTaskAutoReviewActionLabel(mode: TaskAutoReviewMode | null | undefined): string {
	const resolvedMode = resolveTaskAutoReviewMode(mode);
	if (resolvedMode === "pr") {
		return "PR";
	}
	return "commit";
}

export function getTaskAutoReviewCancelButtonLabel(mode: TaskAutoReviewMode | null | undefined): string {
	const resolvedMode = resolveTaskAutoReviewMode(mode);
	if (resolvedMode === "pr") {
		return "Cancel Auto-PR";
	}
	return "Cancel Auto-commit";
}

export interface BoardCard {
	id: string;
	title: string;
	prompt: string;
	startInPlanMode: boolean;
	/** Absolute path to a saved plan file the agent should read at session start. */
	planFilePath?: string;
	autoReviewEnabled?: boolean;
	autoReviewMode?: TaskAutoReviewMode;
	images?: TaskImage[];
	agentId?: RuntimeAgentId;
	/**
	 * Claude account (manager id) this card's session runs on. Unset means the session
	 * follows jacked's globally active account and its auto-swap rotation.
	 */
	managerAccountId?: number;
	/**
	 * Seat resolution *policy*, when the card asks for a seat to be chosen rather than naming
	 * one. Mutually exclusive with `managerAccountId`. `fable` also fixes the session's model
	 * at launch — effort remains configurable on the card.
	 */
	seatPreset?: RuntimeSeatPreset;
	/**
	 * When true, a session that hits the Claude usage limit parks as "Paused" and the runtime
	 * auto-resumes it (--continue) once its window resets, instead of stopping in Review.
	 */
	autoResumeOnUsageLimit?: boolean;
	/**
	 * Epoch ms at which this backlog card should auto-start (a countdown set at create time).
	 * The client-side auto-run scheduler starts it once the time passes and a running slot is free.
	 */
	autoRunAt?: number | null;
	/** Epoch ms when this task most recently entered the "review" column; unset outside review. */
	reviewEnteredAt?: number;
	clineSettings?: RuntimeTaskClineSettings;
	/** Per-task model/effort + skill/MCP allowlist tags (empty = inherit Manager/global). */
	taskLaunchSettings?: RuntimeTaskLaunchSettings;
	baseRef: string;
	createdAt: number;
	updatedAt: number;
}

export interface BoardColumn {
	id: BoardColumnId;
	title: string;
	cards: BoardCard[];
}

export interface BoardDependency {
	id: string;
	fromTaskId: string;
	toTaskId: string;
	createdAt: number;
	/**
	 * True when both endpoints were in Backlog at link time (a "chain"): the waiter
	 * (fromTaskId) reuses the prerequisite's (toTaskId) worktree and the chain renders as
	 * one collapsible group in Backlog. Plain wait-links leave this unset.
	 */
	chain?: boolean;
}

export interface BoardData {
	columns: BoardColumn[];
	dependencies: BoardDependency[];
}

export interface ReviewTaskWorkspaceSnapshot {
	taskId: string;
	path: string;
	branch: string | null;
	isDetached: boolean;
	headCommit: string | null;
	changedFiles: number | null;
	additions: number | null;
	deletions: number | null;
	/** Commits reachable from HEAD but not from baseRef; non-zero means there's a committed branch ready to merge even with a clean working tree. */
	aheadOfBaseCount: number | null;
}

export interface CardSelection {
	card: BoardCard;
	column: BoardColumn;
	allColumns: BoardColumn[];
}
