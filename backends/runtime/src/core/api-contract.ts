import { z } from "zod";
import { resolveTaskTitle } from "./task-title.js";

export const runtimeWorkspaceFileStatusSchema = z.enum([
	"modified",
	"added",
	"deleted",
	"renamed",
	"copied",
	"untracked",
	"unknown",
]);
export type RuntimeWorkspaceFileStatus = z.infer<typeof runtimeWorkspaceFileStatusSchema>;

export const runtimeWorkspaceFileChangeSchema = z.object({
	path: z.string(),
	previousPath: z.string().optional(),
	status: runtimeWorkspaceFileStatusSchema,
	additions: z.number(),
	deletions: z.number(),
	oldText: z.string().nullable(),
	newText: z.string().nullable(),
});
export type RuntimeWorkspaceFileChange = z.infer<typeof runtimeWorkspaceFileChangeSchema>;

export const runtimeWorkspaceChangesRequestSchema = z.object({
	taskId: z.string(),
	baseRef: z.string(),
	mode: z.enum(["working_copy", "last_turn"]).optional(),
});
export type RuntimeWorkspaceChangesRequest = z.infer<typeof runtimeWorkspaceChangesRequestSchema>;

export const runtimeWorkspaceChangesModeSchema = z.enum(["working_copy", "last_turn"]);
export type RuntimeWorkspaceChangesMode = z.infer<typeof runtimeWorkspaceChangesModeSchema>;

export const runtimeWorkspaceChangesResponseSchema = z.object({
	repoRoot: z.string(),
	generatedAt: z.number(),
	files: z.array(runtimeWorkspaceFileChangeSchema),
});
export type RuntimeWorkspaceChangesResponse = z.infer<typeof runtimeWorkspaceChangesResponseSchema>;

export const runtimeWorkspaceFileSearchRequestSchema = z.object({
	query: z.string(),
	limit: z.number().int().positive().optional(),
});
export type RuntimeWorkspaceFileSearchRequest = z.infer<typeof runtimeWorkspaceFileSearchRequestSchema>;

export const runtimeWorkspaceFileSearchMatchSchema = z.object({
	path: z.string(),
	name: z.string(),
	changed: z.boolean(),
});
export type RuntimeWorkspaceFileSearchMatch = z.infer<typeof runtimeWorkspaceFileSearchMatchSchema>;

export const runtimeWorkspaceFileSearchResponseSchema = z.object({
	query: z.string(),
	files: z.array(runtimeWorkspaceFileSearchMatchSchema),
});
export type RuntimeWorkspaceFileSearchResponse = z.infer<typeof runtimeWorkspaceFileSearchResponseSchema>;

export const runtimeSlashCommandSchema = z.object({
	name: z.string(),
	instructions: z.string(),
	description: z.string().optional(),
});
export type RuntimeSlashCommand = z.infer<typeof runtimeSlashCommandSchema>;

export const runtimeSlashCommandsResponseSchema = z.object({
	commands: z.array(runtimeSlashCommandSchema),
});
export type RuntimeSlashCommandsResponse = z.infer<typeof runtimeSlashCommandsResponseSchema>;

export const runtimeAgentIdSchema = z.enum([
	"claude",
	"codex",
	"gemini",
	"opencode",
	"droid",
	"kiro",
	"cline",
	"cursor",
]);
export type RuntimeAgentId = z.infer<typeof runtimeAgentIdSchema>;

const runtimeBoardColumnIdEnum = z.enum(["backlog", "in_progress", "review", "trash"]);
export const runtimeBoardColumnIdSchema = z.preprocess(
	(val) => (val === "done" ? "trash" : val),
	runtimeBoardColumnIdEnum,
);
export type RuntimeBoardColumnId = z.infer<typeof runtimeBoardColumnIdEnum>;

const runtimeTaskAutoReviewModeEnum = z.enum(["commit", "pr"]);
export const runtimeTaskAutoReviewModeSchema = z.preprocess(
	(val) => (val === "move_to_trash" || val === "move_to_done" ? "commit" : val),
	runtimeTaskAutoReviewModeEnum,
);
export type RuntimeTaskAutoReviewMode = z.infer<typeof runtimeTaskAutoReviewModeEnum>;

export const runtimeClineReasoningEffortSchema = z.enum(["low", "medium", "high", "xhigh"]);
export type RuntimeClineReasoningEffort = z.infer<typeof runtimeClineReasoningEffortSchema>;
export const runtimeTaskClineSettingsSchema = z.object({
	providerId: z.string().optional(),
	modelId: z.string().optional(),
	reasoningEffort: runtimeClineReasoningEffortSchema.optional(),
});
export type RuntimeTaskClineSettings = z.infer<typeof runtimeTaskClineSettingsSchema>;

/** Claude/Cursor effort for CLI launches (`claude --effort`, Cursor when supported). */
export const runtimeTaskLaunchEffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type RuntimeTaskLaunchEffort = z.infer<typeof runtimeTaskLaunchEffortSchema>;

/**
 * Per-task launch allowlist. Empty arrays (or omit) inherit Manager/global installs.
 * Non-empty arrays restrict the session to those ids.
 *
 * Maps to Manager shelves: Training→skills, Staff→agents, Playbooks→commands.
 */
export const runtimeTaskLaunchSettingsSchema = z.object({
	modelId: z.string().min(1).optional(),
	effort: runtimeTaskLaunchEffortSchema.optional(),
	skillIds: z.array(z.string().min(1)).optional(),
	agentIds: z.array(z.string().min(1)).optional(),
	commandIds: z.array(z.string().min(1)).optional(),
	workflowIds: z.array(z.string().min(1)).optional(),
	mcpServerIds: z.array(z.string().min(1)).optional(),
});
export type RuntimeTaskLaunchSettings = z.infer<typeof runtimeTaskLaunchSettingsSchema>;
export const runtimeTaskImageSchema = z.object({
	id: z.string(),
	data: z.string(),
	mimeType: z.string(),
	name: z.string().optional(),
});
export type RuntimeTaskImage = z.infer<typeof runtimeTaskImageSchema>;

const runtimeLegacyTaskClineReasoningEffortSchema = z.enum(["default", "low", "medium", "high", "xhigh"]);

function normalizeRuntimeTaskClineSettings(input: {
	clineSettings?: RuntimeTaskClineSettings;
	clineProviderId?: string;
	clineModelId?: string;
	clineReasoningEffort?: z.infer<typeof runtimeLegacyTaskClineReasoningEffortSchema>;
}): RuntimeTaskClineSettings | undefined {
	if (input.clineSettings !== undefined) {
		return input.clineSettings;
	}
	const providerId = input.clineProviderId?.trim();
	const modelId = input.clineModelId?.trim();
	if (!providerId && !modelId && input.clineReasoningEffort === undefined) {
		return undefined;
	}
	return {
		...(providerId ? { providerId } : {}),
		...(modelId ? { modelId } : {}),
		...(input.clineReasoningEffort && input.clineReasoningEffort !== "default"
			? { reasoningEffort: input.clineReasoningEffort }
			: {}),
	};
}

export const runtimeBoardCardSchema = z.preprocess(
	(raw) => {
		if (raw && typeof raw === "object" && !Array.isArray(raw)) {
			const obj = raw as Record<string, unknown>;
			if ("jackedAccountId" in obj && !("managerAccountId" in obj)) {
				const { jackedAccountId, ...rest } = obj;
				return { ...rest, managerAccountId: jackedAccountId };
			}
		}
		return raw;
	},
	z
		.object({
			id: z.string(),
			title: z.string().optional(),
			prompt: z.string(),
			startInPlanMode: z.boolean(),
			/** Absolute path to a saved plan file the agent should read at session start. */
			planFilePath: z.string().optional(),
			autoReviewEnabled: z.boolean().optional(),
			autoReviewMode: runtimeTaskAutoReviewModeSchema.optional(),
			images: z.array(runtimeTaskImageSchema).optional(),
			agentId: runtimeAgentIdSchema.optional(),
			/** Claude account (Manager id) this card's session runs on; unset follows auto-swap. */
			managerAccountId: z.number().int().positive().optional(),
			/**
			 * When true, a session that hits the Claude usage limit parks as "usage_paused" and the
			 * runtime auto-resumes it (--continue) once its window resets, instead of stopping in Review.
			 */
			autoResumeOnUsageLimit: z.boolean().optional(),
			/**
			 * Epoch ms at which this backlog card should auto-start (a countdown set at create time).
			 * The client-side auto-run scheduler starts it once the time passes and a running slot is
			 * free (respecting `maxRunningTasks`); unset means no scheduled auto-run.
			 */
			autoRunAt: z.number().nullable().optional(),
			/** Epoch ms when this task most recently entered the "review" column; unset outside review. */
			reviewEnteredAt: z.number().optional(),
			clineSettings: runtimeTaskClineSettingsSchema.optional(),
			taskLaunchSettings: runtimeTaskLaunchSettingsSchema.optional(),
			clineProviderId: z.string().optional(),
			clineModelId: z.string().optional(),
			clineReasoningEffort: runtimeLegacyTaskClineReasoningEffortSchema.optional(),
			baseRef: z.string(),
			createdAt: z.number(),
			updatedAt: z.number(),
		})
		.transform(
			({
				clineProviderId: _legacyProviderId,
				clineModelId: _legacyModelId,
				clineReasoningEffort: _legacyReasoningEffort,
				...card
			}) => {
				const clineSettings = normalizeRuntimeTaskClineSettings({
					clineSettings: card.clineSettings,
					clineProviderId: _legacyProviderId,
					clineModelId: _legacyModelId,
					clineReasoningEffort: _legacyReasoningEffort,
				});
				return {
					...card,
					...(clineSettings !== undefined ? { clineSettings } : {}),
					title: resolveTaskTitle(card.title, card.prompt),
				};
			},
		),
);
export type RuntimeBoardCard = z.infer<typeof runtimeBoardCardSchema>;

export const runtimeBoardColumnSchema = z.object({
	id: runtimeBoardColumnIdSchema,
	title: z.string(),
	cards: z.array(runtimeBoardCardSchema),
});
export type RuntimeBoardColumn = z.infer<typeof runtimeBoardColumnSchema>;

export const runtimeBoardDependencySchema = z.object({
	id: z.string(),
	fromTaskId: z.string(),
	toTaskId: z.string(),
	createdAt: z.number(),
	/**
	 * True when both endpoints were in Backlog at link time (a "chain"). The waiter
	 * (fromTaskId) then reuses the prerequisite's (toTaskId) git worktree instead of
	 * starting fresh, so a sequence of chained tasks builds up in one working tree.
	 * Plain wait-links (one endpoint already running) leave this unset and keep the
	 * fresh-worktree behavior.
	 */
	chain: z.boolean().optional(),
});
export type RuntimeBoardDependency = z.infer<typeof runtimeBoardDependencySchema>;

export const runtimeBoardDataSchema = z.object({
	columns: z.array(runtimeBoardColumnSchema),
	dependencies: z.array(runtimeBoardDependencySchema).default([]),
});
export type RuntimeBoardData = z.infer<typeof runtimeBoardDataSchema>;

export const runtimeGitRepositoryInfoSchema = z.object({
	currentBranch: z.string().nullable(),
	defaultBranch: z.string().nullable(),
	branches: z.array(z.string()),
});
export type RuntimeGitRepositoryInfo = z.infer<typeof runtimeGitRepositoryInfoSchema>;

export const runtimeGitSyncActionSchema = z.enum(["fetch", "pull", "push", "stash", "stash-pop"]);
export type RuntimeGitSyncAction = z.infer<typeof runtimeGitSyncActionSchema>;

export const runtimeCleanStashResponseSchema = z.object({
	ok: z.boolean(),
	clearedCount: z.number(),
	output: z.string(),
	error: z.string().optional(),
});
export type RuntimeCleanStashResponse = z.infer<typeof runtimeCleanStashResponseSchema>;

export const runtimeGitSyncSummarySchema = z.object({
	currentBranch: z.string().nullable(),
	upstreamBranch: z.string().nullable(),
	changedFiles: z.number(),
	additions: z.number(),
	deletions: z.number(),
	aheadCount: z.number(),
	behindCount: z.number(),
});
export type RuntimeGitSyncSummary = z.infer<typeof runtimeGitSyncSummarySchema>;

export const runtimeGitSummaryResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeGitSyncSummarySchema,
	error: z.string().optional(),
});
export type RuntimeGitSummaryResponse = z.infer<typeof runtimeGitSummaryResponseSchema>;

export const runtimeGitSyncResponseSchema = z.object({
	ok: z.boolean(),
	action: runtimeGitSyncActionSchema,
	summary: runtimeGitSyncSummarySchema,
	output: z.string(),
	error: z.string().optional(),
});
export type RuntimeGitSyncResponse = z.infer<typeof runtimeGitSyncResponseSchema>;

export const runtimeGitCheckoutRequestSchema = z.object({
	branch: z.string(),
});
export type RuntimeGitCheckoutRequest = z.infer<typeof runtimeGitCheckoutRequestSchema>;

export const runtimeGitCheckoutResponseSchema = z.object({
	ok: z.boolean(),
	branch: z.string(),
	summary: runtimeGitSyncSummarySchema,
	output: z.string(),
	error: z.string().optional(),
});
export type RuntimeGitCheckoutResponse = z.infer<typeof runtimeGitCheckoutResponseSchema>;

export const runtimeGitDeleteBranchRequestSchema = z.object({
	branch: z.string(),
	force: z.boolean().optional(),
});
export type RuntimeGitDeleteBranchRequest = z.infer<typeof runtimeGitDeleteBranchRequestSchema>;

export const runtimeGitDeleteBranchResponseSchema = z.object({
	ok: z.boolean(),
	branch: z.string(),
	summary: runtimeGitSyncSummarySchema,
	output: z.string(),
	error: z.string().optional(),
});
export type RuntimeGitDeleteBranchResponse = z.infer<typeof runtimeGitDeleteBranchResponseSchema>;

export const runtimeGitCreateBranchRequestSchema = z.object({
	newBranch: z.string(),
	startPoint: z.string(),
});
export type RuntimeGitCreateBranchRequest = z.infer<typeof runtimeGitCreateBranchRequestSchema>;

export const runtimeGitCreateBranchResponseSchema = z.object({
	ok: z.boolean(),
	branch: z.string(),
	startPoint: z.string(),
	summary: runtimeGitSyncSummarySchema,
	output: z.string(),
	error: z.string().optional(),
});
export type RuntimeGitCreateBranchResponse = z.infer<typeof runtimeGitCreateBranchResponseSchema>;

