// Defines the typed TRPC boundary between the browser and the local runtime.
// Keep request and response contracts plus workspace-scoped procedures here,
// and delegate domain behavior to runtime-api.ts and lower-level services.
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";

import {
	createUsageAuthSession,
	lookupUsageAuthCode,
} from "../manager/vercel-auth-proxy.js";
import type {
	RuntimeAgentModelInventory,
	RuntimeClineAccountBalanceResponse,
	RuntimeClineAccountOrganizationsResponse,
	RuntimeClineAccountProfileResponse,
	RuntimeClineAccountSwitchRequest,
	RuntimeClineAccountSwitchResponse,
	RuntimeClineAddProviderRequest,
	RuntimeClineAddProviderResponse,
	RuntimeClineDeviceAuthCompleteRequest,
	RuntimeClineDeviceAuthCompleteResponse,
	RuntimeClineDeviceAuthStartResponse,
	RuntimeClineKanbanAccessResponse,
	RuntimeClineMcpAuthStatusResponse,
	RuntimeClineMcpOAuthRequest,
	RuntimeClineMcpOAuthResponse,
	RuntimeClineMcpSettingsResponse,
	RuntimeClineMcpSettingsSaveRequest,
	RuntimeClineMcpSettingsSaveResponse,
	RuntimeClineOauthLoginRequest,
	RuntimeClineOauthLoginResponse,
	RuntimeClineProviderCatalogResponse,
	RuntimeClineProviderModelsRequest,
	RuntimeClineProviderModelsResponse,
	RuntimeClineProviderSettingsSaveRequest,
	RuntimeClineProviderSettingsSaveResponse,
	RuntimeClineUpdateProviderRequest,
	RuntimeClineUpdateProviderResponse,
	RuntimeCommandRunRequest,
	RuntimeCommandRunResponse,
	RuntimeConfigResponse,
	RuntimeConfigSaveRequest,
	RuntimeDebugResetAllStateResponse,
	RuntimeDirectoryListRequest,
	RuntimeDirectoryListResponse,
	RuntimeFeaturebaseTokenResponse,
	RuntimeGitBlameRequest,
	RuntimeGitBlameResponse,
	RuntimeGitCheckoutRequest,
	RuntimeGitCreateBranchRequest,
	RuntimeGitCreateBranchResponse,
	RuntimeGitDeleteBranchRequest,
	RuntimeGitDeleteBranchResponse,
	RuntimeGitMergeBranchRequest,
	RuntimeGitMergeBranchResponse,
	RuntimeGitCherryPickRequest,
	RuntimeGitCherryPickResponse,
	RuntimeGitPushBranchRequest,
	RuntimeGitPushBranchResponse,
	RuntimeGitCheckoutResponse,
	RuntimeGitCommitDiffRequest,
	RuntimeGitCommitDiffResponse,
	RuntimeGitCommitRequest,
	RuntimeGitCommitResponse,
	RuntimeGitConflictsResponse,
	RuntimeGitDiscardResponse,
	RuntimeGitLogRequest,
	RuntimeGitLogResponse,
	RuntimeGitPullRequestRequest,
	RuntimeGitPullRequestResponse,
	RuntimeGitRefsResponse,
	RuntimeGitResolveConflictRequest,
	RuntimeGitResolveConflictResponse,
	RuntimeGitRevertFileRequest,
	RuntimeGitRevertHunkRequest,
	RuntimeGitRevertResponse,
	RuntimeGitSummaryResponse,
	RuntimeGitSyncAction,
	RuntimeGitSyncResponse,
	RuntimeGitWorktreeInventoryResponse,
	RuntimeHookIngestRequest,
	RuntimeHookIngestResponse,
	RuntimeHostEnvironmentResponse,
	RuntimeListAgentModelsRequest,
	RuntimeManagerAccountAuthorizeCcRequest,
	RuntimeManagerAccountIdRequest,
	RuntimeManagerAccountLaunchCredential,
	RuntimeManagerAccountLaunchDir,
	RuntimeManagerAccountReauthRequest,
	RuntimeManagerAccountReorderRequest,
	RuntimeManagerAccountUpdateRequest,
	RuntimeManagerFeatureToggleRequest,
	RuntimeManagerHookLogs,
	RuntimeManagerInstallationsOverview,
	RuntimeManagerMutationResponse,
	RuntimeManagerOAuthFlowStatus,
	RuntimeManagerOAuthFlowStatusRequest,
	RuntimeManagerOAuthStartRequest,
	RuntimeManagerOAuthStartResponse,
	RuntimeManagerOAuthSubmitCodeRequest,
	RuntimeManagerPacks,
	RuntimeManagerPackToggleRequest,
	RuntimeManagerProvider,
	RuntimeManagerServerLogs,
	RuntimeManagerSessions,
	RuntimeManagerState,
	RuntimeManagerSwapLog,
	RuntimeManagerSwapPauseRequest,
	RuntimeManagerUsageOverview,
	RuntimeMcpInventory,
	RuntimeOpenFileRequest,
	RuntimeOpenFileResponse,
	RuntimeProjectAddRequest,
	RuntimeProjectAddResponse,
	RuntimeProjectDirectoryPickerResponse,
	RuntimeProjectRemoveRequest,
	RuntimeProjectRemoveResponse,
	RuntimeProjectsResponse,
	RuntimeRunUpdateResponse,
	RuntimeSetWorkspaceLocalAssetsRequest,
	RuntimeSetWorkspaceLocalAssetsResponse,
	RuntimeShellSessionStartRequest,
	RuntimeShellSessionStartResponse,
	RuntimeSkillInventory,
	RuntimeSkillInventoryRequest,
	RuntimeSlashCommandsResponse,
	RuntimeTaskChatAbortRequest,
	RuntimeTaskChatAbortResponse,
	RuntimeTaskChatCancelRequest,
	RuntimeTaskChatCancelResponse,
	RuntimeTaskChatMessagesRequest,
	RuntimeTaskChatMessagesResponse,
	RuntimeTaskChatReloadRequest,
	RuntimeTaskChatReloadResponse,
	RuntimeTaskChatSendRequest,
	RuntimeTaskChatSendResponse,
	RuntimeTaskSessionInputRequest,
	RuntimeTaskSessionInputResponse,
	RuntimeTaskSessionPauseRequest,
	RuntimeTaskSessionPauseResponse,
	RuntimeTaskSessionStartRequest,
	RuntimeTaskSessionStartResponse,
	RuntimeTaskSessionStopRequest,
	RuntimeTaskSessionStopResponse,
	RuntimeTaskWorkspaceInfoRequest,
	RuntimeTaskWorkspaceInfoResponse,
	RuntimeUpdateStatusResponse,
	RuntimeWorkspaceChangesRequest,
	RuntimeWorkspaceChangesResponse,
	RuntimeWorkspaceFileSearchRequest,
	RuntimeWorkspaceFileSearchResponse,
	RuntimeWorkspaceStateNotifyResponse,
	RuntimeWorkspaceStateResponse,
	RuntimeWorkspaceStateSaveRequest,
	RuntimeWorktreeDeleteRequest,
	RuntimeWorktreeDeleteResponse,
	RuntimeWorktreeEnsureRequest,
	RuntimeWorktreeEnsureResponse,
} from "../core/api-contract";
import {
	RuntimeManagerAccountAuthorizeCcRequestSchema,
	RuntimeManagerAccountIdRequestSchema,
	RuntimeManagerAccountLaunchCredentialSchema,
	RuntimeManagerAccountLaunchDirSchema,
	RuntimeManagerAccountReauthRequestSchema,
	RuntimeManagerAccountReorderRequestSchema,
	RuntimeManagerAccountUpdateRequestSchema,
	RuntimeManagerFeatureToggleRequestSchema,
	RuntimeManagerHookLogsSchema,
	RuntimeManagerInstallationsOverviewSchema,
	RuntimeManagerMutationResponseSchema,
	RuntimeManagerOAuthFlowStatusRequestSchema,
	RuntimeManagerOAuthFlowStatusSchema,
	RuntimeManagerOAuthStartRequestSchema,
	RuntimeManagerOAuthStartResponseSchema,
	RuntimeManagerOAuthSubmitCodeRequestSchema,
	RuntimeManagerUsageAuthCodeRequestSchema,
	RuntimeManagerUsageAuthCodeResponseSchema,
	RuntimeManagerUsageAuthSessionCreateRequestSchema,
	RuntimeManagerUsageAuthSessionCreateResponseSchema,
	RuntimeManagerPacksSchema,
	RuntimeManagerPackToggleRequestSchema,
	RuntimeManagerProviderSchema,
	RuntimeManagerServerLogsSchema,
	RuntimeManagerSessionsSchema,
	RuntimeManagerStateSchema,
	RuntimeManagerSwapLogSchema,
	RuntimeManagerSwapPauseRequestSchema,
	RuntimeManagerUsageOverviewSchema,
	runtimeAgentModelInventorySchema,
	runtimeClineAccountBalanceResponseSchema,
	runtimeClineAccountOrganizationsResponseSchema,
	runtimeClineAccountProfileResponseSchema,
	runtimeClineAccountSwitchRequestSchema,
	runtimeClineAccountSwitchResponseSchema,
	runtimeClineAddProviderRequestSchema,
	runtimeClineAddProviderResponseSchema,
	runtimeClineDeviceAuthCompleteRequestSchema,
	runtimeClineDeviceAuthCompleteResponseSchema,
	runtimeClineDeviceAuthStartResponseSchema,
	runtimeClineKanbanAccessResponseSchema,
	runtimeClineMcpAuthStatusResponseSchema,
	runtimeClineMcpOAuthRequestSchema,
	runtimeClineMcpOAuthResponseSchema,
	runtimeClineMcpSettingsResponseSchema,
	runtimeClineMcpSettingsSaveRequestSchema,
	runtimeClineMcpSettingsSaveResponseSchema,
	runtimeClineOauthLoginRequestSchema,
	runtimeClineOauthLoginResponseSchema,
	runtimeClineProviderCatalogResponseSchema,
	runtimeClineProviderModelsRequestSchema,
	runtimeClineProviderModelsResponseSchema,
	runtimeClineProviderSettingsSaveRequestSchema,
	runtimeClineProviderSettingsSaveResponseSchema,
	runtimeClineUpdateProviderRequestSchema,
	runtimeClineUpdateProviderResponseSchema,
	runtimeCommandRunRequestSchema,
	runtimeCommandRunResponseSchema,
	runtimeConfigResponseSchema,
	runtimeConfigSaveRequestSchema,
	runtimeDebugResetAllStateResponseSchema,
	runtimeDirectoryListRequestSchema,
	runtimeDirectoryListResponseSchema,
	runtimeFeaturebaseTokenResponseSchema,
	runtimeGitBlameRequestSchema,
	runtimeGitBlameResponseSchema,
	runtimeGitCheckoutRequestSchema,
	runtimeGitCheckoutResponseSchema,
	runtimeGitCreateBranchRequestSchema,
	runtimeGitCreateBranchResponseSchema,
	runtimeGitDeleteBranchRequestSchema,
	runtimeGitDeleteBranchResponseSchema,
	runtimeGitMergeBranchRequestSchema,
	runtimeGitMergeBranchResponseSchema,
	runtimeGitCherryPickRequestSchema,
	runtimeGitCherryPickResponseSchema,
	runtimeGitPushBranchRequestSchema,
	runtimeGitPushBranchResponseSchema,
	runtimeGitCommitDiffRequestSchema,
	runtimeGitCommitDiffResponseSchema,
	runtimeGitCommitRequestSchema,
	runtimeGitCommitResponseSchema,
	runtimeGitConflictsResponseSchema,
	runtimeGitDiscardResponseSchema,
	runtimeGitLogRequestSchema,
	runtimeGitLogResponseSchema,
	runtimeGitPullRequestRequestSchema,
	runtimeGitPullRequestResponseSchema,
	runtimeGitRefsResponseSchema,
	runtimeGitResolveConflictRequestSchema,
	runtimeGitResolveConflictResponseSchema,
	runtimeGitRevertFileRequestSchema,
	runtimeGitRevertHunkRequestSchema,
	runtimeGitRevertResponseSchema,
	runtimeGitSummaryResponseSchema,
	runtimeGitSyncActionSchema,
	runtimeGitSyncResponseSchema,
	runtimeGitWorktreeInventoryResponseSchema,
	runtimeHookIngestRequestSchema,
	runtimeHookIngestResponseSchema,
	runtimeHostEnvironmentResponseSchema,
	runtimeListAgentModelsRequestSchema,
	runtimeMcpInventorySchema,
	runtimeOpenFileRequestSchema,
	runtimeOpenFileResponseSchema,
	runtimeProjectAddRequestSchema,
	runtimeProjectAddResponseSchema,
	runtimeProjectDirectoryPickerResponseSchema,
	runtimeProjectRemoveRequestSchema,
	runtimeProjectRemoveResponseSchema,
	runtimeProjectsResponseSchema,
	runtimeRunUpdateResponseSchema,
	runtimeSetWorkspaceLocalAssetsRequestSchema,
	runtimeSetWorkspaceLocalAssetsResponseSchema,
	runtimeShellSessionStartRequestSchema,
	runtimeShellSessionStartResponseSchema,
	runtimeSkillInventoryRequestSchema,
	runtimeSkillInventorySchema,
	runtimeSlashCommandsResponseSchema,
	runtimeTaskChatAbortRequestSchema,
	runtimeTaskChatAbortResponseSchema,
	runtimeTaskChatCancelRequestSchema,
	runtimeTaskChatCancelResponseSchema,
	runtimeTaskChatMessagesRequestSchema,
	runtimeTaskChatMessagesResponseSchema,
	runtimeTaskChatReloadRequestSchema,
	runtimeTaskChatReloadResponseSchema,
	runtimeTaskChatSendRequestSchema,
	runtimeTaskChatSendResponseSchema,
	runtimeTaskSessionInputRequestSchema,
	runtimeTaskSessionInputResponseSchema,
	runtimeTaskSessionPauseRequestSchema,
	runtimeTaskSessionPauseResponseSchema,
	runtimeTaskSessionStartRequestSchema,
	runtimeTaskSessionStartResponseSchema,
	runtimeTaskSessionStopRequestSchema,
	runtimeTaskSessionStopResponseSchema,
	runtimeTaskWorkspaceInfoRequestSchema,
	runtimeTaskWorkspaceInfoResponseSchema,
	runtimeUpdateStatusResponseSchema,
	runtimeWorkspaceChangesRequestSchema,
	runtimeWorkspaceChangesResponseSchema,
	runtimeWorkspaceFileSearchRequestSchema,
	runtimeWorkspaceFileSearchResponseSchema,
	runtimeWorkspaceStateNotifyResponseSchema,
	runtimeWorkspaceStateResponseSchema,
	runtimeWorkspaceStateSaveRequestSchema,
	runtimeWorktreeDeleteRequestSchema,
	runtimeWorktreeDeleteResponseSchema,
	runtimeWorktreeEnsureRequestSchema,
	runtimeWorktreeEnsureResponseSchema,
} from "../core/api-contract";