export const runtimeGitMergeBranchRequestSchema = z.object({
	taskId: z.string(),
	baseRef: z.string(),
});
export type RuntimeGitMergeBranchRequest = z.infer<typeof runtimeGitMergeBranchRequestSchema>;

export const runtimeGitMergeBranchResponseSchema = z.object({
	ok: z.boolean(),
	branch: z.string(),
	baseRef: z.string(),
	summary: runtimeGitSyncSummarySchema,
	output: z.string(),
	error: z.string().optional(),
});
export type RuntimeGitMergeBranchResponse = z.infer<typeof runtimeGitMergeBranchResponseSchema>;

export const runtimeGitMergeIntoCurrentRequestSchema = z.object({
	branch: z.string(),
});
export type RuntimeGitMergeIntoCurrentRequest = z.infer<typeof runtimeGitMergeIntoCurrentRequestSchema>;

export const runtimeGitMergeIntoCurrentResponseSchema = z.object({
	ok: z.boolean(),
	branch: z.string(),
	summary: runtimeGitSyncSummarySchema,
	output: z.string(),
	error: z.string().optional(),
});
export type RuntimeGitMergeIntoCurrentResponse = z.infer<typeof runtimeGitMergeIntoCurrentResponseSchema>;

export const runtimeGitRebaseCurrentOntoRequestSchema = z.object({
	branch: z.string(),
});
export type RuntimeGitRebaseCurrentOntoRequest = z.infer<typeof runtimeGitRebaseCurrentOntoRequestSchema>;

export const runtimeGitRebaseCurrentOntoResponseSchema = z.object({
	ok: z.boolean(),
	branch: z.string(),
	summary: runtimeGitSyncSummarySchema,
	output: z.string(),
	error: z.string().optional(),
});
export type RuntimeGitRebaseCurrentOntoResponse = z.infer<typeof runtimeGitRebaseCurrentOntoResponseSchema>;

export const runtimeGitCherryPickRequestSchema = z.object({
	taskId: z.string().optional(),
	baseRef: z.string().optional(),
	commitHash: z.string().min(7),
	targetBranch: z.string().min(1),
});
export type RuntimeGitCherryPickRequest = z.infer<typeof runtimeGitCherryPickRequestSchema>;

export const runtimeGitCherryPickResponseSchema = z.object({
	ok: z.boolean(),
	commitHash: z.string(),
	targetBranch: z.string(),
	summary: runtimeGitSyncSummarySchema,
	output: z.string(),
	error: z.string().optional(),
});
export type RuntimeGitCherryPickResponse = z.infer<typeof runtimeGitCherryPickResponseSchema>;

export const runtimeGitPushBranchRequestSchema = z.object({
	taskId: z.string().optional(),
	baseRef: z.string().optional(),
	branch: z.string().min(1),
});
export type RuntimeGitPushBranchRequest = z.infer<typeof runtimeGitPushBranchRequestSchema>;

export const runtimeGitPushBranchResponseSchema = z.object({
	ok: z.boolean(),
	branch: z.string(),
	summary: runtimeGitSyncSummarySchema,
	output: z.string(),
	error: z.string().optional(),
});
export type RuntimeGitPushBranchResponse = z.infer<typeof runtimeGitPushBranchResponseSchema>;

export const runtimeGitDiscardResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeGitSyncSummarySchema,
	output: z.string(),
	error: z.string().optional(),
});
export type RuntimeGitDiscardResponse = z.infer<typeof runtimeGitDiscardResponseSchema>;

export const runtimeGitRevertFileRequestSchema = z.object({
	path: z.string(),
	taskInfo: z
		.object({
			taskId: z.string(),
			baseRef: z.string(),
		})
		.nullable()
		.optional(),
});
export type RuntimeGitRevertFileRequest = z.infer<typeof runtimeGitRevertFileRequestSchema>;

export const runtimeGitRevertHunkRequestSchema = runtimeGitRevertFileRequestSchema.extend({
	hunkIndex: z.number().int().nonnegative(),
});
export type RuntimeGitRevertHunkRequest = z.infer<typeof runtimeGitRevertHunkRequestSchema>;

export const runtimeGitRevertResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeGitSyncSummarySchema,
	output: z.string(),
	error: z.string().optional(),
});
export type RuntimeGitRevertResponse = z.infer<typeof runtimeGitRevertResponseSchema>;

export const runtimeGitCommitRequestSchema = z.object({
	message: z.string(),
	paths: z.array(z.string()).optional(),
	taskInfo: z
		.object({
			taskId: z.string(),
			baseRef: z.string(),
		})
		.nullable()
		.optional(),
});
export type RuntimeGitCommitRequest = z.infer<typeof runtimeGitCommitRequestSchema>;

export const runtimeGitCommitResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeGitSyncSummarySchema,
	output: z.string(),
	error: z.string().optional(),
});
export type RuntimeGitCommitResponse = z.infer<typeof runtimeGitCommitResponseSchema>;

export const runtimeTaskSessionStateSchema = z.enum(["idle", "running", "awaiting_review", "failed", "interrupted"]);
export type RuntimeTaskSessionState = z.infer<typeof runtimeTaskSessionStateSchema>;

export const runtimeTaskSessionModeSchema = z.enum(["act", "plan"]);
export type RuntimeTaskSessionMode = z.infer<typeof runtimeTaskSessionModeSchema>;

export const runtimeTaskSessionReviewReasonSchema = z
	.enum(["attention", "exit", "error", "interrupted", "hook", "usage_paused"])
	.nullable();
export type RuntimeTaskSessionReviewReason = z.infer<typeof runtimeTaskSessionReviewReasonSchema>;

export const runtimeTaskHookActivitySchema = z.object({
	activityText: z.string().nullable().default(null),
	toolName: z.string().nullable().default(null),
	toolInputSummary: z.string().nullable().default(null),
	finalMessage: z.string().nullable().default(null),
	hookEventName: z.string().nullable().default(null),
	notificationType: z.string().nullable().default(null),
	source: z.string().nullable().default(null),
	planText: z.string().nullable().default(null),
});
export type RuntimeTaskHookActivity = z.infer<typeof runtimeTaskHookActivitySchema>;

export const runtimeTaskTurnCheckpointSchema = z.object({
	turn: z.number().int().positive(),
	ref: z.string(),
	commit: z.string(),
	createdAt: z.number(),
});
export type RuntimeTaskTurnCheckpoint = z.infer<typeof runtimeTaskTurnCheckpointSchema>;

export const runtimeTaskSessionSummarySchema = z.object({
	taskId: z.string(),
	state: runtimeTaskSessionStateSchema,
	mode: runtimeTaskSessionModeSchema.nullable().optional(),
	agentId: runtimeAgentIdSchema.nullable(),
	workspacePath: z.string().nullable(),
	pid: z.number().nullable(),
	startedAt: z.number().nullable(),
	updatedAt: z.number(),
	/**
	 * Accumulated active-run time in ms (sum of every running segment, excluding
	 * paused/awaiting gaps). Combine with `runningSince` for live elapsed:
	 * `activeRunMs + (runningSince != null ? now - runningSince : 0)`.
	 */
	activeRunMs: z.number().default(0),
	/** Epoch ms the current running segment started; null whenever the clock is frozen (paused, awaiting, idle, done). */
	runningSince: z.number().nullable().default(null),
	/** Epoch ms of a manual (Esc) or force-pause hold; null when not manually paused. Distinct from usage `resumeAt`. */
	pausedAt: z.number().nullable().default(null),
	/** Why a manual/force pause is held: user-initiated vs an automatic max-runtime cutoff. Null when not paused. */
	pauseReason: z.enum(["manual", "max_runtime"]).nullable().default(null),
	lastOutputAt: z.number().nullable(),
	reviewReason: runtimeTaskSessionReviewReasonSchema,
	exitCode: z.number().nullable(),
	lastHookAt: z.number().nullable().default(null),
	latestHookActivity: runtimeTaskHookActivitySchema.nullable().default(null),
	warningMessage: z.string().nullable().optional(),
	/** Claude account this session was pinned to via CLAUDE_CONFIG_DIR, if any. */
	managerAccountId: z.number().int().positive().nullable().optional(),
	/** Carried from the card: when true, a usage-limit exit parks as "usage_paused" and auto-resumes. */
	autoResumeOnUsageLimit: z.boolean().optional(),
	/**
	 * Epoch ms at which a usage-limit-paused session should auto-resume (its window's reset).
	 * Set only alongside reviewReason "usage_paused"; the usage-resume scheduler reads it and
	 * relaunches with --continue once the window clears. Null on every other state.
	 */
	resumeAt: z.number().nullable().optional(),
	latestTurnCheckpoint: runtimeTaskTurnCheckpointSchema.nullable().optional(),
	previousTurnCheckpoint: runtimeTaskTurnCheckpointSchema.nullable().optional(),
});
export type RuntimeTaskSessionSummary = z.infer<typeof runtimeTaskSessionSummarySchema>;

export const runtimeWorkspaceStateResponseSchema = z.object({
	repoPath: z.string(),
	statePath: z.string(),
	git: runtimeGitRepositoryInfoSchema,
	board: runtimeBoardDataSchema,
	sessions: z.record(z.string(), runtimeTaskSessionSummarySchema),
	revision: z.number(),
});
export type RuntimeWorkspaceStateResponse = z.infer<typeof runtimeWorkspaceStateResponseSchema>;

export const runtimeWorkspaceStateSaveRequestSchema = z.object({
	board: runtimeBoardDataSchema,
	sessions: z.record(z.string(), runtimeTaskSessionSummarySchema),
	expectedRevision: z.number().int().nonnegative().optional(),
});
export type RuntimeWorkspaceStateSaveRequest = z.infer<typeof runtimeWorkspaceStateSaveRequestSchema>;

export const runtimeWorkspaceStateConflictResponseSchema = z.object({
	error: z.string(),
	currentRevision: z.number(),
});
export type RuntimeWorkspaceStateConflictResponse = z.infer<typeof runtimeWorkspaceStateConflictResponseSchema>;

export const runtimeWorkspaceStateNotifyResponseSchema = z.object({
	ok: z.boolean(),
});
export type RuntimeWorkspaceStateNotifyResponse = z.infer<typeof runtimeWorkspaceStateNotifyResponseSchema>;

export const runtimeProjectTaskCountsSchema = z.object({
	backlog: z.number(),
	in_progress: z.number(),
	review: z.number(),
	trash: z.number(),
});
export type RuntimeProjectTaskCounts = z.infer<typeof runtimeProjectTaskCountsSchema>;

export const runtimeProjectSummarySchema = z.object({
	id: z.string(),
	path: z.string(),
	name: z.string(),
	taskCounts: runtimeProjectTaskCountsSchema,
});
export type RuntimeProjectSummary = z.infer<typeof runtimeProjectSummarySchema>;

export const runtimeTaskWorkspaceMetadataSchema = z.object({
	taskId: z.string(),
	path: z.string(),
	exists: z.boolean(),
	baseRef: z.string(),
	branch: z.string().nullable(),
	isDetached: z.boolean(),
	headCommit: z.string().nullable(),
	changedFiles: z.number().nullable(),
	additions: z.number().nullable(),
	deletions: z.number().nullable(),
	/** Commits reachable from HEAD but not from baseRef; non-zero means there's a committed branch ready to merge even with a clean working tree. */
	aheadOfBaseCount: z.number().nullable(),
	stateVersion: z.number().int().nonnegative(),
});
export type RuntimeTaskWorkspaceMetadata = z.infer<typeof runtimeTaskWorkspaceMetadataSchema>;

export const runtimeWorkspaceMetadataSchema = z.object({
	homeGitSummary: runtimeGitSyncSummarySchema.nullable(),
	homeGitStateVersion: z.number().int().nonnegative(),
	taskWorkspaces: z.array(runtimeTaskWorkspaceMetadataSchema),
});
export type RuntimeWorkspaceMetadata = z.infer<typeof runtimeWorkspaceMetadataSchema>;

export const runtimeClineMcpServerAuthStatusSchema = z.object({
	serverName: z.string(),
	oauthSupported: z.boolean(),
	oauthConfigured: z.boolean(),
	lastError: z.string().nullable(),
	lastAuthenticatedAt: z.number().nullable(),
});
export type RuntimeClineMcpServerAuthStatus = z.infer<typeof runtimeClineMcpServerAuthStatusSchema>;

export const runtimeStateStreamSnapshotMessageSchema = z.object({
	type: z.literal("snapshot"),
	currentProjectId: z.string().nullable(),
	projects: z.array(runtimeProjectSummarySchema),
	workspaceState: runtimeWorkspaceStateResponseSchema.nullable(),
	workspaceMetadata: runtimeWorkspaceMetadataSchema.nullable(),
	clineSessionContextVersion: z.number().int().nonnegative(),
});
export type RuntimeStateStreamSnapshotMessage = z.infer<typeof runtimeStateStreamSnapshotMessageSchema>;

export const runtimeStateStreamWorkspaceStateMessageSchema = z.object({
	type: z.literal("workspace_state_updated"),
	workspaceId: z.string(),
	workspaceState: runtimeWorkspaceStateResponseSchema,
});
export type RuntimeStateStreamWorkspaceStateMessage = z.infer<typeof runtimeStateStreamWorkspaceStateMessageSchema>;

export const runtimeStateStreamTaskSessionsMessageSchema = z.object({
	type: z.literal("task_sessions_updated"),
	workspaceId: z.string(),
	summaries: z.array(runtimeTaskSessionSummarySchema),
});
export type RuntimeStateStreamTaskSessionsMessage = z.infer<typeof runtimeStateStreamTaskSessionsMessageSchema>;

export const runtimeStateStreamProjectsMessageSchema = z.object({
	type: z.literal("projects_updated"),
	currentProjectId: z.string().nullable(),
	projects: z.array(runtimeProjectSummarySchema),
});
export type RuntimeStateStreamProjectsMessage = z.infer<typeof runtimeStateStreamProjectsMessageSchema>;

export const runtimeStateStreamWorkspaceMetadataMessageSchema = z.object({
	type: z.literal("workspace_metadata_updated"),
	workspaceId: z.string(),
	workspaceMetadata: runtimeWorkspaceMetadataSchema,
});
export type RuntimeStateStreamWorkspaceMetadataMessage = z.infer<
	typeof runtimeStateStreamWorkspaceMetadataMessageSchema