export interface RuntimeTrpcWorkspaceScope {
	workspaceId: string;
	workspacePath: string;
}

export interface RuntimeTrpcContext {
	requestedWorkspaceId: string | null;
	workspaceScope: RuntimeTrpcWorkspaceScope | null;
	runtimeApi: {
		loadConfig: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeConfigResponse>;
		saveConfig: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeConfigSaveRequest,
		) => Promise<RuntimeConfigResponse>;
		saveClineProviderSettings: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeClineProviderSettingsSaveRequest,
		) => Promise<RuntimeClineProviderSettingsSaveResponse>;
		addClineProvider: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeClineAddProviderRequest,
		) => Promise<RuntimeClineAddProviderResponse>;
		updateClineProvider: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeClineUpdateProviderRequest,
		) => Promise<RuntimeClineUpdateProviderResponse>;
		startTaskSession: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskSessionStartRequest,
		) => Promise<RuntimeTaskSessionStartResponse>;
		stopTaskSession: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskSessionStopRequest,
		) => Promise<RuntimeTaskSessionStopResponse>;
		pauseTaskSession: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskSessionPauseRequest,
		) => Promise<RuntimeTaskSessionPauseResponse>;
		resumeTaskSession: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskSessionPauseRequest,
		) => Promise<RuntimeTaskSessionPauseResponse>;
		sendTaskSessionInput: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskSessionInputRequest,
		) => Promise<RuntimeTaskSessionInputResponse>;
		getTaskChatMessages: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskChatMessagesRequest,
		) => Promise<RuntimeTaskChatMessagesResponse>;
		getClineSlashCommands: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeSlashCommandsResponse>;
		listSkillInventory: (input: RuntimeSkillInventoryRequest) => Promise<RuntimeSkillInventory>;
		setWorkspaceLocalAssets: (
			input: RuntimeSetWorkspaceLocalAssetsRequest,
		) => Promise<RuntimeSetWorkspaceLocalAssetsResponse>;
		listMcpInventory: () => Promise<RuntimeMcpInventory>;
		listAgentModels: (input: RuntimeListAgentModelsRequest) => Promise<RuntimeAgentModelInventory>;
		sendTaskChatMessage: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskChatSendRequest,
		) => Promise<RuntimeTaskChatSendResponse>;
		reloadTaskChatSession: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskChatReloadRequest,
		) => Promise<RuntimeTaskChatReloadResponse>;
		abortTaskChatTurn: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskChatAbortRequest,
		) => Promise<RuntimeTaskChatAbortResponse>;
		cancelTaskChatTurn: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskChatCancelRequest,
		) => Promise<RuntimeTaskChatCancelResponse>;
		getClineProviderCatalog: (
			scope: RuntimeTrpcWorkspaceScope | null,
		) => Promise<RuntimeClineProviderCatalogResponse>;
		getClineAccountProfile: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeClineAccountProfileResponse>;
		getClineKanbanAccess: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeClineKanbanAccessResponse>;
		getFeaturebaseToken: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeFeaturebaseTokenResponse>;
		getClineAccountBalance: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeClineAccountBalanceResponse>;
		getClineAccountOrganizations: (
			scope: RuntimeTrpcWorkspaceScope | null,
		) => Promise<RuntimeClineAccountOrganizationsResponse>;
		switchClineAccount: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeClineAccountSwitchRequest,
		) => Promise<RuntimeClineAccountSwitchResponse>;
		getClineProviderModels: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeClineProviderModelsRequest,
		) => Promise<RuntimeClineProviderModelsResponse>;
		runClineProviderOAuthLogin: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeClineOauthLoginRequest,
		) => Promise<RuntimeClineOauthLoginResponse>;
		startClineDeviceAuth: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeClineDeviceAuthStartResponse>;
		completeClineDeviceAuth: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeClineDeviceAuthCompleteRequest,
		) => Promise<RuntimeClineDeviceAuthCompleteResponse>;
		getClineMcpAuthStatuses: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeClineMcpAuthStatusResponse>;
		runClineMcpServerOAuth: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeClineMcpOAuthRequest,
		) => Promise<RuntimeClineMcpOAuthResponse>;
		getClineMcpSettings: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeClineMcpSettingsResponse>;
		saveClineMcpSettings: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeClineMcpSettingsSaveRequest,
		) => Promise<RuntimeClineMcpSettingsSaveResponse>;
		startShellSession: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeShellSessionStartRequest,
		) => Promise<RuntimeShellSessionStartResponse>;
		runCommand: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeCommandRunRequest,
		) => Promise<RuntimeCommandRunResponse>;
		resetAllState: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeDebugResetAllStateResponse>;
		openFile: (input: RuntimeOpenFileRequest) => Promise<RuntimeOpenFileResponse>;
		getUpdateStatus: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeUpdateStatusResponse>;
		getHostEnvironment: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeHostEnvironmentResponse>;
		runUpdateNow: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeRunUpdateResponse>;
	};
	workspaceApi: {
		loadGitSummary: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskWorkspaceInfoRequest | null,
		) => Promise<RuntimeGitSummaryResponse>;
		runGitSyncAction: (
			scope: RuntimeTrpcWorkspaceScope,
			input: { action: RuntimeGitSyncAction },
		) => Promise<RuntimeGitSyncResponse>;
		checkoutGitBranch: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeGitCheckoutRequest,
		) => Promise<RuntimeGitCheckoutResponse>;
		deleteGitBranch: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeGitDeleteBranchRequest,
		) => Promise<RuntimeGitDeleteBranchResponse>;
		createGitBranch: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeGitCreateBranchRequest,
		) => Promise<RuntimeGitCreateBranchResponse>;
		mergeTaskBranch: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeGitMergeBranchRequest,
		) => Promise<RuntimeGitMergeBranchResponse>;
		cherryPickCommit: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeGitCherryPickRequest,
		) => Promise<RuntimeGitCherryPickResponse>;
		pushGitBranch: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeGitPushBranchRequest,
		) => Promise<RuntimeGitPushBranchResponse>;
		discardGitChanges: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskWorkspaceInfoRequest | null,
		) => Promise<RuntimeGitDiscardResponse>;
		revertGitFile: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeGitRevertFileRequest,
		) => Promise<RuntimeGitRevertResponse>;
		revertGitHunk: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeGitRevertHunkRequest,
		) => Promise<RuntimeGitRevertResponse>;
		commitWorkspaceChanges: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeGitCommitRequest,
		) => Promise<RuntimeGitCommitResponse>;
		listWorktrees: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeGitWorktreeInventoryResponse>;
		getBlame: (scope: RuntimeTrpcWorkspaceScope, input: RuntimeGitBlameRequest) => Promise<RuntimeGitBlameResponse>;
		getMergeConflicts: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskWorkspaceInfoRequest | null,
		) => Promise<RuntimeGitConflictsResponse>;
		resolveMergeConflict: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeGitResolveConflictRequest,
		) => Promise<RuntimeGitResolveConflictResponse>;
		createPullRequest: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeGitPullRequestRequest,
		) => Promise<RuntimeGitPullRequestResponse>;
		loadChanges: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeWorkspaceChangesRequest,
		) => Promise<RuntimeWorkspaceChangesResponse>;
		ensureWorktree: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeWorktreeEnsureRequest,
		) => Promise<RuntimeWorktreeEnsureResponse>;
		deleteWorktree: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeWorktreeDeleteRequest,
		) => Promise<RuntimeWorktreeDeleteResponse>;
		loadTaskContext: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskWorkspaceInfoRequest,
		) => Promise<RuntimeTaskWorkspaceInfoResponse>;
		searchFiles: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeWorkspaceFileSearchRequest,
		) => Promise<RuntimeWorkspaceFileSearchResponse>;
		loadState: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeWorkspaceStateResponse>;
		notifyStateUpdated: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeWorkspaceStateNotifyResponse>;
		saveState: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeWorkspaceStateSaveRequest,
		) => Promise<RuntimeWorkspaceStateResponse>;
		loadWorkspaceChanges: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeWorkspaceChangesResponse>;
		loadGitLog: (scope: RuntimeTrpcWorkspaceScope, input: RuntimeGitLogRequest) => Promise<RuntimeGitLogResponse>;
		loadGitRefs: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskWorkspaceInfoRequest | null,
		) => Promise<RuntimeGitRefsResponse>;
		loadCommitDiff: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeGitCommitDiffRequest,
		) => Promise<RuntimeGitCommitDiffResponse>;
	};
	projectsApi: {
		listProjects: (preferredWorkspaceId: string | null) => Promise<RuntimeProjectsResponse>;
		addProject: (
			preferredWorkspaceId: string | null,
			input: RuntimeProjectAddRequest,
		) => Promise<RuntimeProjectAddResponse>;
		removeProject: (
			preferredWorkspaceId: string | null,
			input: RuntimeProjectRemoveRequest,
		) => Promise<RuntimeProjectRemoveResponse>;
		pickProjectDirectory: (preferredWorkspaceId: string | null) => Promise<RuntimeProjectDirectoryPickerResponse>;
		listDirectoryContents: (
			preferredWorkspaceId: string | null,
			input: RuntimeDirectoryListRequest,
		) => Promise<RuntimeDirectoryListResponse>;
	};
	hooksApi: {
		ingest: (input: RuntimeHookIngestRequest) => Promise<RuntimeHookIngestResponse>;
	};
	managerApi: {
		getState: () => Promise<RuntimeManagerState>;
		setFeatureEnabled: (input: RuntimeManagerFeatureToggleRequest) => Promise<RuntimeManagerMutationResponse>;
		pauseSwap: (input: RuntimeManagerSwapPauseRequest) => Promise<RuntimeManagerMutationResponse>;
		resumeSwap: () => Promise<RuntimeManagerMutationResponse>;
		useAccount: (input: RuntimeManagerAccountIdRequest) => Promise<RuntimeManagerMutationResponse>;
		refreshAccount: (input: RuntimeManagerAccountIdRequest) => Promise<RuntimeManagerMutationResponse>;
		refreshAllUsage: () => Promise<RuntimeManagerMutationResponse>;
		reconcileActive: () => Promise<RuntimeManagerMutationResponse>;
		updateAccount: (input: RuntimeManagerAccountUpdateRequest) => Promise<RuntimeManagerMutationResponse>;
		deleteAccount: (input: RuntimeManagerAccountIdRequest) => Promise<RuntimeManagerMutationResponse>;
		validateAccount: (input: RuntimeManagerAccountIdRequest) => Promise<RuntimeManagerMutationResponse>;
		reorderAccounts: (input: RuntimeManagerAccountReorderRequest) => Promise<RuntimeManagerMutationResponse>;
		startAccountReauth: (input: RuntimeManagerAccountReauthRequest) => Promise<RuntimeManagerOAuthStartResponse>;
		startAccountAuthorizeCc: (
			input: RuntimeManagerAccountAuthorizeCcRequest,
		) => Promise<RuntimeManagerOAuthStartResponse>;
		getActiveSessions: () => Promise<RuntimeManagerSessions | null>;
		getPacks: () => Promise<RuntimeManagerPacks | null>;
		setPackEnabled: (input: RuntimeManagerPackToggleRequest) => Promise<RuntimeManagerMutationResponse>;
		getAccountLaunchDir: (input: RuntimeManagerAccountIdRequest) => Promise<RuntimeManagerAccountLaunchDir | null>;
		getAccountLaunchCredential: (
			input: RuntimeManagerAccountIdRequest,
		) => Promise<RuntimeManagerAccountLaunchCredential | null>;
		importCursorAccount: () => Promise<{ ok: boolean; error?: string; accountId?: number; email?: string }>;
		importClaudeAccount: () => Promise<{ ok: boolean; error?: string; accountId?: number; email?: string }>;
		reimportCursorAccount: (
			input: RuntimeManagerAccountIdRequest,
		) => Promise<{ ok: boolean; error?: string; accountId?: number; email?: string }>;
		getAccountProvider: (accountId: number) => Promise<RuntimeManagerProvider | null>;
		getInstallationsOverview: () => Promise<RuntimeManagerInstallationsOverview | null>;
		getServerLogs: (limit?: number) => Promise<RuntimeManagerServerLogs | null>;
		getHookLogs: (limit?: number) => Promise<RuntimeManagerHookLogs | null>;
		getUsageOverview: (days?: number) => Promise<RuntimeManagerUsageOverview | null>;
		getSwapLog: (limit?: number) => Promise<RuntimeManagerSwapLog | null>;
		startClaudeOAuth: (input?: RuntimeManagerOAuthStartRequest) => Promise<RuntimeManagerOAuthStartResponse>;
		getOAuthFlowStatus: (
			input: RuntimeManagerOAuthFlowStatusRequest,
		) => Promise<RuntimeManagerOAuthFlowStatus | null>;
		submitOAuthCode: (input: RuntimeManagerOAuthSubmitCodeRequest) => Promise<RuntimeManagerOAuthFlowStatus | null>;
	};
}