>;

export const runtimeStateStreamTaskReadyForReviewMessageSchema = z.object({
	type: z.literal("task_ready_for_review"),
	workspaceId: z.string(),
	taskId: z.string(),
	triggeredAt: z.number(),
});
export type RuntimeStateStreamTaskReadyForReviewMessage = z.infer<
	typeof runtimeStateStreamTaskReadyForReviewMessageSchema
>;

export const runtimeStateStreamTaskChatMessageSchema = z.object({
	type: z.literal("task_chat_message"),
	workspaceId: z.string(),
	taskId: z.string(),
	message: z.lazy(() => runtimeTaskChatMessageSchema),
});
export type RuntimeStateStreamTaskChatMessage = z.infer<typeof runtimeStateStreamTaskChatMessageSchema>;

export const runtimeStateStreamTaskChatClearedMessageSchema = z.object({
	type: z.literal("task_chat_cleared"),
	workspaceId: z.string(),
	taskId: z.string(),
});
export type RuntimeStateStreamTaskChatClearedMessage = z.infer<typeof runtimeStateStreamTaskChatClearedMessageSchema>;

export const runtimeStateStreamMcpAuthUpdatedMessageSchema = z.object({
	type: z.literal("mcp_auth_updated"),
	statuses: z.array(runtimeClineMcpServerAuthStatusSchema),
});
export type RuntimeStateStreamMcpAuthUpdatedMessage = z.infer<typeof runtimeStateStreamMcpAuthUpdatedMessageSchema>;

export const runtimeStateStreamClineSessionContextUpdatedMessageSchema = z.object({
	type: z.literal("cline_session_context_updated"),
	version: z.number().int().nonnegative(),
});
export type RuntimeStateStreamClineSessionContextUpdatedMessage = z.infer<
	typeof runtimeStateStreamClineSessionContextUpdatedMessageSchema
>;

export const runtimeStateStreamErrorMessageSchema = z.object({
	type: z.literal("error"),
	message: z.string(),
});
export type RuntimeStateStreamErrorMessage = z.infer<typeof runtimeStateStreamErrorMessageSchema>;

/**
 * Agent fleets that Manager can hold accounts for.
 *
 * Kept separate from runtimeAgentIdSchema: an account provider is a billing identity,
 * while an agent id is a CLI Kanban can launch. They overlap but are not the same set —
 * "antigravity" is a quota pool with no Kanban CLI, and "cline" is a CLI with no jacked
 * account.
 */
export const RuntimeManagerProviderSchema = z.enum(["claude", "codex", "cursor", "antigravity", "omniroute"]);
export type RuntimeManagerProvider = z.infer<typeof RuntimeManagerProviderSchema>;

export const RuntimeManagerAccountSchema = z.object({
	id: z.number().int(),
	provider: RuntimeManagerProviderSchema,
	email: z.string(),
	displayName: z.string().nullable(),
	organizationName: z.string().nullable(),
	isActive: z.boolean(),
	/** Percentages 0-100 as reported by the provider, or null when it exposes no window. */
	fiveHourPercent: z.number().nullable(),
	sevenDayPercent: z.number().nullable(),
	/** ISO reset timestamps for the provider windows (when Manager caches them). */
	fiveHourResetsAt: z.string().nullable(),
	sevenDayResetsAt: z.string().nullable(),
	/** Unix seconds when usage was last fetched successfully. */
	usageCachedAt: z.number().nullable(),
	/** Provider plan label when known (e.g. pro / max / business). */
	subscriptionType: z.string().nullable(),
	/**
	 * Soft usage donate cap (0-100). Auto pick / auto-swap skip this seat when
	 * max(5h%, 7d%) >= this value. Explicit task pins still work.
	 */
	donateLimitPercent: z.number().int().min(0).max(100),
	/** Set via paste-code invite; donate cap cannot be changed afterward. */
	donateLimitLocked: z.boolean().optional().default(false),
	/** Normalized 0-1 usage pressure across every window the provider reports. */
	pressure: z.number().min(0).max(1),
	/** Unix seconds until the tightest window resets. */
	nextRefreshAt: z.number().nullable(),
	canAutoSwap: z.boolean(),
	canTrackUsage: z.boolean(),
	/** False means Claude Code tokens were never authorized (or expired unrecovered).
	 * The seat can still be activated; credentials fall back to primary tokens (~8h
	 * without auto-refresh until CC authorization completes). */
	hasCcToken: z.boolean(),
	/** True when CC access exists but cannot refresh and primary fallback is unavailable. */
	ccNeedsAuth: z.boolean().optional().default(false),
	/** Whether this account is the active credential for its provider fleet. */
	isActiveForProvider: z.boolean(),
	/** Jacked validation probe result (`valid` / `invalid` / `checking` / `unknown`). */
	validationStatus: z.string().nullable(),
	/** Last credential/usage error from jacked, when the seat needs attention. */
	lastError: z.string().nullable(),
});
export type RuntimeManagerAccount = z.infer<typeof RuntimeManagerAccountSchema>;

export const RuntimeManagerFeatureCategorySchema = z.enum(["agents", "commands", "hooks", "knowledge"]);
export type RuntimeManagerFeatureCategory = z.infer<typeof RuntimeManagerFeatureCategorySchema>;

export const RuntimeManagerFeatureSchema = z.object({
	category: RuntimeManagerFeatureCategorySchema,
	name: z.string(),
	displayName: z.string(),
	description: z.string(),
	installed: z.boolean(),
});
export type RuntimeManagerFeature = z.infer<typeof RuntimeManagerFeatureSchema>;

/**
 * A curated skill bundle jacked can install from an upstream repository.
 *
 * A pack is a set, so install state is a count rather than a flag — packs land
 * partially when an upstream skill disappears or an install is interrupted.
 * `enabled` is the effective intent (an explicit user decision, or the registry
 * default when they never chose), which can disagree with what is on disk.
 */
export const RuntimeManagerPackSchema = z.object({
	name: z.string(),
	displayName: z.string(),
	description: z.string(),
	source: z.string().nullable(),
	homepage: z.string().nullable(),
	skillCount: z.number().int().nonnegative(),
	installedCount: z.number().int().nonnegative(),
	enabled: z.boolean(),
	isDefault: z.boolean(),
	/** True when the user has explicitly toggled this pack (vs. inheriting the default). */
	explicit: z.boolean(),
});
export type RuntimeManagerPack = z.infer<typeof RuntimeManagerPackSchema>;

export const RuntimeManagerPacksSchema = z.object({
	packs: z.array(RuntimeManagerPackSchema),
	/** Pack installs shell out to npx; false means every toggle will fail. */
	npxAvailable: z.boolean(),
});
export type RuntimeManagerPacks = z.infer<typeof RuntimeManagerPacksSchema>;

export const RuntimeManagerPackToggleRequestSchema = z.object({
	name: z.string().min(1),
	enabled: z.boolean(),
});
export type RuntimeManagerPackToggleRequest = z.infer<typeof RuntimeManagerPackToggleRequestSchema>;

export const RuntimeManagerSwapSchema = z.object({
	at: z.number(),
	fromEmail: z.string().nullable(),
	toEmail: z.string().nullable(),
	reason: z.string().nullable(),
});
export type RuntimeManagerSwap = z.infer<typeof RuntimeManagerSwapSchema>;

/**
 * Fleet pacing summary mirrored from Manager's `compute_best_account_summary`
 * (usage_pacing.py). Drives the runtime's auto-pause-until-reset for unpinned tasks.
 */
export const runtimeManagerPacingSchema = z.object({
	/** Epoch ms of the earliest future reset among genuinely constrained windows; null when unknown. */
	pauseUntil: z.number().nullable(),
	/** Worst-window percent (0-100) of the most-headroom eligible account; null when no usage data. */
	worstWindowPct: z.number().nullable(),
	/**
	 * True when even the most-headroom account is walled (worstWindowPct at/above the
	 * constrained threshold), i.e. no seat to swap to. `pauseUntil` may still be null here
	 * (wake time unknown) — consumers pause with backoff in that case.
	 */
	allExhausted: z.boolean(),
});
export type RuntimeManagerPacing = z.infer<typeof runtimeManagerPacingSchema>;

/** Scope Manager echoes back on `/api/features` so a reading can be labelled. */
export const runtimeManagerFeaturesScopeSchema = z.object({
	repoPath: z.string().nullable(),
	claudeDir: z.string(),
	/** Categories that honour a project scope; hooks are always machine-wide. */
	projectScopedCategories: z.array(z.string()),
});
export type RuntimeManagerFeaturesScope = z.infer<typeof runtimeManagerFeaturesScopeSchema>;

export const RuntimeManagerSnapshotSchema = z.object({
	version: z.string().nullable(),
	accounts: z.array(RuntimeManagerAccountSchema),
	activeAccountId: z.number().int().nullable(),
	/** Highest pressure across all accounts, which is what dims the office. */
	pressure: z.number().min(0).max(1),
	/** ISO timestamp while auto-swap is paused, null when it is running. */
	swapPausedUntil: z.string().nullable(),
	autoSwapEnabled: z.boolean(),
	/** Fleet pacing (pause-until-reset target). Null/absent when Manager exposes no pacing summary. */
	pacing: runtimeManagerPacingSchema.nullable().optional(),
	features: z.array(RuntimeManagerFeatureSchema),
	/**
	 * Which `.claude` the `features[].installed` flags were read from. Absent on a
	 * global read; set when the fetch was scoped to a project, so a shelf can say
	 * whose catalog state it is showing.
	 */
	featuresScope: runtimeManagerFeaturesScopeSchema.nullable().optional(),
	latestSwap: RuntimeManagerSwapSchema.nullable(),
	lessonsActive: z.number().int().nonnegative().nullable(),
	fetchedAt: z.number(),
	/**
	 * True when this snapshot is last-known-good retained after a probe failure.
	 * Office/board still render; mutations and “online” chrome should treat jacked as unreachable.
	 */
	stale: z.boolean().optional().default(false),
	/** Wall-clock of the last successful fetch; equals fetchedAt when fresh. */
	lastSuccessAt: z.number().optional(),
});
export type RuntimeManagerSnapshot = z.infer<typeof RuntimeManagerSnapshotSchema>;

/**
 * Null only when jacked has never been reached (or monitor was reset).
 * After a successful fetch, transient outages keep the last snapshot with stale=true.
 * Jacked is never a hard dependency for board or office rendering.
 */
export const RuntimeManagerStateSchema = RuntimeManagerSnapshotSchema.nullable();
export type RuntimeManagerState = z.infer<typeof RuntimeManagerStateSchema>;

export const RuntimeStateStreamManagerMessageSchema = z.object({
	type: z.literal("manager_state_updated"),
	manager: RuntimeManagerStateSchema,
});
export type RuntimeStateStreamManagerMessage = z.infer<typeof RuntimeStateStreamManagerMessageSchema>;

/** @deprecated Read-only alias for one release; normalized to manager_state_updated. */
export const runtimeStateStreamJackedLegacyMessageSchema = z.object({
	type: z.literal("jacked_state_updated"),
	jacked: RuntimeManagerStateSchema,
});

export const RuntimeManagerFeatureToggleRequestSchema = z.object({
	category: RuntimeManagerFeatureCategorySchema,
	name: z.string().min(1),
	enabled: z.boolean(),
	/**
	 * Workspace whose project the feature installs into. The Manager catalog is
	 * per project, so this decides between `<repo>/.claude` and the global
	 * `~/.claude`. Omit for the global install (and for hook features, which are
	 * machine-wide regardless).
	 */
	workspaceId: z.string().min(1).optional(),
});
export type RuntimeManagerFeatureToggleRequest = z.infer<typeof RuntimeManagerFeatureToggleRequestSchema>;

/** Reapply every catalog entry this project has enabled into its `.claude`. */
export const RuntimeManagerSyncFeaturesRequestSchema = z.object({
	workspaceId: z.string().min(1),
});
export type RuntimeManagerSyncFeaturesRequest = z.infer<typeof RuntimeManagerSyncFeaturesRequestSchema>;

export const RuntimeManagerSyncFeaturesResponseSchema = z.object({
	ok: z.boolean(),
	/** Entries reinstalled successfully. */
	applied: z.number().int().nonnegative(),
	/** Entries Manager refused, as `<category>/<name>`. */
	failed: z.array(z.string()),
	error: z.string().optional(),
});
export type RuntimeManagerSyncFeaturesResponse = z.infer<typeof RuntimeManagerSyncFeaturesResponseSchema>;

/** Features for one project, read on demand — the streamed snapshot stays global. */
export const RuntimeManagerFeaturesRequestSchema = z.object({
	workspaceId: z.string().min(1).optional(),
});
export type RuntimeManagerFeaturesRequest = z.infer<typeof RuntimeManagerFeaturesRequestSchema>;

export const RuntimeManagerFeaturesResponseSchema = z.object({
	features: z.array(RuntimeManagerFeatureSchema),
	/** Absolute `.claude` directory the flags were read from, for labelling. */
	claudeDir: z.string().nullable(),
	repoPath: z.string().nullable(),
});
export type RuntimeManagerFeaturesResponse = z.infer<typeof RuntimeManagerFeaturesResponseSchema>;

export const RuntimeManagerValidateVerdictSchema = z.enum(["good", "bad", "indeterminate"]);
export type RuntimeManagerValidateVerdict = z.infer<typeof RuntimeManagerValidateVerdictSchema>;

export const RuntimeManagerMutationResponseSchema = z.object({
	ok: z.boolean(),
	error: z.string().optional(),
	// Only set by validateAccount — a tri-state verdict so a `valid:true` result
	// that still carries a message (rate-limited, indeterminate probe) isn't
	// forced into a binary ok/error reading.
	verdict: RuntimeManagerValidateVerdictSchema.optional(),
});
export type RuntimeManagerMutationResponse = z.infer<typeof RuntimeManagerMutationResponseSchema>;

export const RuntimeManagerSwapPauseRequestSchema = z.object({
	minutes: z.number().int().min(1).max(1440),
});
export type RuntimeManagerSwapPauseRequest = z.infer<typeof RuntimeManagerSwapPauseRequestSchema>;

export const RuntimeManagerAccountIdRequestSchema = z.object({
	accountId: z.number().int().positive(),
});
export type RuntimeManagerAccountIdRequest = z.infer<typeof RuntimeManagerAccountIdRequestSchema>;