interface RuntimeTrpcContextWithWorkspaceScope extends RuntimeTrpcContext {
	workspaceScope: RuntimeTrpcWorkspaceScope;
}

function readConflictRevision(cause: unknown): number | null {
	if (!cause || typeof cause !== "object" || !("currentRevision" in cause)) {
		return null;
	}
	const revision = (cause as { currentRevision?: unknown }).currentRevision;
	if (typeof revision !== "number") {
		return null;
	}
	return Number.isFinite(revision) ? revision : null;
}

const t = initTRPC.context<RuntimeTrpcContext>().create({
	errorFormatter({ shape, error }) {
		const conflictRevision = error.code === "CONFLICT" ? readConflictRevision(error.cause) : null;
		return {
			...shape,
			data: {
				...shape.data,
				conflictRevision,
			},
		};
	},
});

const workspaceProcedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.requestedWorkspaceId) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Missing workspace scope. Include x-kanban-workspace-id header or workspaceId query parameter.",
		});
	}
	if (!ctx.workspaceScope) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `Unknown workspace ID: ${ctx.requestedWorkspaceId}`,
		});
	}
	return next({
		ctx: {
			...ctx,
			workspaceScope: ctx.workspaceScope,
		} satisfies RuntimeTrpcContextWithWorkspaceScope,
	});
});