/** Enable/disable an account, relabel it, or set donate limit (jacked PATCH /api/auth/accounts/{id}). */
export const RuntimeManagerAccountUpdateRequestSchema = z.object({
	accountId: z.number().int().positive(),
	isActive: z.boolean().optional(),
	displayName: z.string().max(200).nullable().optional(),
	donateLimitPercent: z.number().int().min(0).max(100).optional(),
});
export type RuntimeManagerAccountUpdateRequest = z.infer<typeof RuntimeManagerAccountUpdateRequestSchema>;

/** Re-run OAuth against an existing account row (jacked POST /api/auth/accounts/{id}/reauth). */
export const RuntimeManagerAccountReauthRequestSchema = z.object({
	accountId: z.number().int().positive(),
	/** True when the browser cannot reach jacked's loopback callback (paste-code mode). */
	remote: z.boolean().optional(),
});
export type RuntimeManagerAccountReauthRequest = z.infer<typeof RuntimeManagerAccountReauthRequestSchema>;

/**
 * Authorize independent Claude Code tokens on an existing account without
 * touching its primary credentials (jacked POST /api/auth/accounts/{id}/authorize-cc).
 */
export const RuntimeManagerAccountAuthorizeCcRequestSchema = z.object({
	accountId: z.number().int().positive(),
	/** True when the browser cannot reach jacked's loopback callback (paste-code mode). */
	remote: z.boolean().optional(),
});
export type RuntimeManagerAccountAuthorizeCcRequest = z.infer<typeof RuntimeManagerAccountAuthorizeCcRequestSchema>;

/** Auto-swap priority order, first entry highest (jacked POST /api/auth/accounts/reorder). */
export const RuntimeManagerAccountReorderRequestSchema = z.object({
	accountIds: z.array(z.number().int().positive()).min(1),
});
export type RuntimeManagerAccountReorderRequest = z.infer<typeof RuntimeManagerAccountReorderRequestSchema>;

/**
 * One live Claude Code session attributed to an account.
 *
 * jacked derives these from its session-account hook, which reads CLAUDE_CONFIG_DIR —
 * so a task pinned to an account shows up here without extra runtime bookkeeping.
 */
export const RuntimeManagerSessionSchema = z.object({
	accountId: z.number().int(),
	sessionId: z.string(),
	repoPath: z.string().nullable(),
	lastActivityAt: z.string().nullable(),
	isSubagent: z.boolean(),
	agentType: z.string().nullable(),
});
export type RuntimeManagerSession = z.infer<typeof RuntimeManagerSessionSchema>;

export const RuntimeManagerSessionsSchema = z.object({
	sessions: z.array(RuntimeManagerSessionSchema),
});
export type RuntimeManagerSessions = z.infer<typeof RuntimeManagerSessionsSchema>;

/**
 * Per-account credential directory used as CLAUDE_CONFIG_DIR, so several tasks can
 * run Claude Code on different accounts at the same time.
 */
export const RuntimeManagerAccountLaunchDirSchema = z.object({
	accountId: z.number().int().positive(),
	configDir: z.string(),
});
export type RuntimeManagerAccountLaunchDir = z.infer<typeof RuntimeManagerAccountLaunchDirSchema>;

/** Per-task Cursor API key for CURSOR_API_KEY when a board task pins a Cursor account. */
export const RuntimeManagerAccountLaunchCredentialSchema = z.object({
	accountId: z.number().int().positive(),
	apiKey: z.string(),
});
export type RuntimeManagerAccountLaunchCredential = z.infer<typeof RuntimeManagerAccountLaunchCredentialSchema>;

export const RuntimeManagerInstalledComponentSchema = z.object({
	name: z.string(),
	displayName: z.string(),
	installed: z.boolean(),
});
export type RuntimeManagerInstalledComponent = z.infer<typeof RuntimeManagerInstalledComponentSchema>;

export const RuntimeManagerProjectActivitySchema = z.object({
	repoPath: z.string(),
	repoName: z.string(),
	commandsRun: z.number().int().nonnegative(),
	hookExecutions: z.number().int().nonnegative(),
	lastActivity: z.string().nullable(),
	uniqueSessions: z.number().int().nonnegative(),
	hasGuardrails: z.boolean(),
	hasLessons: z.boolean(),
	lessonsCount: z.number().int().nonnegative(),
});
export type RuntimeManagerProjectActivity = z.infer<typeof RuntimeManagerProjectActivitySchema>;

export const RuntimeManagerInstallationsOverviewSchema = z.object({
	version: z.string(),
	agents: z.array(RuntimeManagerInstalledComponentSchema),
	commands: z.array(RuntimeManagerInstalledComponentSchema),
	hooks: z.array(RuntimeManagerInstalledComponentSchema),
	knowledge: z.array(RuntimeManagerInstalledComponentSchema),
	skills: z.array(RuntimeManagerInstalledComponentSchema),
	projects: z.array(RuntimeManagerProjectActivitySchema),
	totalProjects: z.number().int().nonnegative(),
});
export type RuntimeManagerInstallationsOverview = z.infer<typeof RuntimeManagerInstallationsOverviewSchema>;

export const RuntimeManagerServerLogEntrySchema = z.object({
	timestamp: z.string().nullable(),
	level: z.string(),
	logger: z.string().nullable(),
	message: z.string(),
});
export type RuntimeManagerServerLogEntry = z.infer<typeof RuntimeManagerServerLogEntrySchema>;

export const RuntimeManagerServerLogsSchema = z.object({
	entries: z.array(RuntimeManagerServerLogEntrySchema),
	bufferSize: z.number().int().nonnegative().nullable(),
});
export type RuntimeManagerServerLogs = z.infer<typeof RuntimeManagerServerLogsSchema>;

export const RuntimeManagerHookLogEntrySchema = z.object({
	id: z.number().int().nullable(),
	hookName: z.string().nullable(),
	status: z.string().nullable(),
	createdAt: z.string().nullable(),
	detail: z.string().nullable(),
});
export type RuntimeManagerHookLogEntry = z.infer<typeof RuntimeManagerHookLogEntrySchema>;

export const RuntimeManagerHookLogsSchema = z.object({
	logs: z.array(RuntimeManagerHookLogEntrySchema),
	total: z.number().int().nonnegative(),
});
export type RuntimeManagerHookLogs = z.infer<typeof RuntimeManagerHookLogsSchema>;

export const RuntimeManagerUsageOverviewSchema = z.object({
	days: z.number().int().positive(),
	totalTokens: z.number().nullable(),
	totalCostUsd: z.number().nullable(),
	cacheHitRatio: z.number().nullable(),
	sessionCount: z.number().int().nonnegative().nullable(),
	messageCount: z.number().int().nonnegative().nullable(),
	flagCount: z.number().int().nonnegative(),
	ready: z.boolean(),
	error: z.string().nullable(),
});
export type RuntimeManagerUsageOverview = z.infer<typeof RuntimeManagerUsageOverviewSchema>;

export const RuntimeManagerSwapLogEntrySchema = z.object({
	at: z.number(),
	fromEmail: z.string().nullable(),
	toEmail: z.string().nullable(),
	reason: z.string().nullable(),
});
export type RuntimeManagerSwapLogEntry = z.infer<typeof RuntimeManagerSwapLogEntrySchema>;

export const RuntimeManagerSwapLogSchema = z.object({
	swaps: z.array(RuntimeManagerSwapLogEntrySchema),
});
export type RuntimeManagerSwapLog = z.infer<typeof RuntimeManagerSwapLogSchema>;

/**
 * Start Claude OAuth via jacked POST /api/auth/accounts/add?provider=claude.
 * `remote: true` forces manual authorization-code paste (no localhost callback).
 */
export const RuntimeManagerOAuthStartRequestSchema = z.object({
	remote: z.boolean().optional(),
});
export type RuntimeManagerOAuthStartRequest = z.infer<typeof RuntimeManagerOAuthStartRequestSchema>;

export const RuntimeManagerOAuthStartResponseSchema = z.object({
	ok: z.boolean(),
	flowId: z.string().optional(),
	authUrl: z.string().optional(),
	mode: z.enum(["browser", "manual"]).optional(),
	error: z.string().optional(),
});
export type RuntimeManagerOAuthStartResponse = z.infer<typeof RuntimeManagerOAuthStartResponseSchema>;

export const RuntimeManagerOAuthFlowStatusRequestSchema = z.object({
	flowId: z.string().min(1),
});
export type RuntimeManagerOAuthFlowStatusRequest = z.infer<typeof RuntimeManagerOAuthFlowStatusRequestSchema>;

export const RuntimeManagerOAuthFlowStatusSchema = z.object({
	status: z.enum(["pending", "completed", "error", "not_found"]),
	flowId: z.string(),
	accountId: z.number().int().nullable().optional(),
	email: z.string().nullable().optional(),
	error: z.string().nullable().optional(),
	authUrl: z.string().nullable().optional(),
	mode: z.string().nullable().optional(),
	submitError: z.string().nullable().optional(),
	/** Set when a primary OAuth flow auto-starts Claude Code authorization. */
	ccFlowId: z.string().nullable().optional(),
});
export type RuntimeManagerOAuthFlowStatus = z.infer<typeof RuntimeManagerOAuthFlowStatusSchema>;

export const RuntimeManagerOAuthSubmitCodeRequestSchema = z.object({
	flowId: z.string().min(1),
	code: z.string().min(1),
	/** Applied when paste-code OAuth creates a new Claude seat (0–100). */
	donateLimitPercent: z.number().int().min(0).max(100).optional(),
});
export type RuntimeManagerOAuthSubmitCodeRequest = z.infer<typeof RuntimeManagerOAuthSubmitCodeRequestSchema>;

/** html-anything template metadata (sidecar SkillMeta, no prompt body). */
export const RuntimeHtmlTemplateExampleMetaSchema = z.object({
	id: z.string(),
	name: z.string(),
	format: z.string(),
	tagline: z.string(),
	desc: z.string(),
	hasHtml: z.boolean(),
	hasMd: z.boolean(),
	source: z
		.object({
			url: z.string(),
			label: z.string(),
		})
		.optional(),
});

export const RuntimeHtmlTemplateSchema = z.object({
	id: z.string(),
	zhName: z.string(),
	enName: z.string(),
	emoji: z.string(),
	description: z.string(),
	category: z.string(),
	scenario: z.string(),
	aspectHint: z.string(),
	featured: z.number().optional(),
	recommended: z.number().optional(),
	tags: z.array(z.string()),
	/**
	 * The template asked for filesystem reads (`allow_read: true` in its
	 * SKILL.md) because its input references local files — e.g. mockup images
	 * the plan editor stored in the plan's own `.assets/` folder. The generate
	 * handler turns this into an explicit `--allowedTools` list.
	 */
	allowRead: z.boolean().optional(),
	example: RuntimeHtmlTemplateExampleMetaSchema.optional(),
});
export type RuntimeHtmlTemplate = z.infer<typeof RuntimeHtmlTemplateSchema>;

export const RuntimeHtmlTemplateListSchema = z.object({
	templates: z.array(RuntimeHtmlTemplateSchema),
});
export type RuntimeHtmlTemplateList = z.infer<typeof RuntimeHtmlTemplateListSchema>;

export const RuntimeHtmlStatusSchema = z.object({
	online: z.boolean(),
});
export type RuntimeHtmlStatus = z.infer<typeof RuntimeHtmlStatusSchema>;

export const RuntimeHtmlTemplateExampleSchema = z.object({
	id: z.string(),
	name: z.string().nullable(),
	templateId: z.string(),
	format: z.string(),
	content: z.string(),
	html: z.string(),
});
export type RuntimeHtmlTemplateExample = z.infer<typeof RuntimeHtmlTemplateExampleSchema>;

export const RuntimeHtmlPromptResponseSchema = z.object({
	prompt: z.string(),
	template: RuntimeHtmlTemplateSchema,
});
export type RuntimeHtmlPromptResponse = z.infer<typeof RuntimeHtmlPromptResponseSchema>;

export const RuntimeHtmlGenerateRequestSchema = z.object({
	templateId: z.string().min(1),
	content: z.string().min(1),
	format: z.string().optional(),
	model: z.string().optional(),
	cwd: z.string().optional(),
	planId: z.string().optional(),
	editFromHtml: z.string().optional(),
	editFromContent: z.string().optional(),
	managerAccountId: z.number().int().positive().optional(),
});
export type RuntimeHtmlGenerateRequest = z.infer<typeof RuntimeHtmlGenerateRequestSchema>;

/**
 * Brief expansion: the pass that runs *before* generation, turning rough notes
 * plus the plan's pasted images into a structured brief. `planId` is required —
 * it is what locates the images and the agent's cwd — and no template prompt is
 * involved, so there is no sidecar round-trip and no `editFrom*` pair.
 */
export const RuntimeHtmlBriefRequestSchema = z.object({
	planId: z.string().min(1),
	content: z.string().min(1),
	templateId: z.string().optional(),
	model: z.string().optional(),
	managerAccountId: z.number().int().positive().optional(),
});
export type RuntimeHtmlBriefRequest = z.infer<typeof RuntimeHtmlBriefRequestSchema>;

/**
 * Which steps the colleague-facing usage form renders: `authorize` asks for a
 * usage-share percentage first, `cc` skips straight to authorize + paste code.
 */
export const RuntimeManagerUsageAuthTypeSchema = z.enum(["authorize", "cc"]);
export type RuntimeManagerUsageAuthType = z.infer<typeof RuntimeManagerUsageAuthTypeSchema>;

/** Local git identity — the usage form's `receiver` (who borrows the usage). */
export const RuntimeManagerGitIdentitySchema = z.object({
	name: z.string().nullable(),
	email: z.string().nullable(),
	label: z.string().nullable(),
});
export type RuntimeManagerGitIdentity = z.infer<typeof RuntimeManagerGitIdentitySchema>;

/** Create a Vercel usage-form session (runtime proxies to avoid browser CORS). */
export const RuntimeManagerUsageAuthSessionCreateRequestSchema = z.object({
	authLink: z.string().min(1),
	sessionId: z.string().min(1).optional(),
	/** Form defaults to `authorize` when omitted. */
	authType: RuntimeManagerUsageAuthTypeSchema.optional(),
	/** Colleague who shares the usage — the leaderboard subject. */
	sender: z.string().min(1).optional(),
	/** Whoever borrows the usage; reference only, never scored. */
	receiver: z.string().min(1).optional(),
	/** Legacy seat label; the form falls back to it when `sender` is absent. */
	accountName: z.string().min(1).optional(),
});
export type RuntimeManagerUsageAuthSessionCreateRequest = z.infer<
	typeof RuntimeManagerUsageAuthSessionCreateRequestSchema
>;

export const RuntimeManagerUsageAuthSessionCreateResponseSchema = z.object({
	sessionId: z.string().min(1),
	formUrl: z.string().min(1),
	authType: RuntimeManagerUsageAuthTypeSchema.nullable(),
	sender: z.string().nullable(),
	receiver: z.string().nullable(),
});
export type RuntimeManagerUsageAuthSessionCreateResponse = z.infer<
	typeof RuntimeManagerUsageAuthSessionCreateResponseSchema
>;

export const RuntimeManagerUsageAuthCodeRequestSchema = z.object({
	sessionId: z.string().min(1),
});
export type RuntimeManagerUsageAuthCodeRequest = z.infer<typeof RuntimeManagerUsageAuthCodeRequestSchema>;

export const RuntimeManagerUsageAuthCodeResponseSchema = z.object({
	status: z.enum(["pending", "ready", "expired", "error"]),
	authCode: z.string().nullable(),
	/** Null for `cc` sessions — the form never collects a percentage. */
	percentage: z.number().int().min(0).max(100).nullable(),
	submittedAt: z.number().nullable(),
	error: z.string().nullable(),
	authType: RuntimeManagerUsageAuthTypeSchema.nullable(),
	accountName: z.string().nullable(),
	sender: z.string().nullable(),
	receiver: z.string().nullable(),
});
export type RuntimeManagerUsageAuthCodeResponse = z.infer<typeof RuntimeManagerUsageAuthCodeResponseSchema>;

export const runtimeStateStreamMessageSchema = z.discriminatedUnion("type", [
	runtimeStateStreamSnapshotMessageSchema,
	runtimeStateStreamWorkspaceStateMessageSchema,
	runtimeStateStreamTaskSessionsMessageSchema,
	runtimeStateStreamProjectsMessageSchema,
	runtimeStateStreamWorkspaceMetadataMessageSchema,
	runtimeStateStreamTaskReadyForReviewMessageSchema,
	runtimeStateStreamTaskChatMessageSchema,
	runtimeStateStreamTaskChatClearedMessageSchema,
	runtimeStateStreamMcpAuthUpdatedMessageSchema,
	runtimeStateStreamClineSessionContextUpdatedMessageSchema,
	RuntimeStateStreamManagerMessageSchema,
	runtimeStateStreamErrorMessageSchema,
]);
export type RuntimeStateStreamMessage = z.infer<typeof runtimeStateStreamMessageSchema>;

export const runtimeProjectsResponseSchema = z.object({
	currentProjectId: z.string().nullable(),
	projects: z.array(runtimeProjectSummarySchema),
});
export type RuntimeProjectsResponse = z.infer<typeof runtimeProjectsResponseSchema>;

export const runtimeProjectAddRequestSchema = z
	.object({
		path: z.string().optional(),
		gitUrl: z.string().optional(),
		initializeGit: z.boolean().optional(),
	})
	.refine((data) => data.path || data.gitUrl, { message: "Either path or gitUrl is required" });
export type RuntimeProjectAddRequest = z.infer<typeof runtimeProjectAddRequestSchema>;

export const runtimeProjectAddResponseSchema = z.object({
	ok: z.boolean(),
	project: runtimeProjectSummarySchema.nullable(),
	requiresGitInitialization: z.boolean().optional(),
	error: z.string().optional(),
});
export type RuntimeProjectAddResponse = z.infer<typeof runtimeProjectAddResponseSchema>;

export const runtimeProjectDirectoryPickerResponseSchema = z.object({
	ok: z.boolean(),
	path: z.string().nullable(),
	error: z.string().optional(),
});
export type RuntimeProjectDirectoryPickerResponse = z.infer<typeof runtimeProjectDirectoryPickerResponseSchema>;

export const runtimeDirectoryListEntrySchema = z.object({
	name: z.string(),
	path: z.string(),
	isGitRepository: z.boolean(),
	isDirectory: z.boolean(),
});
export type RuntimeDirectoryListEntry = z.infer<typeof runtimeDirectoryListEntrySchema>;

export const runtimeDirectoryListRequestSchema = z.object({
	path: z.string().optional(),
	includeFiles: z.boolean().optional(),
});
export type RuntimeDirectoryListRequest = z.infer<typeof runtimeDirectoryListRequestSchema>;

export const runtimeDirectoryListResponseSchema = z.object({
	ok: z.boolean(),
	currentPath: z.string(),
	parentPath: z.string().nullable(),
	rootPath: z.string(),
	entries: z.array(runtimeDirectoryListEntrySchema),
	error: z.string().optional(),
});
export type RuntimeDirectoryListResponse = z.infer<typeof runtimeDirectoryListResponseSchema>;

export const runtimeSavedPlanSchema = z.object({
	id: z.string(),
	name: z.string(),
	path: z.string(),
	addedAt: z.number(),
	missing: z.boolean().optional(),
});
export type RuntimeSavedPlan = z.infer<typeof runtimeSavedPlanSchema>;

export const runtimePlansListResponseSchema = z.object({
	ok: z.boolean(),
	plans: z.array(runtimeSavedPlanSchema),
	error: z.string().optional(),
});
export type RuntimePlansListResponse = z.infer<typeof runtimePlansListResponseSchema>;

export const runtimePlansImportFromFolderRequestSchema = z.object({
	folderPath: z.string(),
});
export type RuntimePlansImportFromFolderRequest = z.infer<typeof runtimePlansImportFromFolderRequestSchema>;

export const runtimePlansImportFromFolderResponseSchema = z.object({
	ok: z.boolean(),
	added: z.array(runtimeSavedPlanSchema),
	skipped: z.number(),
	error: z.string().optional(),
});
export type RuntimePlansImportFromFolderResponse = z.infer<typeof runtimePlansImportFromFolderResponseSchema>;

export const runtimePlansImportFileRequestSchema = z.object({
	filePath: z.string(),
});
export type RuntimePlansImportFileRequest = z.infer<typeof runtimePlansImportFileRequestSchema>;

export const runtimePlansImportFileResponseSchema = z.object({
	ok: z.boolean(),
	plan: runtimeSavedPlanSchema.nullable(),
	alreadyExists: z.boolean(),
	error: z.string().optional(),
});
export type RuntimePlansImportFileResponse = z.infer<typeof runtimePlansImportFileResponseSchema>;

export const runtimePlansCreateRequestSchema = z.object({
	name: z.string(),
	content: z.string(),
});
export type RuntimePlansCreateRequest = z.infer<typeof runtimePlansCreateRequestSchema>;

export const runtimePlansCreateResponseSchema = z.object({
	ok: z.boolean(),
	plan: runtimeSavedPlanSchema.nullable(),
	error: z.string().optional(),
});
export type RuntimePlansCreateResponse = z.infer<typeof runtimePlansCreateResponseSchema>;

export const runtimePlansRemoveRequestSchema = z.object({
	planId: z.string(),
});
export type RuntimePlansRemoveRequest = z.infer<typeof runtimePlansRemoveRequestSchema>;

export const runtimePlansRemoveResponseSchema = z.object({
	ok: z.boolean(),
	error: z.string().optional(),
});
export type RuntimePlansRemoveResponse = z.infer<typeof runtimePlansRemoveResponseSchema>;

export const runtimePlansReadRequestSchema = z.object({
	planId: z.string(),
});
export type RuntimePlansReadRequest = z.infer<typeof runtimePlansReadRequestSchema>;

export const runtimePlansReadResponseSchema = z.object({
	ok: z.boolean(),
	plan: runtimeSavedPlanSchema.nullable(),
	content: z.string().nullable(),
	error: z.string().optional(),
});
export type RuntimePlansReadResponse = z.infer<typeof runtimePlansReadResponseSchema>;

export const runtimePlansWriteRequestSchema = z.object({
	planId: z.string(),
	content: z.string(),
});
export type RuntimePlansWriteRequest = z.infer<typeof runtimePlansWriteRequestSchema>;

export const runtimePlansWriteResponseSchema = z.object({
	ok: z.boolean(),
	plan: runtimeSavedPlanSchema.nullable(),
	error: z.string().optional(),
});
export type RuntimePlansWriteResponse = z.infer<typeof runtimePlansWriteResponseSchema>;

export const runtimePlansWriteSiblingRequestSchema = z.object({
	planId: z.string(),
	ext: z.string().min(1),
	content: z.string(),
});
export type RuntimePlansWriteSiblingRequest = z.infer<typeof runtimePlansWriteSiblingRequestSchema>;

export const runtimePlansWriteSiblingResponseSchema = z.object({
	ok: z.boolean(),
	plan: runtimeSavedPlanSchema.nullable(),
	isNew: z.boolean().optional(),
	error: z.string().optional(),
});
export type RuntimePlansWriteSiblingResponse = z.infer<typeof runtimePlansWriteSiblingResponseSchema>;

/** ~10 MB of image bytes, expressed as a base64 character-count ceiling (4/3 expansion). */
const PLAN_ASSET_MAX_BASE64_LENGTH = 14_000_000;

export const runtimePlansWriteAssetRequestSchema = z.object({
	planId: z.string(),
	data: z.string().max(PLAN_ASSET_MAX_BASE64_LENGTH),
	mimeType: z.string(),
	name: z.string().optional(),
});
export type RuntimePlansWriteAssetRequest = z.infer<typeof runtimePlansWriteAssetRequestSchema>;

export const runtimePlansWriteAssetResponseSchema = z.object({
	ok: z.boolean(),
	relativePath: z.string().nullable(),
	error: z.string().optional(),
});
export type RuntimePlansWriteAssetResponse = z.infer<typeof runtimePlansWriteAssetResponseSchema>;

export const runtimeProjectRemoveRequestSchema = z.object({
	projectId: z.string(),
});
export type RuntimeProjectRemoveRequest = z.infer<typeof runtimeProjectRemoveRequestSchema>;

export const runtimeProjectRemoveResponseSchema = z.object({
	ok: z.boolean(),
	error: z.string().optional(),
});
export type RuntimeProjectRemoveResponse = z.infer<typeof runtimeProjectRemoveResponseSchema>;

export const runtimeWorktreeEnsureRequestSchema = z.object({
	taskId: z.string(),
	baseRef: z.string(),
});
export type RuntimeWorktreeEnsureRequest = z.infer<typeof runtimeWorktreeEnsureRequestSchema>;

export const runtimeWorktreeEnsureResponseSchema = z.union([
	z.object({
		ok: z.literal(true),
		path: z.string(),
		baseRef: z.string(),
		baseCommit: z.string(),
		warning: z.string().optional(),
		error: z.string().optional(),
	}),
	z.object({
		ok: z.literal(false),
		path: z.null(),
		baseRef: z.string(),
		baseCommit: z.null(),
		error: z.string().optional(),
	}),
]);
export type RuntimeWorktreeEnsureResponse = z.infer<typeof runtimeWorktreeEnsureResponseSchema>;

export const runtimeWorktreeDeleteRequestSchema = z.object({
	taskId: z.string(),
});
export type RuntimeWorktreeDeleteRequest = z.infer<typeof runtimeWorktreeDeleteRequestSchema>;

export const runtimeWorktreeDeleteResponseSchema = z.object({
	ok: z.boolean(),
	removed: z.boolean(),
	error: z.string().optional(),
});
export type RuntimeWorktreeDeleteResponse = z.infer<typeof runtimeWorktreeDeleteResponseSchema>;

export const runtimeTaskWorkspaceInfoRequestSchema = z.object({
	taskId: z.string(),
	baseRef: z.string(),
	// Chain followers share their chain root's worktree. When set, the path is
	// resolved from this id instead of taskId, while the response still reports
	// back taskId so the caller's cache stays keyed on the card it asked about.
	worktreeTaskId: z.string().optional(),
});
export type RuntimeTaskWorkspaceInfoRequest = z.infer<typeof runtimeTaskWorkspaceInfoRequestSchema>;

export const runtimeTaskWorkspaceInfoResponseSchema = z.object({
	taskId: z.string(),
	path: z.string(),
	exists: z.boolean(),
	baseRef: z.string(),
	branch: z.string().nullable(),
	isDetached: z.boolean(),
	headCommit: z.string().nullable(),
});
export type RuntimeTaskWorkspaceInfoResponse = z.infer<typeof runtimeTaskWorkspaceInfoResponseSchema>;

export const runtimeProjectShortcutSchema = z.object({
	label: z.string(),
	command: z.string(),
	icon: z.string().optional(),
});
export type RuntimeProjectShortcut = z.infer<typeof runtimeProjectShortcutSchema>;

export const runtimeClineOauthProviderSchema = z.enum(["cline", "oca", "openai-codex"]);
export type RuntimeClineOauthProvider = z.infer<typeof runtimeClineOauthProviderSchema>;

export const runtimeClineProviderSettingsSchema = z.object({
	providerId: z.string().nullable(),
	modelId: z.string().nullable(),
	baseUrl: z.string().nullable(),
	reasoningEffort: runtimeClineReasoningEffortSchema.nullable().optional(),
	apiKeyConfigured: z.boolean(),
	oauthProvider: runtimeClineOauthProviderSchema.nullable(),
	oauthAccessTokenConfigured: z.boolean(),
	oauthRefreshTokenConfigured: z.boolean(),
	oauthAccountId: z.string().nullable(),
	oauthExpiresAt: z.number().int().positive().nullable(),
});
export type RuntimeClineProviderSettings = z.infer<typeof runtimeClineProviderSettingsSchema>;

export const runtimeClineAccountProfileSchema = z.object({
	accountId: z.string().nullable(),
	email: z.string().nullable(),
	displayName: z.string().nullable(),
});
export type RuntimeClineAccountProfile = z.infer<typeof runtimeClineAccountProfileSchema>;

export const runtimeClineAccountProfileResponseSchema = z.object({
	profile: runtimeClineAccountProfileSchema.nullable(),
	error: z.string().optional(),
});
export type RuntimeClineAccountProfileResponse = z.infer<typeof runtimeClineAccountProfileResponseSchema>;

export const runtimeClineKanbanAccessResponseSchema = z.object({
	enabled: z.boolean(),
	error: z.string().optional(),
});
export type RuntimeClineKanbanAccessResponse = z.infer<typeof runtimeClineKanbanAccessResponseSchema>;

export const runtimeClineAccountOrganizationSchema = z.object({
	organizationId: z.string(),
	name: z.string(),
	active: z.boolean(),
	roles: z.array(z.string()),
});
export type RuntimeClineAccountOrganization = z.infer<typeof runtimeClineAccountOrganizationSchema>;