const optionalTaskWorkspaceInfoRequestSchema = runtimeTaskWorkspaceInfoRequestSchema.nullable().optional();
const gitSyncActionInputSchema = z.object({
	action: runtimeGitSyncActionSchema,
});

export const runtimeAppRouter = t.router({
	runtime: t.router({
		getConfig: t.procedure.output(runtimeConfigResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.loadConfig(ctx.workspaceScope);
		}),
		saveConfig: t.procedure
			.input(runtimeConfigSaveRequestSchema)
			.output(runtimeConfigResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.saveConfig(ctx.workspaceScope, input);
			}),
		saveClineProviderSettings: t.procedure
			.input(runtimeClineProviderSettingsSaveRequestSchema)
			.output(runtimeClineProviderSettingsSaveResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.saveClineProviderSettings(ctx.workspaceScope, input);
			}),
		addClineProvider: t.procedure
			.input(runtimeClineAddProviderRequestSchema)
			.output(runtimeClineAddProviderResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.addClineProvider(ctx.workspaceScope, input);
			}),
		updateClineProvider: t.procedure
			.input(runtimeClineUpdateProviderRequestSchema)
			.output(runtimeClineUpdateProviderResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.updateClineProvider(ctx.workspaceScope, input);
			}),
		startTaskSession: workspaceProcedure
			.input(runtimeTaskSessionStartRequestSchema)
			.output(runtimeTaskSessionStartResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.startTaskSession(ctx.workspaceScope, input);
			}),
		stopTaskSession: workspaceProcedure
			.input(runtimeTaskSessionStopRequestSchema)
			.output(runtimeTaskSessionStopResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.stopTaskSession(ctx.workspaceScope, input);
			}),
		pauseTaskSession: workspaceProcedure
			.input(runtimeTaskSessionPauseRequestSchema)
			.output(runtimeTaskSessionPauseResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.pauseTaskSession(ctx.workspaceScope, input);
			}),
		resumeTaskSession: workspaceProcedure
			.input(runtimeTaskSessionPauseRequestSchema)
			.output(runtimeTaskSessionPauseResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.resumeTaskSession(ctx.workspaceScope, input);
			}),
		sendTaskSessionInput: workspaceProcedure
			.input(runtimeTaskSessionInputRequestSchema)
			.output(runtimeTaskSessionInputResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.sendTaskSessionInput(ctx.workspaceScope, input);
			}),
		getTaskChatMessages: workspaceProcedure
			.input(runtimeTaskChatMessagesRequestSchema)
			.output(runtimeTaskChatMessagesResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.runtimeApi.getTaskChatMessages(ctx.workspaceScope, input);
			}),
		getClineSlashCommands: t.procedure.output(runtimeSlashCommandsResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getClineSlashCommands(ctx.workspaceScope);
		}),
		listSkillInventory: t.procedure
			.input(runtimeSkillInventoryRequestSchema)
			.output(runtimeSkillInventorySchema)
			.query(async ({ ctx, input }) => {
				const [inventory, managerState] = await Promise.all([
					ctx.runtimeApi.listSkillInventory(input),
					ctx.managerApi.getState().catch(() => null),
				]);
				if (!managerState?.features?.length) return inventory;
				const disabled = new Set(
					managerState.features.filter((f) => !f.installed).map((f) => `${f.category}:${f.name}`),
				);
				return {
					...inventory,
					skills: inventory.skills.filter((s) => !disabled.has(`knowledge:skill_${s.id}`)),
					agents: inventory.agents.filter((a) => !disabled.has(`agents:${a.id}`)),
					commands: inventory.commands.filter((c) => !disabled.has(`commands:${c.id}`)),
					workflows: inventory.workflows,
				};
			}),
		setWorkspaceLocalAssets: t.procedure
			.input(runtimeSetWorkspaceLocalAssetsRequestSchema)
			.output(runtimeSetWorkspaceLocalAssetsResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.setWorkspaceLocalAssets(input);
			}),
		listMcpInventory: t.procedure.output(runtimeMcpInventorySchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.listMcpInventory();
		}),
		listAgentModels: t.procedure
			.input(runtimeListAgentModelsRequestSchema)
			.output(runtimeAgentModelInventorySchema)
			.query(async ({ ctx, input }) => {
				return await ctx.runtimeApi.listAgentModels(input);
			}),
		reloadTaskChatSession: workspaceProcedure
			.input(runtimeTaskChatReloadRequestSchema)
			.output(runtimeTaskChatReloadResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.reloadTaskChatSession(ctx.workspaceScope, input);
			}),
		sendTaskChatMessage: workspaceProcedure
			.input(runtimeTaskChatSendRequestSchema)
			.output(runtimeTaskChatSendResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.sendTaskChatMessage(ctx.workspaceScope, input);
			}),
		abortTaskChatTurn: workspaceProcedure
			.input(runtimeTaskChatAbortRequestSchema)
			.output(runtimeTaskChatAbortResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.abortTaskChatTurn(ctx.workspaceScope, input);
			}),
		cancelTaskChatTurn: workspaceProcedure
			.input(runtimeTaskChatCancelRequestSchema)
			.output(runtimeTaskChatCancelResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.cancelTaskChatTurn(ctx.workspaceScope, input);
			}),
		getClineProviderCatalog: t.procedure.output(runtimeClineProviderCatalogResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getClineProviderCatalog(ctx.workspaceScope);
		}),
		getClineAccountProfile: t.procedure.output(runtimeClineAccountProfileResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getClineAccountProfile(ctx.workspaceScope);
		}),
		getClineKanbanAccess: t.procedure.output(runtimeClineKanbanAccessResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getClineKanbanAccess(ctx.workspaceScope);
		}),
		getFeaturebaseToken: t.procedure.output(runtimeFeaturebaseTokenResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getFeaturebaseToken(ctx.workspaceScope);
		}),
		getClineAccountBalance: t.procedure.output(runtimeClineAccountBalanceResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getClineAccountBalance(ctx.workspaceScope);
		}),
		getClineAccountOrganizations: t.procedure
			.output(runtimeClineAccountOrganizationsResponseSchema)
			.query(async ({ ctx }) => {
				return await ctx.runtimeApi.getClineAccountOrganizations(ctx.workspaceScope);
			}),
		switchClineAccount: t.procedure
			.input(runtimeClineAccountSwitchRequestSchema)
			.output(runtimeClineAccountSwitchResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.switchClineAccount(ctx.workspaceScope, input);
			}),
		getClineProviderModels: t.procedure
			.input(runtimeClineProviderModelsRequestSchema)
			.output(runtimeClineProviderModelsResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.runtimeApi.getClineProviderModels(ctx.workspaceScope, input);
			}),
		getClineMcpAuthStatuses: t.procedure.output(runtimeClineMcpAuthStatusResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getClineMcpAuthStatuses(ctx.workspaceScope);
		}),
		runClineMcpServerOAuth: t.procedure
			.input(runtimeClineMcpOAuthRequestSchema)
			.output(runtimeClineMcpOAuthResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.runClineMcpServerOAuth(ctx.workspaceScope, input);
			}),
		getClineMcpSettings: t.procedure.output(runtimeClineMcpSettingsResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getClineMcpSettings(ctx.workspaceScope);
		}),
		saveClineMcpSettings: t.procedure
			.input(runtimeClineMcpSettingsSaveRequestSchema)
			.output(runtimeClineMcpSettingsSaveResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.saveClineMcpSettings(ctx.workspaceScope, input);
			}),
		runClineProviderOAuthLogin: t.procedure
			.input(runtimeClineOauthLoginRequestSchema)
			.output(runtimeClineOauthLoginResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.runClineProviderOAuthLogin(ctx.workspaceScope, input);
			}),
		startClineDeviceAuth: t.procedure.output(runtimeClineDeviceAuthStartResponseSchema).mutation(async ({ ctx }) => {
			return await ctx.runtimeApi.startClineDeviceAuth(ctx.workspaceScope);
		}),
		completeClineDeviceAuth: t.procedure
			.input(runtimeClineDeviceAuthCompleteRequestSchema)
			.output(runtimeClineDeviceAuthCompleteResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.completeClineDeviceAuth(ctx.workspaceScope, input);
			}),
		startShellSession: workspaceProcedure
			.input(runtimeShellSessionStartRequestSchema)
			.output(runtimeShellSessionStartResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.startShellSession(ctx.workspaceScope, input);
			}),
		runCommand: workspaceProcedure
			.input(runtimeCommandRunRequestSchema)
			.output(runtimeCommandRunResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.runCommand(ctx.workspaceScope, input);
			}),
		resetAllState: t.procedure.output(runtimeDebugResetAllStateResponseSchema).mutation(async ({ ctx }) => {
			return await ctx.runtimeApi.resetAllState(ctx.workspaceScope);
		}),
		openFile: t.procedure
			.input(runtimeOpenFileRequestSchema)
			.output(runtimeOpenFileResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.openFile(input);
			}),
		getUpdateStatus: t.procedure.output(runtimeUpdateStatusResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getUpdateStatus(ctx.workspaceScope);
		}),
		getHostEnvironment: t.procedure.output(runtimeHostEnvironmentResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getHostEnvironment(ctx.workspaceScope);
		}),
		runUpdateNow: t.procedure.output(runtimeRunUpdateResponseSchema).mutation(async ({ ctx }) => {
			return await ctx.runtimeApi.runUpdateNow(ctx.workspaceScope);
		}),
	}),
	workspace: t.router({
		getGitSummary: workspaceProcedure
			.input(optionalTaskWorkspaceInfoRequestSchema)
			.output(runtimeGitSummaryResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadGitSummary(ctx.workspaceScope, input ?? null);
			}),
		runGitSyncAction: workspaceProcedure
			.input(gitSyncActionInputSchema)
			.output(runtimeGitSyncResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.runGitSyncAction(ctx.workspaceScope, input);
			}),
		checkoutGitBranch: workspaceProcedure
			.input(runtimeGitCheckoutRequestSchema)
			.output(runtimeGitCheckoutResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.checkoutGitBranch(ctx.workspaceScope, input);
			}),
		deleteGitBranch: workspaceProcedure
			.input(runtimeGitDeleteBranchRequestSchema)
			.output(runtimeGitDeleteBranchResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.deleteGitBranch(ctx.workspaceScope, input);
			}),
		createGitBranch: workspaceProcedure
			.input(runtimeGitCreateBranchRequestSchema)
			.output(runtimeGitCreateBranchResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.createGitBranch(ctx.workspaceScope, input);
			}),
		mergeTaskBranch: workspaceProcedure
			.input(runtimeGitMergeBranchRequestSchema)
			.output(runtimeGitMergeBranchResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.mergeTaskBranch(ctx.workspaceScope, input);
			}),
		cherryPickCommit: workspaceProcedure
			.input(runtimeGitCherryPickRequestSchema)
			.output(runtimeGitCherryPickResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.cherryPickCommit(ctx.workspaceScope, input);
			}),
		pushGitBranch: workspaceProcedure
			.input(runtimeGitPushBranchRequestSchema)
			.output(runtimeGitPushBranchResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.pushGitBranch(ctx.workspaceScope, input);
			}),
		discardGitChanges: workspaceProcedure
			.input(optionalTaskWorkspaceInfoRequestSchema)
			.output(runtimeGitDiscardResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.discardGitChanges(ctx.workspaceScope, input ?? null);
			}),
		revertGitFile: workspaceProcedure
			.input(runtimeGitRevertFileRequestSchema)
			.output(runtimeGitRevertResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.revertGitFile(ctx.workspaceScope, input);
			}),
		revertGitHunk: workspaceProcedure
			.input(runtimeGitRevertHunkRequestSchema)
			.output(runtimeGitRevertResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.revertGitHunk(ctx.workspaceScope, input);
			}),
		commitWorkspaceChanges: workspaceProcedure
			.input(runtimeGitCommitRequestSchema)
			.output(runtimeGitCommitResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.commitWorkspaceChanges(ctx.workspaceScope, input);
			}),
		listWorktrees: workspaceProcedure.output(runtimeGitWorktreeInventoryResponseSchema).query(async ({ ctx }) => {
			return await ctx.workspaceApi.listWorktrees(ctx.workspaceScope);
		}),
		getBlame: workspaceProcedure
			.input(runtimeGitBlameRequestSchema)
			.output(runtimeGitBlameResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.getBlame(ctx.workspaceScope, input);
			}),
		getMergeConflicts: workspaceProcedure
			.input(optionalTaskWorkspaceInfoRequestSchema)
			.output(runtimeGitConflictsResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.getMergeConflicts(ctx.workspaceScope, input ?? null);
			}),
		resolveMergeConflict: workspaceProcedure
			.input(runtimeGitResolveConflictRequestSchema)
			.output(runtimeGitResolveConflictResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.resolveMergeConflict(ctx.workspaceScope, input);
			}),
		createPullRequest: workspaceProcedure
			.input(runtimeGitPullRequestRequestSchema)
			.output(runtimeGitPullRequestResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.createPullRequest(ctx.workspaceScope, input);
			}),
		getChanges: workspaceProcedure
			.input(runtimeWorkspaceChangesRequestSchema)
			.output(runtimeWorkspaceChangesResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadChanges(ctx.workspaceScope, input);
			}),
		ensureWorktree: workspaceProcedure
			.input(runtimeWorktreeEnsureRequestSchema)
			.output(runtimeWorktreeEnsureResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.ensureWorktree(ctx.workspaceScope, input);
			}),
		deleteWorktree: workspaceProcedure
			.input(runtimeWorktreeDeleteRequestSchema)
			.output(runtimeWorktreeDeleteResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.deleteWorktree(ctx.workspaceScope, input);
			}),
		getTaskContext: workspaceProcedure
			.input(runtimeTaskWorkspaceInfoRequestSchema)
			.output(runtimeTaskWorkspaceInfoResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadTaskContext(ctx.workspaceScope, input);
			}),
		searchFiles: workspaceProcedure
			.input(runtimeWorkspaceFileSearchRequestSchema)
			.output(runtimeWorkspaceFileSearchResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.searchFiles(ctx.workspaceScope, input);
			}),
		getState: workspaceProcedure.output(runtimeWorkspaceStateResponseSchema).query(async ({ ctx }) => {
			return await ctx.workspaceApi.loadState(ctx.workspaceScope);
		}),
		notifyStateUpdated: workspaceProcedure
			.output(runtimeWorkspaceStateNotifyResponseSchema)
			.mutation(async ({ ctx }) => {
				return await ctx.workspaceApi.notifyStateUpdated(ctx.workspaceScope);
			}),
		saveState: workspaceProcedure
			.input(runtimeWorkspaceStateSaveRequestSchema)
			.output(runtimeWorkspaceStateResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.saveState(ctx.workspaceScope, input);
			}),
		getWorkspaceChanges: workspaceProcedure.output(runtimeWorkspaceChangesResponseSchema).query(async ({ ctx }) => {
			return await ctx.workspaceApi.loadWorkspaceChanges(ctx.workspaceScope);
		}),
		getGitLog: workspaceProcedure
			.input(runtimeGitLogRequestSchema)
			.output(runtimeGitLogResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadGitLog(ctx.workspaceScope, input);
			}),
		getGitRefs: workspaceProcedure
			.input(optionalTaskWorkspaceInfoRequestSchema)
			.output(runtimeGitRefsResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadGitRefs(ctx.workspaceScope, input ?? null);
			}),
		getCommitDiff: workspaceProcedure
			.input(runtimeGitCommitDiffRequestSchema)
			.output(runtimeGitCommitDiffResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadCommitDiff(ctx.workspaceScope, input);
			}),
	}),
	projects: t.router({
		list: t.procedure.output(runtimeProjectsResponseSchema).query(async ({ ctx }) => {
			return await ctx.projectsApi.listProjects(ctx.requestedWorkspaceId);
		}),
		add: t.procedure
			.input(runtimeProjectAddRequestSchema)
			.output(runtimeProjectAddResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.projectsApi.addProject(ctx.requestedWorkspaceId, input);
			}),
		remove: t.procedure
			.input(runtimeProjectRemoveRequestSchema)
			.output(runtimeProjectRemoveResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.projectsApi.removeProject(ctx.requestedWorkspaceId, input);
			}),
		pickDirectory: t.procedure.output(runtimeProjectDirectoryPickerResponseSchema).mutation(async ({ ctx }) => {
			return await ctx.projectsApi.pickProjectDirectory(ctx.requestedWorkspaceId);
		}),
		listDirectoryContents: t.procedure
			.input(runtimeDirectoryListRequestSchema)
			.output(runtimeDirectoryListResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.projectsApi.listDirectoryContents(ctx.requestedWorkspaceId, input);
			}),
	}),
	hooks: t.router({
		ingest: t.procedure
			.input(runtimeHookIngestRequestSchema)
			.output(runtimeHookIngestResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.hooksApi.ingest(input);
			}),
	}),
	manager: t.router({
		state: t.procedure.output(RuntimeManagerStateSchema).query(async ({ ctx }) => {
			return await ctx.managerApi.getState();
		}),
		setFeatureEnabled: t.procedure
			.input(RuntimeManagerFeatureToggleRequestSchema)
			.output(RuntimeManagerMutationResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.managerApi.setFeatureEnabled(input);
			}),
		pauseSwap: t.procedure
			.input(RuntimeManagerSwapPauseRequestSchema)
			.output(RuntimeManagerMutationResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.managerApi.pauseSwap(input);
			}),
		resumeSwap: t.procedure.output(RuntimeManagerMutationResponseSchema).mutation(async ({ ctx }) => {
			return await ctx.managerApi.resumeSwap();
		}),
		useAccount: t.procedure
			.input(RuntimeManagerAccountIdRequestSchema)
			.output(RuntimeManagerMutationResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.managerApi.useAccount(input);
			}),
		refreshAccount: t.procedure
			.input(RuntimeManagerAccountIdRequestSchema)
			.output(RuntimeManagerMutationResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.managerApi.refreshAccount(input);
			}),
		refreshAllUsage: t.procedure.output(RuntimeManagerMutationResponseSchema).mutation(async ({ ctx }) => {
			return await ctx.managerApi.refreshAllUsage();
		}),
		reconcileActive: t.procedure.output(RuntimeManagerMutationResponseSchema).mutation(async ({ ctx }) => {
			return await ctx.managerApi.reconcileActive();
		}),
		updateAccount: t.procedure
			.input(RuntimeManagerAccountUpdateRequestSchema)
			.output(RuntimeManagerMutationResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.managerApi.updateAccount(input);
			}),
		deleteAccount: t.procedure
			.input(RuntimeManagerAccountIdRequestSchema)
			.output(RuntimeManagerMutationResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.managerApi.deleteAccount(input);
			}),
		validateAccount: t.procedure
			.input(RuntimeManagerAccountIdRequestSchema)
			.output(RuntimeManagerMutationResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.managerApi.validateAccount(input);
			}),
		reorderAccounts: t.procedure
			.input(RuntimeManagerAccountReorderRequestSchema)
			.output(RuntimeManagerMutationResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.managerApi.reorderAccounts(input);
			}),
		startAccountReauth: t.procedure
			.input(RuntimeManagerAccountReauthRequestSchema)
			.output(RuntimeManagerOAuthStartResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.managerApi.startAccountReauth(input);
			}),
		startAccountAuthorizeCc: t.procedure
			.input(RuntimeManagerAccountAuthorizeCcRequestSchema)
			.output(RuntimeManagerOAuthStartResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.managerApi.startAccountAuthorizeCc(input);
			}),
		activeSessions: t.procedure.output(RuntimeManagerSessionsSchema.nullable()).query(async ({ ctx }) => {
			return await ctx.managerApi.getActiveSessions();
		}),
		packs: t.procedure.output(RuntimeManagerPacksSchema.nullable()).query(async ({ ctx }) => {
			return await ctx.managerApi.getPacks();
		}),
		setPackEnabled: t.procedure
			.input(RuntimeManagerPackToggleRequestSchema)
			.output(RuntimeManagerMutationResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.managerApi.setPackEnabled(input);
			}),
		accountLaunchDir: t.procedure
			.input(RuntimeManagerAccountIdRequestSchema)
			.output(RuntimeManagerAccountLaunchDirSchema.nullable())
			.mutation(async ({ ctx, input }) => {
				return await ctx.managerApi.getAccountLaunchDir(input);
			}),
		accountLaunchCredential: t.procedure
			.input(RuntimeManagerAccountIdRequestSchema)
			.output(RuntimeManagerAccountLaunchCredentialSchema.nullable())
			.mutation(async ({ ctx, input }) => {
				return await ctx.managerApi.getAccountLaunchCredential(input);
			}),
		importCursorAccount: t.procedure
			.output(
				z.object({
					ok: z.boolean(),
					error: z.string().optional(),
					accountId: z.number().int().positive().optional(),
					email: z.string().optional(),
				}),
			)
			.mutation(async ({ ctx }) => {
				return await ctx.managerApi.importCursorAccount();
			}),
		importClaudeAccount: t.procedure
			.output(
				z.object({
					ok: z.boolean(),
					error: z.string().optional(),
					accountId: z.number().int().positive().optional(),
					email: z.string().optional(),
				}),
			)
			.mutation(async ({ ctx }) => {
				return await ctx.managerApi.importClaudeAccount();
			}),
		reimportCursorAccount: t.procedure
			.input(RuntimeManagerAccountIdRequestSchema)
			.output(
				z.object({
					ok: z.boolean(),
					error: z.string().optional(),
					accountId: z.number().int().positive().optional(),
					email: z.string().optional(),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				return await ctx.managerApi.reimportCursorAccount(input);
			}),
		accountProvider: t.procedure
			.input(RuntimeManagerAccountIdRequestSchema)
			.output(RuntimeManagerProviderSchema.nullable())
			.query(async ({ ctx, input }) => {
				return await ctx.managerApi.getAccountProvider(input.accountId);
			}),
		installationsOverview: t.procedure
			.output(RuntimeManagerInstallationsOverviewSchema.nullable())
			.query(async ({ ctx }) => {
				return await ctx.managerApi.getInstallationsOverview();
			}),
		serverLogs: t.procedure
			.input(z.object({ limit: z.number().int().min(1).max(500).optional() }).optional())
			.output(RuntimeManagerServerLogsSchema.nullable())
			.query(async ({ ctx, input }) => {
				return await ctx.managerApi.getServerLogs(input?.limit);
			}),
		hookLogs: t.procedure
			.input(z.object({ limit: z.number().int().min(1).max(500).optional() }).optional())
			.output(RuntimeManagerHookLogsSchema.nullable())
			.query(async ({ ctx, input }) => {
				return await ctx.managerApi.getHookLogs(input?.limit);
			}),
		usageOverview: t.procedure
			.input(z.object({ days: z.number().int().min(1).max(365).optional() }).optional())
			.output(RuntimeManagerUsageOverviewSchema.nullable())
			.query(async ({ ctx, input }) => {
				return await ctx.managerApi.getUsageOverview(input?.days);
			}),
		swapLog: t.procedure
			.input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
			.output(RuntimeManagerSwapLogSchema.nullable())
			.query(async ({ ctx, input }) => {
				return await ctx.managerApi.getSwapLog(input?.limit);
			}),
		startClaudeOAuth: t.procedure
			.input(RuntimeManagerOAuthStartRequestSchema.optional())
			.output(RuntimeManagerOAuthStartResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.managerApi.startClaudeOAuth(input);
			}),
		oauthFlowStatus: t.procedure
			.input(RuntimeManagerOAuthFlowStatusRequestSchema)
			.output(RuntimeManagerOAuthFlowStatusSchema.nullable())
			.query(async ({ ctx, input }) => {
				return await ctx.managerApi.getOAuthFlowStatus(input);
			}),
		submitOAuthCode: t.procedure
			.input(RuntimeManagerOAuthSubmitCodeRequestSchema)
			.output(RuntimeManagerOAuthFlowStatusSchema.nullable())
			.mutation(async ({ ctx, input }) => {
				return await ctx.managerApi.submitOAuthCode(input);
			}),
		createUsageAuthSession: t.procedure
			.input(RuntimeManagerUsageAuthSessionCreateRequestSchema)
			.output(RuntimeManagerUsageAuthSessionCreateResponseSchema)
			.mutation(async ({ input }) => {
				try {
					return await createUsageAuthSession(input.authLink, {
						sessionId: input.sessionId,
					});
				} catch (err) {
					throw new TRPCError({
						code: "BAD_GATEWAY",
						message:
							err instanceof Error
								? err.message
								: "Could not create authorization form session",
					});
				}
			}),
		getUsageAuthCode: t.procedure
			.input(RuntimeManagerUsageAuthCodeRequestSchema)
			.output(RuntimeManagerUsageAuthCodeResponseSchema)
			.query(async ({ input }) => {
				return await lookupUsageAuthCode(input.sessionId);
			}),
	}),
});

export type RuntimeAppRouter = typeof runtimeAppRouter;
export type RuntimeAppRouterInputs = inferRouterInputs<RuntimeAppRouter>;
export type RuntimeAppRouterOutputs = inferRouterOutputs<RuntimeAppRouter>;