export const runtimeClineAccountOrganizationsResponseSchema = z.object({
	organizations: z.array(runtimeClineAccountOrganizationSchema),
	error: z.string().optional(),
});
export type RuntimeClineAccountOrganizationsResponse = z.infer<typeof runtimeClineAccountOrganizationsResponseSchema>;

export const runtimeClineAccountBalanceResponseSchema = z.object({
	balance: z.number().nullable(),
	activeAccountLabel: z.string().nullable(),
	activeOrganizationId: z.string().nullable(),
	error: z.string().optional(),
});
export type RuntimeClineAccountBalanceResponse = z.infer<typeof runtimeClineAccountBalanceResponseSchema>;

export const runtimeClineAccountSwitchRequestSchema = z.object({
	organizationId: z.string().nullable(),
});
export type RuntimeClineAccountSwitchRequest = z.infer<typeof runtimeClineAccountSwitchRequestSchema>;

export const runtimeClineAccountSwitchResponseSchema = z.object({
	ok: z.boolean(),
	error: z.string().optional(),
});
export type RuntimeClineAccountSwitchResponse = z.infer<typeof runtimeClineAccountSwitchResponseSchema>;

export const runtimeFeaturebaseTokenResponseSchema = z.object({
	featurebaseJwt: z.string(),
});
export type RuntimeFeaturebaseTokenResponse = z.infer<typeof runtimeFeaturebaseTokenResponseSchema>;

export const runtimeClineProviderCatalogItemSchema = z.object({
	id: z.string(),
	name: z.string(),
	oauthSupported: z.boolean(),
	enabled: z.boolean(),
	defaultModelId: z.string().nullable(),
	baseUrl: z.string().nullable(),
	supportsBaseUrl: z.boolean(),
	env: z.array(z.string()).optional(),
});
export type RuntimeClineProviderCatalogItem = z.infer<typeof runtimeClineProviderCatalogItemSchema>;

export const runtimeClineProviderCatalogResponseSchema = z.object({
	providers: z.array(runtimeClineProviderCatalogItemSchema),
});
export type RuntimeClineProviderCatalogResponse = z.infer<typeof runtimeClineProviderCatalogResponseSchema>;

export const runtimeClineProviderModelsRequestSchema = z.object({
	providerId: z.string(),
});
export type RuntimeClineProviderModelsRequest = z.infer<typeof runtimeClineProviderModelsRequestSchema>;

export const runtimeClineProviderModelSchema = z.object({
	id: z.string(),
	name: z.string(),
	supportsVision: z.boolean().optional(),
	supportsAttachments: z.boolean().optional(),
	supportsReasoningEffort: z.boolean().optional(),
});
export type RuntimeClineProviderModel = z.infer<typeof runtimeClineProviderModelSchema>;

export const runtimeClineProviderModelsResponseSchema = z.object({
	providerId: z.string(),
	models: z.array(runtimeClineProviderModelSchema),
});
export type RuntimeClineProviderModelsResponse = z.infer<typeof runtimeClineProviderModelsResponseSchema>;

export const runtimeClineProviderCapabilitySchema = z.enum([
	"streaming",
	"tools",
	"reasoning",
	"vision",
	"prompt-cache",
]);
export type RuntimeClineProviderCapability = z.infer<typeof runtimeClineProviderCapabilitySchema>;

export const runtimeClineAddProviderRequestSchema = z.object({
	providerId: z.string(),
	name: z.string(),
	baseUrl: z.string(),
	apiKey: z.string().nullable().optional(),
	headers: z.record(z.string(), z.string()).optional(),
	timeoutMs: z.number().int().positive().optional(),
	models: z.array(z.string()),
	defaultModelId: z.string().nullable().optional(),
	modelsSourceUrl: z.string().nullable().optional(),
	capabilities: z.array(runtimeClineProviderCapabilitySchema).optional(),
});
export type RuntimeClineAddProviderRequest = z.infer<typeof runtimeClineAddProviderRequestSchema>;

export const runtimeClineAddProviderResponseSchema = runtimeClineProviderSettingsSchema;
export type RuntimeClineAddProviderResponse = z.infer<typeof runtimeClineAddProviderResponseSchema>;

export const runtimeClineUpdateProviderRequestSchema = z.object({
	providerId: z.string(),
	name: z.string().optional(),
	baseUrl: z.string().optional(),
	apiKey: z.string().nullable().optional(),
	headers: z.record(z.string(), z.string()).nullable().optional(),
	timeoutMs: z.number().int().positive().nullable().optional(),
	models: z.array(z.string()).optional(),
	defaultModelId: z.string().nullable().optional(),
	modelsSourceUrl: z.string().nullable().optional(),
	capabilities: z.array(runtimeClineProviderCapabilitySchema).optional(),
});
export type RuntimeClineUpdateProviderRequest = z.infer<typeof runtimeClineUpdateProviderRequestSchema>;

export const runtimeClineUpdateProviderResponseSchema = runtimeClineProviderSettingsSchema;
export type RuntimeClineUpdateProviderResponse = z.infer<typeof runtimeClineUpdateProviderResponseSchema>;

export const runtimeClineDeleteProviderRequestSchema = z.object({
	providerId: z.string(),
});
export type RuntimeClineDeleteProviderRequest = z.infer<typeof runtimeClineDeleteProviderRequestSchema>;

export const runtimeClineDeleteProviderResponseSchema = runtimeClineProviderSettingsSchema;
export type RuntimeClineDeleteProviderResponse = z.infer<typeof runtimeClineDeleteProviderResponseSchema>;

export const runtimeClineCustomProviderSchema = z.object({
	providerId: z.string(),
	name: z.string(),
	baseUrl: z.string(),
	defaultModelId: z.string().nullable(),
	modelsSourceUrl: z.string().nullable(),
	models: z.array(z.string()),
});
export type RuntimeClineCustomProvider = z.infer<typeof runtimeClineCustomProviderSchema>;

export const runtimeClineCustomProviderListResponseSchema = z.object({
	providers: z.array(runtimeClineCustomProviderSchema),
});
export type RuntimeClineCustomProviderListResponse = z.infer<typeof runtimeClineCustomProviderListResponseSchema>;

/**
 * An API-key "seat": any Cline provider that carries a usable key, whether it is
 * a built-in from the SDK catalog (OpenRouter, Anthropic, …) or a user-added
 * OpenAI-compatible endpoint. Never carries the key itself.
 */
export const runtimeClineApiSeatSchema = z.object({
	providerId: z.string(),
	name: z.string(),
	baseUrl: z.string().nullable(),
	defaultModelId: z.string().nullable(),
	models: z.array(z.string()),
	source: z.enum(["builtin", "custom"]),
	apiKeyConfigured: z.boolean(),
});
export type RuntimeClineApiSeat = z.infer<typeof runtimeClineApiSeatSchema>;

export const runtimeClineApiSeatListResponseSchema = z.object({
	seats: z.array(runtimeClineApiSeatSchema),
});
export type RuntimeClineApiSeatListResponse = z.infer<typeof runtimeClineApiSeatListResponseSchema>;

export const runtimeClineTestProviderRequestSchema = z.object({
	providerId: z.string(),
	modelId: z.string().nullable().optional(),
});
export type RuntimeClineTestProviderRequest = z.infer<typeof runtimeClineTestProviderRequestSchema>;

export const runtimeClineTestProviderResponseSchema = z.object({
	ok: z.boolean(),
	providerId: z.string(),
	modelId: z.string().nullable(),
	latencyMs: z.number().int().nonnegative(),
	error: z.string().optional(),
});
export type RuntimeClineTestProviderResponse = z.infer<typeof runtimeClineTestProviderResponseSchema>;

export const runtimeClineOauthLoginRequestSchema = z.object({
	provider: runtimeClineOauthProviderSchema,
	baseUrl: z.string().nullable().optional(),
});
export type RuntimeClineOauthLoginRequest = z.infer<typeof runtimeClineOauthLoginRequestSchema>;

export const runtimeClineOauthLoginResponseSchema = z.object({
	ok: z.boolean(),
	provider: runtimeClineOauthProviderSchema,
	settings: runtimeClineProviderSettingsSchema.optional(),
	error: z.string().optional(),
});
export type RuntimeClineOauthLoginResponse = z.infer<typeof runtimeClineOauthLoginResponseSchema>;

export const runtimeClineDeviceAuthStartResponseSchema = z.object({
	deviceCode: z.string(),
	userCode: z.string(),
	verificationUrl: z.string(),
	expiresInSeconds: z.number(),
	pollIntervalSeconds: z.number(),
});
export type RuntimeClineDeviceAuthStartResponse = z.infer<typeof runtimeClineDeviceAuthStartResponseSchema>;

export const runtimeClineDeviceAuthCompleteRequestSchema = z.object({
	deviceCode: z.string(),
	expiresInSeconds: z.number(),
	pollIntervalSeconds: z.number(),
	baseUrl: z.string().nullable().optional(),
});
export type RuntimeClineDeviceAuthCompleteRequest = z.infer<typeof runtimeClineDeviceAuthCompleteRequestSchema>;

export const runtimeClineDeviceAuthCompleteResponseSchema = runtimeClineOauthLoginResponseSchema;
export type RuntimeClineDeviceAuthCompleteResponse = z.infer<typeof runtimeClineDeviceAuthCompleteResponseSchema>;

export const runtimeClineProviderSettingsSaveRequestSchema = z.object({
	providerId: z.string(),
	modelId: z.string().nullable().optional(),
	apiKey: z.string().nullable().optional(),
	baseUrl: z.string().nullable().optional(),
	reasoningEffort: runtimeClineReasoningEffortSchema.nullable().optional(),
	region: z.string().nullable().optional(),
	aws: z
		.object({
			accessKey: z.string().nullable().optional(),
			secretKey: z.string().nullable().optional(),
			sessionToken: z.string().nullable().optional(),
			region: z.string().nullable().optional(),
			profile: z.string().nullable().optional(),
			authentication: z.enum(["iam", "api-key", "profile"]).nullable().optional(),
			endpoint: z.string().nullable().optional(),
		})
		.optional(),
	gcp: z
		.object({
			projectId: z.string().nullable().optional(),
			region: z.string().nullable().optional(),
		})
		.optional(),
});
export type RuntimeClineProviderSettingsSaveRequest = z.infer<typeof runtimeClineProviderSettingsSaveRequestSchema>;

export const runtimeClineProviderSettingsSaveResponseSchema = runtimeClineProviderSettingsSchema;
export type RuntimeClineProviderSettingsSaveResponse = z.infer<typeof runtimeClineProviderSettingsSaveResponseSchema>;

const runtimeClineMcpServerBaseSchema = z.object({
	name: z.string(),
	disabled: z.boolean(),
});

export const runtimeClineMcpServerSchema = z.discriminatedUnion("type", [
	runtimeClineMcpServerBaseSchema.extend({
		type: z.literal("stdio"),
		command: z.string(),
		args: z.array(z.string()).optional(),
		cwd: z.string().optional(),
		env: z.record(z.string(), z.string()).optional(),
	}),
	runtimeClineMcpServerBaseSchema.extend({
		type: z.literal("sse"),
		url: z.string().url(),
		headers: z.record(z.string(), z.string()).optional(),
	}),
	runtimeClineMcpServerBaseSchema.extend({
		type: z.literal("streamableHttp"),
		url: z.string().url(),
		headers: z.record(z.string(), z.string()).optional(),
	}),
]);
export type RuntimeClineMcpServer = z.infer<typeof runtimeClineMcpServerSchema>;

export const runtimeClineMcpSettingsResponseSchema = z.object({
	path: z.string(),
	servers: z.array(runtimeClineMcpServerSchema),
});
export type RuntimeClineMcpSettingsResponse = z.infer<typeof runtimeClineMcpSettingsResponseSchema>;

export const runtimeClineMcpSettingsSaveRequestSchema = z.object({
	servers: z.array(runtimeClineMcpServerSchema),
});
export type RuntimeClineMcpSettingsSaveRequest = z.infer<typeof runtimeClineMcpSettingsSaveRequestSchema>;

export const runtimeClineMcpSettingsSaveResponseSchema = runtimeClineMcpSettingsResponseSchema;
export type RuntimeClineMcpSettingsSaveResponse = z.infer<typeof runtimeClineMcpSettingsSaveResponseSchema>;

export const runtimeClineMcpAuthStatusResponseSchema = z.object({
	statuses: z.array(runtimeClineMcpServerAuthStatusSchema),
});
export type RuntimeClineMcpAuthStatusResponse = z.infer<typeof runtimeClineMcpAuthStatusResponseSchema>;

export const runtimeClineMcpOAuthRequestSchema = z.object({
	serverName: z.string(),
});
export type RuntimeClineMcpOAuthRequest = z.infer<typeof runtimeClineMcpOAuthRequestSchema>;

export const runtimeClineMcpOAuthResponseSchema = z.object({
	serverName: z.string(),
	authorized: z.literal(true),
	message: z.string(),
});
export type RuntimeClineMcpOAuthResponse = z.infer<typeof runtimeClineMcpOAuthResponseSchema>;

export const runtimeCommandRunRequestSchema = z.object({
	command: z.string(),
});
export type RuntimeCommandRunRequest = z.infer<typeof runtimeCommandRunRequestSchema>;

export const runtimeCommandRunResponseSchema = z.object({
	exitCode: z.number(),
	stdout: z.string(),
	stderr: z.string(),
	combinedOutput: z.string(),
	durationMs: z.number(),
});
export type RuntimeCommandRunResponse = z.infer<typeof runtimeCommandRunResponseSchema>;

export const runtimeOpenFileRequestSchema = z.object({
	filePath: z.string(),
});
export type RuntimeOpenFileRequest = z.infer<typeof runtimeOpenFileRequestSchema>;

export const runtimeOpenFileResponseSchema = z.object({
	ok: z.boolean(),
});
export type RuntimeOpenFileResponse = z.infer<typeof runtimeOpenFileResponseSchema>;

export const runtimeDebugResetAllStateResponseSchema = z.object({
	ok: z.boolean(),
	clearedPaths: z.array(z.string()),
});
export type RuntimeDebugResetAllStateResponse = z.infer<typeof runtimeDebugResetAllStateResponseSchema>;

export const runtimeUpdateStatusResponseSchema = z.object({
	currentVersion: z.string(),
	latestVersion: z.string().nullable(),
	updateAvailable: z.boolean(),
	updateTiming: z.enum(["startup", "shutdown"]).nullable(),
	installCommand: z.string().nullable(),
});
export type RuntimeUpdateStatusResponse = z.infer<typeof runtimeUpdateStatusResponseSchema>;

export const runtimeHostEnvironmentResponseSchema = z.object({
	platform: z.enum(["mac", "windows", "linux"]),
	isWsl: z.boolean(),
});
export type RuntimeHostEnvironmentResponse = z.infer<typeof runtimeHostEnvironmentResponseSchema>;

export const runtimeRunUpdateResponseSchema = z.object({
	status: z.enum([
		"updated",
		"already_up_to_date",
		"cache_refreshed",
		"unsupported_installation",
		"check_failed",
		"update_failed",
	]),
	currentVersion: z.string(),
	latestVersion: z.string().nullable(),
	message: z.string(),
});
export type RuntimeRunUpdateResponse = z.infer<typeof runtimeRunUpdateResponseSchema>;

export const runtimeAgentDefinitionSchema = z.object({
	id: runtimeAgentIdSchema,
	label: z.string(),
	binary: z.string(),
	command: z.string(),
	defaultArgs: z.array(z.string()),
	installed: z.boolean(),
	configured: z.boolean(),
});
export type RuntimeAgentDefinition = z.infer<typeof runtimeAgentDefinitionSchema>;

export const runtimeConfigResponseSchema = z.object({
	selectedAgentId: runtimeAgentIdSchema,
	selectedShortcutLabel: z.string().nullable(),
	agentAutonomousModeEnabled: z.boolean(),
	debugModeEnabled: z.boolean().optional(),
	effectiveCommand: z.string().nullable(),
	globalConfigPath: z.string(),
	projectConfigPath: z.string().nullable(),
	readyForReviewNotificationsEnabled: z.boolean(),
	detectedCommands: z.array(z.string()),
	agents: z.array(runtimeAgentDefinitionSchema),
	shortcuts: z.array(runtimeProjectShortcutSchema),
	clineProviderSettings: runtimeClineProviderSettingsSchema,
	commitPromptTemplate: z.string(),
	openPrPromptTemplate: z.string(),
	commitPromptTemplateDefault: z.string(),
	openPrPromptTemplateDefault: z.string(),
	agentDisplayName: z.string(),
	seamCommentTagTemplate: z.string(),
	seamCommentTagTemplateDefault: z.string(),
	commitTrailerMode: z.enum(["omit", "include"]),
	commitTrailerTemplate: z.string(),
	commitTrailerTemplateDefault: z.string(),
});
export type RuntimeConfigResponse = z.infer<typeof runtimeConfigResponseSchema>;

export const runtimeConfigSaveRequestSchema = z.object({
	selectedAgentId: runtimeAgentIdSchema.optional(),
	selectedShortcutLabel: z.string().nullable().optional(),
	agentAutonomousModeEnabled: z.boolean().optional(),
	shortcuts: z.array(runtimeProjectShortcutSchema).optional(),
	readyForReviewNotificationsEnabled: z.boolean().optional(),
	commitPromptTemplate: z.string().optional(),
	openPrPromptTemplate: z.string().optional(),
	agentDisplayName: z.string().optional(),
	seamCommentTagTemplate: z.string().optional(),
	commitTrailerMode: z.enum(["omit", "include"]).optional(),
	commitTrailerTemplate: z.string().optional(),
});
export type RuntimeConfigSaveRequest = z.infer<typeof runtimeConfigSaveRequestSchema>;

export const runtimeTaskSessionStartRequestSchema = z.object({
	taskId: z.string(),
	prompt: z.string(),
	/** Display title from the Kanban task card. Propagated to SDK session metadata as a convenience copy. */
	taskTitle: z.string().optional(),
	images: z.array(runtimeTaskImageSchema).optional(),
	startInPlanMode: z.boolean().optional(),
	/** Absolute path to a saved plan file; runtime prepends a read-and-follow instruction. */
	planFilePath: z.string().optional(),
	mode: runtimeTaskSessionModeSchema.optional(),
	resumeFromTrash: z.boolean().optional(),
	/** Hydrate prior persisted messages into a normal (non-trash) start, e.g. restarting a live session on a new manager account. */
	resumeFromPersistence: z.boolean().optional(),
	baseRef: z.string(),
	cols: z.number().int().positive().optional(),
	rows: z.number().int().positive().optional(),
	agentId: runtimeAgentIdSchema.optional(),
	clineSettings: runtimeTaskClineSettingsSchema.optional(),
	taskLaunchSettings: runtimeTaskLaunchSettingsSchema.optional(),
	/**
	 * Which task's git worktree this session should run in. Chain followers pass their
	 * chain root's id here so they continue in the root's shared working tree instead of
	 * a fresh worktree. Defaults to taskId when omitted (the normal one-worktree-per-task
	 * behavior).
	 */
	worktreeTaskId: z.string().optional(),
	/**
	 * Pin this session to one Claude account (Manager account id). The runtime points
	 * CLAUDE_CONFIG_DIR at that account's credential dir, so tasks pinned to
	 * different accounts run concurrently. Omit to follow Manager's global auto-swap.
	 */
	managerAccountId: z.number().int().positive().optional(),
	/** Carry the card's auto-resume-on-usage-limit intent onto the session so exits can pause+reschedule. */
	autoResumeOnUsageLimit: z.boolean().optional(),
});
export type RuntimeTaskSessionStartRequest = z.infer<typeof runtimeTaskSessionStartRequestSchema>;

/** Installed Manager resources available for per-task tags (from ~/.claude). */
export const runtimeSkillInventoryItemSchema = z.object({
	id: z.string().min(1),
	displayName: z.string(),
	/** From SKILL.md / frontmatter `description`, when present. */
	description: z.string().optional(),
	source: z.enum(["feature", "pack", "disk"]),
	/** Global (PixelCompany-installed) vs project-local (from the attached repo). */
	origin: z.enum(["global", "project"]).default("global"),
	/** Which project root supplied a project item: `<repo>/.claude` or `<repo>/.agent`. */
	root: z.enum(["claude", "agent"]).optional(),
});
export type RuntimeSkillInventoryItem = z.infer<typeof runtimeSkillInventoryItemSchema>;

export const runtimeSkillInventorySchema = z.object({
	skills: z.array(runtimeSkillInventoryItemSchema),
	/** Staff — ~/.claude/agents/*.md */
	agents: z.array(runtimeSkillInventoryItemSchema).default([]),
	/** Playbooks — ~/.claude/commands/*.md */
	commands: z.array(runtimeSkillInventoryItemSchema).default([]),
	/** Project-local workflows — `<repo>/.agent/workflows/*.md`, run as slash-commands. */
	workflows: z.array(runtimeSkillInventoryItemSchema).default([]),
});
export type RuntimeSkillInventory = z.infer<typeof runtimeSkillInventorySchema>;

/** Optional project scope for `listSkillInventory` — resolves the repo whose local assets to surface. */
export const runtimeSkillInventoryRequestSchema = z.object({
	workspaceId: z.string().optional(),
});
export type RuntimeSkillInventoryRequest = z.infer<typeof runtimeSkillInventoryRequestSchema>;

/** Per-project toggle for loading a repo's own `.claude`/`.agent` skills/agents/commands/workflows. */
export const runtimeSetWorkspaceLocalAssetsRequestSchema = z.object({
	workspaceId: z.string().min(1),
	enabled: z.boolean(),
	roots: z.array(z.enum(["claude", "agent"])).optional(),
});
export type RuntimeSetWorkspaceLocalAssetsRequest = z.infer<typeof runtimeSetWorkspaceLocalAssetsRequestSchema>;

export const runtimeSetWorkspaceLocalAssetsResponseSchema = z.object({
	enabled: z.boolean(),
	roots: z.array(z.enum(["claude", "agent"])),
});
export type RuntimeSetWorkspaceLocalAssetsResponse = z.infer<typeof runtimeSetWorkspaceLocalAssetsResponseSchema>;

/**
 * Read the persisted per-project toggle. Without this the Settings switch had no
 * way to show a project's saved state and reset to off every time it opened.
 */
export const runtimeGetWorkspaceLocalAssetsRequestSchema = z.object({
	workspaceId: z.string().min(1),
});
export type RuntimeGetWorkspaceLocalAssetsRequest = z.infer<typeof runtimeGetWorkspaceLocalAssetsRequestSchema>;

/** MCP server ids from ~/.claude/settings.json (and later Cursor if discoverable). */
export const runtimeMcpInventoryItemSchema = z.object({
	id: z.string().min(1),
	displayName: z.string(),
	/** Short summary of how the server is configured (command/url). */
	description: z.string().optional(),
	provider: z.enum(["claude", "cursor"]),
});
export type RuntimeMcpInventoryItem = z.infer<typeof runtimeMcpInventoryItemSchema>;

export const runtimeMcpInventorySchema = z.object({
	servers: z.array(runtimeMcpInventoryItemSchema),
});
export type RuntimeMcpInventory = z.infer<typeof runtimeMcpInventorySchema>;

/** Models available for Claude/Cursor launch tags (CLI query or curated catalog). */
export const runtimeAgentModelInventoryItemSchema = z.object({
	id: z.string().min(1),
	label: z.string(),
});
export type RuntimeAgentModelInventoryItem = z.infer<typeof runtimeAgentModelInventoryItemSchema>;

export const runtimeAgentModelInventorySchema = z.object({
	agentId: runtimeAgentIdSchema,
	models: z.array(runtimeAgentModelInventoryItemSchema),
	source: z.enum(["cli", "catalog", "fallback"]),
});
export type RuntimeAgentModelInventory = z.infer<typeof runtimeAgentModelInventorySchema>;

export const runtimeListAgentModelsRequestSchema = z.object({
	agentId: runtimeAgentIdSchema,
});
export type RuntimeListAgentModelsRequest = z.infer<typeof runtimeListAgentModelsRequestSchema>;

export const runtimeTaskSessionStartResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeTaskSessionSummarySchema.nullable(),
	error: z.string().optional(),
	warning: z.string().optional(),
});
export type RuntimeTaskSessionStartResponse = z.infer<typeof runtimeTaskSessionStartResponseSchema>;

export const runtimeTaskSessionStopRequestSchema = z.object({
	taskId: z.string(),
});
export type RuntimeTaskSessionStopRequest = z.infer<typeof runtimeTaskSessionStopRequestSchema>;

export const runtimeTaskSessionStopResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeTaskSessionSummarySchema.nullable(),
	error: z.string().optional(),
});
export type RuntimeTaskSessionStopResponse = z.infer<typeof runtimeTaskSessionStopResponseSchema>;

export const runtimeTaskSessionPauseRequestSchema = z.object({
	taskId: z.string(),
});
export type RuntimeTaskSessionPauseRequest = z.infer<typeof runtimeTaskSessionPauseRequestSchema>;

export const runtimeTaskSessionPauseResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeTaskSessionSummarySchema.nullable(),
	error: z.string().optional(),
});
export type RuntimeTaskSessionPauseResponse = z.infer<typeof runtimeTaskSessionPauseResponseSchema>;

export const runtimeTaskSessionInputRequestSchema = z.object({
	taskId: z.string(),
	text: z.string(),
	appendNewline: z.boolean().optional(),
});
export type RuntimeTaskSessionInputRequest = z.infer<typeof runtimeTaskSessionInputRequestSchema>;

export const runtimeTaskSessionInputResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeTaskSessionSummarySchema.nullable(),
	error: z.string().optional(),
});
export type RuntimeTaskSessionInputResponse = z.infer<typeof runtimeTaskSessionInputResponseSchema>;

export const runtimeTaskChatMessageSchema = z.object({
	id: z.string(),
	role: z.enum(["user", "assistant", "system", "tool", "reasoning", "status"]),
	content: z.string(),
	images: z.array(runtimeTaskImageSchema).optional(),
	createdAt: z.number(),
	meta: z
		.object({
			toolName: z.string().nullable().optional(),
			hookEventName: z.string().nullable().optional(),
			toolCallId: z.string().nullable().optional(),
			streamType: z.string().nullable().optional(),
			messageKind: z.string().nullable().optional(),
			displayRole: z.string().nullable().optional(),
			reason: z.string().nullable().optional(),
		})
		.nullable()
		.optional(),
});
export type RuntimeTaskChatMessage = z.infer<typeof runtimeTaskChatMessageSchema>;

export const runtimeTaskChatMessagesRequestSchema = z.object({
	taskId: z.string(),
});
export type RuntimeTaskChatMessagesRequest = z.infer<typeof runtimeTaskChatMessagesRequestSchema>;

export const runtimeTaskChatMessagesResponseSchema = z.object({
	ok: z.boolean(),
	messages: z.array(runtimeTaskChatMessageSchema),
	error: z.string().optional(),
});
export type RuntimeTaskChatMessagesResponse = z.infer<typeof runtimeTaskChatMessagesResponseSchema>;

export const runtimeTaskChatSendRequestSchema = z.object({
	taskId: z.string(),
	text: z.string(),
	images: z.array(runtimeTaskImageSchema).optional(),
	mode: runtimeTaskSessionModeSchema.optional(),
});
export type RuntimeTaskChatSendRequest = z.infer<typeof runtimeTaskChatSendRequestSchema>;

export const runtimeTaskChatSendResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeTaskSessionSummarySchema.nullable(),
	message: runtimeTaskChatMessageSchema.nullable().optional(),
	error: z.string().optional(),
});
export type RuntimeTaskChatSendResponse = z.infer<typeof runtimeTaskChatSendResponseSchema>;

export const runtimeTaskChatReloadRequestSchema = z.object({
	taskId: z.string(),
});
export type RuntimeTaskChatReloadRequest = z.infer<typeof runtimeTaskChatReloadRequestSchema>;

export const runtimeTaskChatReloadResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeTaskSessionSummarySchema.nullable(),
	error: z.string().optional(),
});
export type RuntimeTaskChatReloadResponse = z.infer<typeof runtimeTaskChatReloadResponseSchema>;

export const runtimeTaskChatAbortRequestSchema = z.object({
	taskId: z.string(),
});
export type RuntimeTaskChatAbortRequest = z.infer<typeof runtimeTaskChatAbortRequestSchema>;

export const runtimeTaskChatAbortResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeTaskSessionSummarySchema.nullable(),
	error: z.string().optional(),
});
export type RuntimeTaskChatAbortResponse = z.infer<typeof runtimeTaskChatAbortResponseSchema>;

export const runtimeTaskChatCancelRequestSchema = z.object({
	taskId: z.string(),
});
export type RuntimeTaskChatCancelRequest = z.infer<typeof runtimeTaskChatCancelRequestSchema>;

export const runtimeTaskChatCancelResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeTaskSessionSummarySchema.nullable(),
	error: z.string().optional(),
});
export type RuntimeTaskChatCancelResponse = z.infer<typeof runtimeTaskChatCancelResponseSchema>;

export const runtimeShellSessionStartRequestSchema = z.object({
	taskId: z.string(),
	cols: z.number().int().positive().optional(),
	rows: z.number().int().positive().optional(),
	workspaceTaskId: z.string().optional(),
	baseRef: z.string(),
});
export type RuntimeShellSessionStartRequest = z.infer<typeof runtimeShellSessionStartRequestSchema>;

export const runtimeShellSessionStartResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeTaskSessionSummarySchema.nullable(),
	shellBinary: z.string().nullable().optional(),
	error: z.string().optional(),
});
export type RuntimeShellSessionStartResponse = z.infer<typeof runtimeShellSessionStartResponseSchema>;

export const runtimeTerminalWsResizeMessageSchema = z.object({
	type: z.literal("resize"),
	cols: z.number().int().positive(),
	rows: z.number().int().positive(),
	pixelWidth: z.number().int().positive().optional(),
	pixelHeight: z.number().int().positive().optional(),
});
export type RuntimeTerminalWsResizeMessage = z.infer<typeof runtimeTerminalWsResizeMessageSchema>;

export const runtimeTerminalWsStopMessageSchema = z.object({
	type: z.literal("stop"),
});
export type RuntimeTerminalWsStopMessage = z.infer<typeof runtimeTerminalWsStopMessageSchema>;

export const runtimeTerminalWsOutputAckMessageSchema = z.object({
	type: z.literal("output_ack"),
	bytes: z.number().int().nonnegative(),
});
export type RuntimeTerminalWsOutputAckMessage = z.infer<typeof runtimeTerminalWsOutputAckMessageSchema>;

export const runtimeTerminalWsRestoreCompleteMessageSchema = z.object({
	type: z.literal("restore_complete"),
});
export type RuntimeTerminalWsRestoreCompleteMessage = z.infer<typeof runtimeTerminalWsRestoreCompleteMessageSchema>;

export const runtimeTerminalWsClientMessageSchema = z.discriminatedUnion("type", [
	runtimeTerminalWsResizeMessageSchema,
	runtimeTerminalWsStopMessageSchema,
	runtimeTerminalWsOutputAckMessageSchema,
	runtimeTerminalWsRestoreCompleteMessageSchema,
]);
export type RuntimeTerminalWsClientMessage = z.infer<typeof runtimeTerminalWsClientMessageSchema>;

export const runtimeTerminalWsStateMessageSchema = z.object({
	type: z.literal("state"),
	summary: runtimeTaskSessionSummarySchema,
});
export type RuntimeTerminalWsStateMessage = z.infer<typeof runtimeTerminalWsStateMessageSchema>;

export const runtimeTerminalWsErrorMessageSchema = z.object({
	type: z.literal("error"),
	message: z.string(),
});
export type RuntimeTerminalWsErrorMessage = z.infer<typeof runtimeTerminalWsErrorMessageSchema>;

export const runtimeTerminalWsExitMessageSchema = z.object({
	type: z.literal("exit"),
	code: z.number().nullable(),
});
export type RuntimeTerminalWsExitMessage = z.infer<typeof runtimeTerminalWsExitMessageSchema>;

export const runtimeTerminalWsRestoreMessageSchema = z.object({
	type: z.literal("restore"),
	snapshot: z.string(),
	cols: z.number().int().positive().nullable().optional(),
	rows: z.number().int().positive().nullable().optional(),
	stale: z.boolean().default(false),
	capturedAt: z.number().nullable().default(null),
});
export type RuntimeTerminalWsRestoreMessage = z.infer<typeof runtimeTerminalWsRestoreMessageSchema>;

export const runtimeTerminalWsServerMessageSchema = z.discriminatedUnion("type", [
	runtimeTerminalWsStateMessageSchema,
	runtimeTerminalWsErrorMessageSchema,
	runtimeTerminalWsExitMessageSchema,
	runtimeTerminalWsRestoreMessageSchema,
]);
export type RuntimeTerminalWsServerMessage = z.infer<typeof runtimeTerminalWsServerMessageSchema>;

export const runtimeGitCommitSchema = z.object({
	hash: z.string(),
	shortHash: z.string(),
	authorName: z.string(),
	authorEmail: z.string(),
	date: z.string(),
	message: z.string(),
	parentHashes: z.array(z.string()),
	relation: z.enum(["selected", "upstream", "shared"]).optional(),
});
export type RuntimeGitCommit = z.infer<typeof runtimeGitCommitSchema>;

export const runtimeGitRefSchema = z.object({
	name: z.string(),
	type: z.enum(["branch", "remote", "detached"]),
	hash: z.string(),
	isHead: z.boolean(),
	upstreamName: z.string().optional(),
	ahead: z.number().optional(),
	behind: z.number().optional(),
});
export type RuntimeGitRef = z.infer<typeof runtimeGitRefSchema>;

export const runtimeGitLogRequestSchema = z.object({
	ref: z.string().nullable().optional(),
	refs: z.array(z.string()).optional(),
	maxCount: z.number().int().positive().optional(),
	skip: z.number().int().nonnegative().optional(),
	taskScope: runtimeTaskWorkspaceInfoRequestSchema.nullable().optional(),
});
export type RuntimeGitLogRequest = z.infer<typeof runtimeGitLogRequestSchema>;

export const runtimeGitLogResponseSchema = z.object({
	ok: z.boolean(),
	commits: z.array(runtimeGitCommitSchema),
	totalCount: z.number(),
	error: z.string().optional(),
});
export type RuntimeGitLogResponse = z.infer<typeof runtimeGitLogResponseSchema>;

export const runtimeGitCommitDiffFileSchema = z.object({
	path: z.string(),
	previousPath: z.string().optional(),
	status: z.enum(["modified", "added", "deleted", "renamed"]),
	additions: z.number(),
	deletions: z.number(),
	patch: z.string(),
});
export type RuntimeGitCommitDiffFile = z.infer<typeof runtimeGitCommitDiffFileSchema>;

export const runtimeGitCommitDiffRequestSchema = z.object({
	commitHash: z.string(),
	taskScope: runtimeTaskWorkspaceInfoRequestSchema.nullable().optional(),
});
export type RuntimeGitCommitDiffRequest = z.infer<typeof runtimeGitCommitDiffRequestSchema>;

export const runtimeGitCommitDiffResponseSchema = z.object({
	ok: z.boolean(),
	commitHash: z.string(),
	files: z.array(runtimeGitCommitDiffFileSchema),
	error: z.string().optional(),
});
export type RuntimeGitCommitDiffResponse = z.infer<typeof runtimeGitCommitDiffResponseSchema>;

export const runtimeGitRefsResponseSchema = z.object({
	ok: z.boolean(),
	refs: z.array(runtimeGitRefSchema),
	error: z.string().optional(),
});
export type RuntimeGitRefsResponse = z.infer<typeof runtimeGitRefsResponseSchema>;

export const runtimeGitBlameRequestSchema = z.object({
	path: z.string(),
	taskInfo: z
		.object({
			taskId: z.string(),
			baseRef: z.string(),
		})
		.nullable()
		.optional(),
});
export type RuntimeGitBlameRequest = z.infer<typeof runtimeGitBlameRequestSchema>;

export const runtimeGitBlameLineSchema = z.object({
	lineNumber: z.number(),
	commitHash: z.string(),
	shortHash: z.string(),
	author: z.string(),
	date: z.string().nullable(),
	summary: z.string(),
});
export type RuntimeGitBlameLine = z.infer<typeof runtimeGitBlameLineSchema>;

export const runtimeGitBlameResponseSchema = z.object({
	ok: z.boolean(),
	path: z.string(),
	lines: z.array(runtimeGitBlameLineSchema),
	error: z.string().optional(),
});
export type RuntimeGitBlameResponse = z.infer<typeof runtimeGitBlameResponseSchema>;

export const runtimeGitConflictSideSchema = z.enum(["ours", "theirs", "manual"]);
export type RuntimeGitConflictSide = z.infer<typeof runtimeGitConflictSideSchema>;

export const runtimeGitConflictFileSchema = z.object({
	path: z.string(),
	base: z.string().nullable(),
	ours: z.string().nullable(),
	theirs: z.string().nullable(),
});
export type RuntimeGitConflictFile = z.infer<typeof runtimeGitConflictFileSchema>;

export const runtimeGitConflictsResponseSchema = z.object({
	ok: z.boolean(),
	conflicts: z.array(runtimeGitConflictFileSchema),
	error: z.string().optional(),
});
export type RuntimeGitConflictsResponse = z.infer<typeof runtimeGitConflictsResponseSchema>;

export const runtimeGitResolveConflictRequestSchema = z.object({
	path: z.string(),
	side: runtimeGitConflictSideSchema,
	content: z.string().optional(),
	taskInfo: z
		.object({
			taskId: z.string(),
			baseRef: z.string(),
		})
		.nullable()
		.optional(),
});
export type RuntimeGitResolveConflictRequest = z.infer<typeof runtimeGitResolveConflictRequestSchema>;

export const runtimeGitResolveConflictResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeGitSyncSummarySchema,
	output: z.string(),
	error: z.string().optional(),
});
export type RuntimeGitResolveConflictResponse = z.infer<typeof runtimeGitResolveConflictResponseSchema>;

export const runtimeGitWorktreeEntrySchema = z.object({
	path: z.string(),
	head: z.string().nullable(),
	branch: z.string().nullable(),
	isMain: z.boolean(),
	isDetached: z.boolean(),
	isBare: z.boolean(),
});
export type RuntimeGitWorktreeEntry = z.infer<typeof runtimeGitWorktreeEntrySchema>;

export const runtimeGitWorktreeInventoryResponseSchema = z.object({
	ok: z.boolean(),
	worktrees: z.array(runtimeGitWorktreeEntrySchema),
	error: z.string().optional(),
});
export type RuntimeGitWorktreeInventoryResponse = z.infer<typeof runtimeGitWorktreeInventoryResponseSchema>;

export const runtimeCleanMergedWorktreesRequestSchema = z.object({
	dryRun: z.boolean().optional(),
});
export type RuntimeCleanMergedWorktreesRequest = z.infer<typeof runtimeCleanMergedWorktreesRequestSchema>;

export const runtimeCleanMergedWorktreesSkippedEntrySchema = z.object({
	taskId: z.string(),
	branch: z.string(),
	reason: z.string(),
});
export type RuntimeCleanMergedWorktreesSkippedEntry = z.infer<typeof runtimeCleanMergedWorktreesSkippedEntrySchema>;

export const runtimeCleanMergedWorktreesResponseSchema = z.object({
	ok: z.boolean(),
	cleanedTaskIds: z.array(z.string()),
	skipped: z.array(runtimeCleanMergedWorktreesSkippedEntrySchema),
	error: z.string().optional(),
});
export type RuntimeCleanMergedWorktreesResponse = z.infer<typeof runtimeCleanMergedWorktreesResponseSchema>;

export const runtimeClaudeCacheStatusResponseSchema = z.object({
	ok: z.boolean(),
	safeItemCount: z.number(),
	safeSizeBytes: z.number(),
	transcriptItemCount: z.number(),
	transcriptSizeBytes: z.number(),
	error: z.string().optional(),
});
export type RuntimeClaudeCacheStatusResponse = z.infer<typeof runtimeClaudeCacheStatusResponseSchema>;

export const runtimeClaudeCacheCleanRequestSchema = z.object({
	days: z.number().optional(),
	includeTranscripts: z.boolean(),
	dryRun: z.boolean(),
});
export type RuntimeClaudeCacheCleanRequest = z.infer<typeof runtimeClaudeCacheCleanRequestSchema>;

export const runtimeClaudeCacheCleanedItemSchema = z.object({
	path: z.string(),
	sizeBytes: z.number(),
	tier: z.enum(["safe", "transcript"]),
});
export type RuntimeClaudeCacheCleanedItem = z.infer<typeof runtimeClaudeCacheCleanedItemSchema>;

export const runtimeClaudeCacheSkippedItemSchema = z.object({
	path: z.string(),
	reason: z.string(),
});
export type RuntimeClaudeCacheSkippedItem = z.infer<typeof runtimeClaudeCacheSkippedItemSchema>;

export const runtimeClaudeCacheCleanResponseSchema = z.object({
	ok: z.boolean(),
	cleaned: z.array(runtimeClaudeCacheCleanedItemSchema),
	skipped: z.array(runtimeClaudeCacheSkippedItemSchema),
	error: z.string().optional(),
});
export type RuntimeClaudeCacheCleanResponse = z.infer<typeof runtimeClaudeCacheCleanResponseSchema>;

export const runtimeGitPullRequestRequestSchema = z.object({
	title: z.string(),
	body: z.string(),
	base: z.string().optional(),
	taskInfo: z
		.object({
			taskId: z.string(),
			baseRef: z.string(),
		})
		.nullable()
		.optional(),
});
export type RuntimeGitPullRequestRequest = z.infer<typeof runtimeGitPullRequestRequestSchema>;

export const runtimeGitPullRequestResponseSchema = z.object({
	ok: z.boolean(),
	url: z.string().nullable(),
	output: z.string(),
	error: z.string().optional(),
});
export type RuntimeGitPullRequestResponse = z.infer<typeof runtimeGitPullRequestResponseSchema>;

export const runtimeHookEventSchema = z.enum(["to_review", "to_in_progress", "activity"]);
export type RuntimeHookEvent = z.infer<typeof runtimeHookEventSchema>;

export const runtimeHookIngestRequestSchema = z.object({
	taskId: z.string(),
	workspaceId: z.string(),
	event: runtimeHookEventSchema,
	metadata: runtimeTaskHookActivitySchema.partial().optional(),
});
export type RuntimeHookIngestRequest = z.infer<typeof runtimeHookIngestRequestSchema>;

export const runtimeHookIngestResponseSchema = z.object({
	ok: z.boolean(),
	error: z.string().optional(),
});
export type RuntimeHookIngestResponse = z.infer<typeof runtimeHookIngestResponseSchema>;
