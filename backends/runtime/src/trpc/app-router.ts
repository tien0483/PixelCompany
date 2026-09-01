// Defines the typed TRPC boundary between the browser and the local runtime.
// Keep request and response contracts plus workspace-scoped procedures here,
// and delegate domain behavior to runtime-api.ts and lower-level services.
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import type {
	RuntimeAgentModelInventory,
	RuntimeClaudeCacheCleanRequest,
	RuntimeClaudeCacheCleanResponse,
	RuntimeClaudeCacheStatusRequest,
	RuntimeClaudeCacheStatusResponse,
	RuntimeCleanMergedWorktreesRequest,
	RuntimeCleanMergedWorktreesResponse,
	RuntimeCleanStashResponse,
	RuntimeClineAccountBalanceResponse,
	RuntimeClineAccountOrganizationsResponse,
	RuntimeClineAccountProfileResponse,
	RuntimeClineAccountSwitchRequest,
	RuntimeClineAccountSwitchResponse,
	RuntimeClineAddProviderRequest,
	RuntimeClineAddProviderResponse,
	RuntimeClineApiSeatListResponse,
	RuntimeClineCustomProviderListResponse,
	RuntimeClineDeleteProviderRequest,
	RuntimeClineDeleteProviderResponse,
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
	RuntimeClineTestProviderRequest,
	RuntimeClineTestProviderResponse,
	RuntimeClineUpdateProviderRequest,
	RuntimeClineUpdateProviderResponse,
	RuntimeCommandRunRequest,
	RuntimeCommandRunResponse,
	RuntimeConfigResponse,
	RuntimeConfigSaveRequest,
	RuntimeDebugResetAllStateResponse,
	RuntimeDeployConfigUpdateRequest,
	RuntimeDeployLoginCodeRequest,
	RuntimeDeployLoginStartRequest,
	RuntimeDeployLoginStatus,
	RuntimeDeployOpenUrlRequest,
	RuntimeDeployOpenUrlResponse,
	RuntimeDeployRunRequest,
	RuntimeDeployRunResponse,
	RuntimeDeployStatusRequest,
	RuntimeDeployStatusResponse,
	RuntimeDirectoryListRequest,
	RuntimeDirectoryListResponse,
	RuntimeDocProject,
	RuntimeDocProjectCreateRequest,
	RuntimeDocSkillStatus,
	RuntimeFeaturebaseTokenResponse,
	RuntimeGetWorkspaceLocalAssetsRequest,
	RuntimeGitBlameRequest,
	RuntimeGitBlameResponse,
	RuntimeGitCheckoutRequest,
	RuntimeGitCheckoutResponse,
	RuntimeGitCherryPickRequest,
	RuntimeGitCherryPickResponse,
	RuntimeGitCommitDiffRequest,
	RuntimeGitCommitDiffResponse,
	RuntimeGitCommitRequest,
	RuntimeGitCommitResponse,
	RuntimeGitConflictsResponse,
	RuntimeGitCreateBranchRequest,
	RuntimeGitCreateBranchResponse,
	RuntimeGitDeleteBranchRequest,
	RuntimeGitDeleteBranchResponse,
	RuntimeGitDiscardResponse,
	RuntimeGitLogRequest,
	RuntimeGitLogResponse,
	RuntimeGitMergeBranchRequest,
	RuntimeGitMergeBranchResponse,
	RuntimeGitMergeIntoCurrentRequest,
	RuntimeGitMergeIntoCurrentResponse,
	RuntimeGitPullRequestRequest,
	RuntimeGitPullRequestResponse,
	RuntimeGitPushBranchRequest,
	RuntimeGitPushBranchResponse,
	RuntimeGitRebaseCurrentOntoRequest,
	RuntimeGitRebaseCurrentOntoResponse,
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
	RuntimeManagerFeaturesRequest,
	RuntimeManagerFeaturesResponse,
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
	RuntimeManagerSyncFeaturesRequest,
	RuntimeManagerSyncFeaturesResponse,
	RuntimeManagerUsageOverview,
	RuntimeMcpInventory,
	RuntimeOpenFileRequest,
	RuntimeOpenFileResponse,
	RuntimePlansCreateRequest,
	RuntimePlansCreateResponse,
	RuntimePlansHistoryDiffRequest,
	RuntimePlansHistoryDiffResponse,
	RuntimePlansHistoryListRequest,
	RuntimePlansHistoryListResponse,
	RuntimePlansHistoryMarkRequest,
	RuntimePlansHistoryMarkResponse,
	RuntimePlansHistoryMaterializeResponse,
	RuntimePlansHistoryMoveRequest,
	RuntimePlansHistoryRestoreRequest,
	RuntimePlansHtmlSourceRequest,
	RuntimePlansImportFileRequest,
	RuntimePlansImportFileResponse,
	RuntimePlansImportFromFolderRequest,
	RuntimePlansImportFromFolderResponse,
	RuntimePlansListResponse,
	RuntimePlansReadHtmlSourceResponse,
	RuntimePlansReadRequest,
	RuntimePlansReadResponse,
	RuntimePlansRemoveRequest,
	RuntimePlansRemoveResponse,
	RuntimePlansWriteAssetRequest,
	RuntimePlansWriteAssetResponse,
	RuntimePlansWriteBackupRequest,
	RuntimePlansWriteBackupResponse,
	RuntimePlansWriteHtmlSourceRequest,
	RuntimePlansWriteHtmlSourceResponse,
	RuntimePlansWriteRequest,
	RuntimePlansWriteResponse,
	RuntimePlansWriteSiblingRequest,
	RuntimePlansWriteSiblingResponse,
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
	RuntimeSkillInventoryItem,
	RuntimeSkillInventoryRequest,
	RuntimeSlashCommandsResponse,
	RuntimeTaskChatAbortRequest,
	RuntimeTaskChatAbortResponse,
	RuntimeTaskChatCancelRequest,
	RuntimeTaskChatCancelResponse,
	RuntimeTaskChatMessagesRequest,
	RuntimeTaskChatMessagesResponse,
	RuntimeTaskChatModelRequest,
	RuntimeTaskChatModelResponse,
	RuntimeTaskChatReloadRequest,
	RuntimeTaskChatReloadResponse,
	RuntimeTaskChatSendRequest,
	RuntimeTaskChatSendResponse,
	RuntimeTaskSessionInputRequest,
	RuntimeTaskSessionInputResponse,
	RuntimeTaskSessionPauseRequest,
	RuntimeTaskSessionPauseResponse,
	RuntimeTaskSessionStagePasteImagesRequest,
	RuntimeTaskSessionStagePasteImagesResponse,
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
	type RuntimeClaudeUsage,
	RuntimeClaudeUsageSchema,
	RuntimeDocProjectCreateRequestSchema,
	RuntimeDocProjectSchema,
	RuntimeDocSkillStatusSchema,
	type RuntimeFlowiseFlow,
	RuntimeFlowiseFlowSchema,
	type RuntimeFlowiseLlmProxyStatus,
	RuntimeFlowiseLlmProxyStatusSchema,
	type RuntimeFlowiseStatus,
	RuntimeFlowiseStatusSchema,
	type RuntimeOpenmaicStatus,
	RuntimeOpenmaicStatusSchema,
	type RuntimeClaudeOrgMcpPolicy,
	RuntimeClaudeOrgMcpPolicySchema,
	type RuntimeOrchestratorStatus,
	RuntimeOrchestratorStatusSchema,
	type RuntimeGitlabConnection,
	type RuntimeGitlabConnectStartRequest,
	type RuntimeGitlabConnectStartResponse,
	type RuntimeGitlabConnectStatus,
	type RuntimeGitlabConnectStatusRequest,
	type RuntimeGitlabConnectTokenRequest,
	type RuntimeGitlabConnectTokenResponse,
	type RuntimeGitlabCreateDiffNoteRequest,
	type RuntimeGitlabCreateNoteRequest,
	type RuntimeGitlabDiffsResponse,
	type RuntimeGitlabDiscussionListResponse,
	type RuntimeGitlabMergeRequestDetailResponse,
	type RuntimeGitlabMergeRequestListRequest,
	type RuntimeGitlabMergeRequestListResponse,
	type RuntimeGitlabMergeRequestRef,
	type RuntimeGitlabMergeRequestVersionsResponse,
	type RuntimeGitlabMutationResponse,
	type RuntimeGitlabProjectListRequest,
	type RuntimeGitlabProjectListResponse,
	type RuntimeGitlabRawFileRequest,
	type RuntimeGitlabRawFileResponse,
	type RuntimeGitlabResolveDiscussionRequest,
	type RuntimeHtmlStatus,
	RuntimeHtmlStatusSchema,
	type RuntimeHtmlTemplate,
	type RuntimeHtmlTemplateExample,
	RuntimeHtmlTemplateExampleSchema,
	RuntimeHtmlTemplateSchema,
	RuntimeManagerAccountAuthorizeCcRequestSchema,
	RuntimeManagerAccountIdRequestSchema,
	RuntimeManagerAccountLaunchCredentialSchema,
	RuntimeManagerAccountLaunchDirSchema,
	RuntimeManagerAccountReauthRequestSchema,
	RuntimeManagerAccountReorderRequestSchema,
	RuntimeManagerAccountUpdateRequestSchema,
	RuntimeManagerFeaturesRequestSchema,
	RuntimeManagerFeaturesResponseSchema,
	RuntimeManagerFeatureToggleRequestSchema,
	RuntimeManagerGitIdentitySchema,
	RuntimeManagerHookLogsSchema,
	RuntimeManagerInstallationsOverviewSchema,
	RuntimeManagerMutationResponseSchema,
	RuntimeManagerOAuthFlowStatusRequestSchema,
	RuntimeManagerOAuthFlowStatusSchema,
	RuntimeManagerOAuthStartRequestSchema,
	RuntimeManagerOAuthStartResponseSchema,
	RuntimeManagerOAuthSubmitCodeRequestSchema,
	RuntimeManagerPacksSchema,
	RuntimeManagerPackToggleRequestSchema,
	RuntimeManagerProviderSchema,
	RuntimeManagerServerLogsSchema,
	RuntimeManagerSessionsSchema,
	RuntimeManagerStateSchema,
	RuntimeManagerSwapLogSchema,
	RuntimeManagerSwapPauseRequestSchema,
	RuntimeManagerSyncFeaturesRequestSchema,
	RuntimeManagerSyncFeaturesResponseSchema,
	RuntimeManagerUsageAuthCodeRequestSchema,
	RuntimeManagerUsageAuthCodeResponseSchema,
	RuntimeManagerUsageAuthSessionCreateRequestSchema,
	RuntimeManagerUsageAuthSessionCreateResponseSchema,
	RuntimeManagerUsageOverviewSchema,
	type RuntimeReviewCommandsRequest,
	type RuntimeReviewCommandsResponse,
	type RuntimeReviewGraphDashboardRequest,
	type RuntimeReviewGraphDashboardResponse,
	type RuntimeReviewGraphImpactRequest,
	type RuntimeReviewGraphImpactResponse,
	type RuntimeReviewRulesConfig,
	type RuntimeReviewRulesConfigResponse,
	type RuntimeReviewRulesReadRequest,
	type RuntimeReviewRulesReadResponse,
	type RuntimeReviewSession,
	type RuntimeReviewSessionReadRequest,
	type RuntimeReviewSessionResponse,
	type RuntimeReviewSessionWriteRequest,
	runtimeAgentModelInventorySchema,
	runtimeClaudeCacheCleanRequestSchema,
	runtimeClaudeCacheCleanResponseSchema,
	runtimeClaudeCacheStatusRequestSchema,
	runtimeClaudeCacheStatusResponseSchema,
	runtimeCleanMergedWorktreesRequestSchema,
	runtimeCleanMergedWorktreesResponseSchema,
	runtimeCleanStashResponseSchema,
	runtimeClineAccountBalanceResponseSchema,
	runtimeClineAccountOrganizationsResponseSchema,
	runtimeClineAccountProfileResponseSchema,
	runtimeClineAccountSwitchRequestSchema,
	runtimeClineAccountSwitchResponseSchema,
	runtimeClineAddProviderRequestSchema,
	runtimeClineAddProviderResponseSchema,
	runtimeClineApiSeatListResponseSchema,
	runtimeClineCustomProviderListResponseSchema,
	runtimeClineDeleteProviderRequestSchema,
	runtimeClineDeleteProviderResponseSchema,
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
	runtimeClineTestProviderRequestSchema,
	runtimeClineTestProviderResponseSchema,
	runtimeClineUpdateProviderRequestSchema,
	runtimeClineUpdateProviderResponseSchema,
	runtimeCommandRunRequestSchema,
	runtimeCommandRunResponseSchema,
	runtimeConfigResponseSchema,
	runtimeConfigSaveRequestSchema,
	runtimeDebugResetAllStateResponseSchema,
	runtimeDeployConfigUpdateRequestSchema,
	runtimeDeployLoginCodeRequestSchema,
	runtimeDeployLoginStartRequestSchema,
	runtimeDeployLoginStatusSchema,
	runtimeDeployOpenUrlRequestSchema,
	runtimeDeployOpenUrlResponseSchema,
	runtimeDeployRunRequestSchema,
	runtimeDeployRunResponseSchema,
	runtimeDeployStatusRequestSchema,
	runtimeDeployStatusResponseSchema,
	runtimeDirectoryListRequestSchema,
	runtimeDirectoryListResponseSchema,
	runtimeFeaturebaseTokenResponseSchema,
	runtimeGetWorkspaceLocalAssetsRequestSchema,
	runtimeGitBlameRequestSchema,
	runtimeGitBlameResponseSchema,
	runtimeGitCheckoutRequestSchema,
	runtimeGitCheckoutResponseSchema,
	runtimeGitCherryPickRequestSchema,
	runtimeGitCherryPickResponseSchema,
	runtimeGitCommitDiffRequestSchema,
	runtimeGitCommitDiffResponseSchema,
	runtimeGitCommitRequestSchema,
	runtimeGitCommitResponseSchema,
	runtimeGitConflictsResponseSchema,
	runtimeGitCreateBranchRequestSchema,
	runtimeGitCreateBranchResponseSchema,
	runtimeGitDeleteBranchRequestSchema,
	runtimeGitDeleteBranchResponseSchema,
	runtimeGitDiscardResponseSchema,
	runtimeGitLogRequestSchema,
	runtimeGitLogResponseSchema,
	runtimeGitlabConnectionSchema,
	runtimeGitlabConnectStartRequestSchema,
	runtimeGitlabConnectStartResponseSchema,
	runtimeGitlabConnectStatusRequestSchema,
	runtimeGitlabConnectStatusSchema,
	runtimeGitlabConnectTokenRequestSchema,
	runtimeGitlabConnectTokenResponseSchema,
	runtimeGitlabCreateDiffNoteRequestSchema,
	runtimeGitlabCreateNoteRequestSchema,
	runtimeGitlabDiffsResponseSchema,
	runtimeGitlabDiscussionListResponseSchema,
	runtimeGitlabMergeRequestDetailResponseSchema,
	runtimeGitlabMergeRequestListRequestSchema,
	runtimeGitlabMergeRequestListResponseSchema,
	runtimeGitlabMergeRequestRefSchema,
	runtimeGitlabMergeRequestVersionsResponseSchema,
	runtimeGitlabMutationResponseSchema,
	runtimeGitlabProjectListRequestSchema,
	runtimeGitlabProjectListResponseSchema,
	runtimeGitlabRawFileRequestSchema,
	runtimeGitlabRawFileResponseSchema,
	runtimeGitlabResolveDiscussionRequestSchema,
	runtimeGitMergeBranchRequestSchema,
	runtimeGitMergeBranchResponseSchema,
	runtimeGitMergeIntoCurrentRequestSchema,
	runtimeGitMergeIntoCurrentResponseSchema,
	runtimeGitPullRequestRequestSchema,
	runtimeGitPullRequestResponseSchema,
	runtimeGitPushBranchRequestSchema,
	runtimeGitPushBranchResponseSchema,
	runtimeGitRebaseCurrentOntoRequestSchema,
	runtimeGitRebaseCurrentOntoResponseSchema,
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
	runtimePlansCreateRequestSchema,
	runtimePlansCreateResponseSchema,
	runtimePlansHistoryDiffRequestSchema,
	runtimePlansHistoryDiffResponseSchema,
	runtimePlansHistoryListRequestSchema,
	runtimePlansHistoryListResponseSchema,
	runtimePlansHistoryMarkRequestSchema,
	runtimePlansHistoryMarkResponseSchema,
	runtimePlansHistoryMaterializeResponseSchema,
	runtimePlansHistoryMoveRequestSchema,
	runtimePlansHistoryRestoreRequestSchema,
	runtimePlansHtmlSourceRequestSchema,
	runtimePlansImportFileRequestSchema,
	runtimePlansImportFileResponseSchema,
	runtimePlansImportFromFolderRequestSchema,
	runtimePlansImportFromFolderResponseSchema,
	runtimePlansListResponseSchema,
	runtimePlansReadHtmlSourceResponseSchema,
	runtimePlansReadRequestSchema,
	runtimePlansReadResponseSchema,
	runtimePlansRemoveRequestSchema,
	runtimePlansRemoveResponseSchema,
	runtimePlansWriteAssetRequestSchema,
	runtimePlansWriteAssetResponseSchema,
	runtimePlansWriteBackupRequestSchema,
	runtimePlansWriteBackupResponseSchema,
	runtimePlansWriteHtmlSourceRequestSchema,
	runtimePlansWriteHtmlSourceResponseSchema,
	runtimePlansWriteRequestSchema,
	runtimePlansWriteResponseSchema,
	runtimePlansWriteSiblingRequestSchema,
	runtimePlansWriteSiblingResponseSchema,
	runtimeProjectAddRequestSchema,
	runtimeProjectAddResponseSchema,
	runtimeProjectDirectoryPickerResponseSchema,
	runtimeProjectRemoveRequestSchema,
	runtimeProjectRemoveResponseSchema,
	runtimeProjectsResponseSchema,
	runtimeReviewCommandsRequestSchema,
	runtimeReviewCommandsResponseSchema,
	runtimeReviewGraphDashboardRequestSchema,
	runtimeReviewGraphDashboardResponseSchema,
	runtimeReviewGraphImpactRequestSchema,
	runtimeReviewGraphImpactResponseSchema,
	runtimeReviewRulesConfigResponseSchema,
	runtimeReviewRulesConfigSchema,
	runtimeReviewRulesReadRequestSchema,
	runtimeReviewRulesReadResponseSchema,
	runtimeReviewSessionReadRequestSchema,
	runtimeReviewSessionResponseSchema,
	runtimeReviewSessionSchema,
	runtimeReviewSessionWriteRequestSchema,
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
	runtimeTaskChatModelRequestSchema,
	runtimeTaskChatModelResponseSchema,
	runtimeTaskChatReloadRequestSchema,
	runtimeTaskChatReloadResponseSchema,
	runtimeTaskChatSendRequestSchema,
	runtimeTaskChatSendResponseSchema,
	runtimeTaskSessionInputRequestSchema,
	runtimeTaskSessionInputResponseSchema,
	runtimeTaskSessionPauseRequestSchema,
	runtimeTaskSessionPauseResponseSchema,
	runtimeTaskSessionStagePasteImagesRequestSchema,
	runtimeTaskSessionStagePasteImagesResponseSchema,
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
import { resolveGitIdentity } from "../manager/git-identity.js";
import { createUsageAuthSession, lookupUsageAuthCode } from "../manager/vercel-auth-proxy.js";

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
		deleteClineProvider: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeClineDeleteProviderRequest,
		) => Promise<RuntimeClineDeleteProviderResponse>;
		getClineCustomProviders: (
			scope: RuntimeTrpcWorkspaceScope | null,
		) => Promise<RuntimeClineCustomProviderListResponse>;
		listClineApiSeats: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeClineApiSeatListResponse>;
		testClineProvider: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeClineTestProviderRequest,
		) => Promise<RuntimeClineTestProviderResponse>;
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
		stageTaskSessionPasteImages: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskSessionStagePasteImagesRequest,
		) => Promise<RuntimeTaskSessionStagePasteImagesResponse>;
		getTaskChatMessages: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskChatMessagesRequest,
		) => Promise<RuntimeTaskChatMessagesResponse>;
		getClineSlashCommands: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeSlashCommandsResponse>;
		listSkillInventory: (input: RuntimeSkillInventoryRequest) => Promise<RuntimeSkillInventory>;
		setWorkspaceLocalAssets: (
			input: RuntimeSetWorkspaceLocalAssetsRequest,
		) => Promise<RuntimeSetWorkspaceLocalAssetsResponse>;
		getWorkspaceLocalAssets: (
			input: RuntimeGetWorkspaceLocalAssetsRequest,
		) => Promise<RuntimeSetWorkspaceLocalAssetsResponse>;
		listMcpInventory: () => Promise<RuntimeMcpInventory>;
		getClaudeOrgMcpPolicy: () => Promise<RuntimeClaudeOrgMcpPolicy>;
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
		setTaskChatModel: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskChatModelRequest,
		) => Promise<RuntimeTaskChatModelResponse>;
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
		getClaudeCacheStatus: (input?: RuntimeClaudeCacheStatusRequest) => Promise<RuntimeClaudeCacheStatusResponse>;
		cleanClaudeCache: (input: RuntimeClaudeCacheCleanRequest) => Promise<RuntimeClaudeCacheCleanResponse>;
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
		mergeBranchIntoCurrent: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeGitMergeIntoCurrentRequest,
		) => Promise<RuntimeGitMergeIntoCurrentResponse>;
		rebaseCurrentOnto: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeGitRebaseCurrentOntoRequest,
		) => Promise<RuntimeGitRebaseCurrentOntoResponse>;
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
		cleanMergedWorktrees: (
			scope: RuntimeTrpcWorkspaceScope,
			input?: RuntimeCleanMergedWorktreesRequest,
		) => Promise<RuntimeCleanMergedWorktreesResponse>;
		cleanStash: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeCleanStashResponse>;
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
		// `signal` is the request's own AbortSignal: a client that navigates away mid-read
		// should not leave a `git show --patch` running to completion on a huge commit.
		loadGitLog: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeGitLogRequest,
			signal?: AbortSignal,
		) => Promise<RuntimeGitLogResponse>;
		loadGitRefs: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskWorkspaceInfoRequest | null,
			signal?: AbortSignal,
		) => Promise<RuntimeGitRefsResponse>;
		loadCommitDiff: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeGitCommitDiffRequest,
			signal?: AbortSignal,
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
	plansApi: {
		list: () => Promise<RuntimePlansListResponse>;
		importFromFolder: (input: RuntimePlansImportFromFolderRequest) => Promise<RuntimePlansImportFromFolderResponse>;
		importFile: (input: RuntimePlansImportFileRequest) => Promise<RuntimePlansImportFileResponse>;
		create: (input: RuntimePlansCreateRequest) => Promise<RuntimePlansCreateResponse>;
		remove: (input: RuntimePlansRemoveRequest) => Promise<RuntimePlansRemoveResponse>;
		read: (input: RuntimePlansReadRequest) => Promise<RuntimePlansReadResponse>;
		write: (input: RuntimePlansWriteRequest) => Promise<RuntimePlansWriteResponse>;
		writeSibling: (input: RuntimePlansWriteSiblingRequest) => Promise<RuntimePlansWriteSiblingResponse>;
		writeBackup: (input: RuntimePlansWriteBackupRequest) => Promise<RuntimePlansWriteBackupResponse>;
		readHtmlSource: (input: RuntimePlansHtmlSourceRequest) => Promise<RuntimePlansReadHtmlSourceResponse>;
		writeHtmlSource: (input: RuntimePlansWriteHtmlSourceRequest) => Promise<RuntimePlansWriteHtmlSourceResponse>;
		writeAsset: (input: RuntimePlansWriteAssetRequest) => Promise<RuntimePlansWriteAssetResponse>;
		historyList: (input: RuntimePlansHistoryListRequest) => Promise<RuntimePlansHistoryListResponse>;
		historyMark: (input: RuntimePlansHistoryMarkRequest) => Promise<RuntimePlansHistoryMarkResponse>;
		historyUndo: (input: RuntimePlansHistoryMoveRequest) => Promise<RuntimePlansHistoryMaterializeResponse>;
		historyRedo: (input: RuntimePlansHistoryMoveRequest) => Promise<RuntimePlansHistoryMaterializeResponse>;
		historyRestore: (input: RuntimePlansHistoryRestoreRequest) => Promise<RuntimePlansHistoryMaterializeResponse>;
		historyDiff: (input: RuntimePlansHistoryDiffRequest) => Promise<RuntimePlansHistoryDiffResponse>;
	};
	deployApi: {
		status: (input: RuntimeDeployStatusRequest) => Promise<RuntimeDeployStatusResponse>;
		setConfig: (input: RuntimeDeployConfigUpdateRequest) => Promise<RuntimeDeployStatusResponse>;
		login: (input: RuntimeDeployLoginStartRequest) => Promise<RuntimeDeployLoginStatus>;
		loginStatus: () => Promise<RuntimeDeployLoginStatus>;
		loginSubmitCode: (input: RuntimeDeployLoginCodeRequest) => Promise<RuntimeDeployLoginStatus>;
		run: (input: RuntimeDeployRunRequest) => Promise<RuntimeDeployRunResponse>;
		openUrl: (input: RuntimeDeployOpenUrlRequest) => Promise<RuntimeDeployOpenUrlResponse>;
	};
	hooksApi: {
		ingest: (input: RuntimeHookIngestRequest) => Promise<RuntimeHookIngestResponse>;
	};
	managerApi: {
		getState: () => Promise<RuntimeManagerState>;
		setFeatureEnabled: (input: RuntimeManagerFeatureToggleRequest) => Promise<RuntimeManagerMutationResponse>;
		features: (input: RuntimeManagerFeaturesRequest) => Promise<RuntimeManagerFeaturesResponse>;
		syncFeaturesToProject: (input: RuntimeManagerSyncFeaturesRequest) => Promise<RuntimeManagerSyncFeaturesResponse>;
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
		importAntigravityAccount: () => Promise<{ ok: boolean; error?: string; accountId?: number; email?: string }>;
		reimportCursorAccount: (
			input: RuntimeManagerAccountIdRequest,
		) => Promise<{ ok: boolean; error?: string; accountId?: number; email?: string }>;
		reimportAntigravityAccount: (
			input: RuntimeManagerAccountIdRequest,
		) => Promise<{ ok: boolean; error?: string; accountId?: number; email?: string }>;
		getAccountProvider: (accountId: number) => Promise<RuntimeManagerProvider | null>;
		getInstallationsOverview: (workspaceId?: string) => Promise<RuntimeManagerInstallationsOverview | null>;
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
	htmlApi: {
		status: () => Promise<RuntimeHtmlStatus>;
		templates: () => Promise<RuntimeHtmlTemplate[]>;
		templateExample: (id: string) => Promise<RuntimeHtmlTemplateExample | null>;
	};
	claudeUsageApi: {
		get: () => Promise<RuntimeClaudeUsage>;
	};
	flowiseApi: {
		status: () => Promise<RuntimeFlowiseStatus>;
		flows: () => Promise<RuntimeFlowiseFlow[]>;
		llmProxyStatus: () => Promise<RuntimeFlowiseLlmProxyStatus>;
	};
	openmaicApi: {
		status: () => Promise<RuntimeOpenmaicStatus>;
	};
	orchestratorApi: {
		status: () => Promise<RuntimeOrchestratorStatus>;
	};
	docSkillApi: {
		status: () => Promise<RuntimeDocSkillStatus>;
		projects: () => Promise<RuntimeDocProject[]>;
		createProject: (input: RuntimeDocProjectCreateRequest) => Promise<RuntimeDocProject>;
	};
	gitlabApi: {
		status: () => Promise<RuntimeGitlabConnection>;
		connect: (input: RuntimeGitlabConnectStartRequest) => Promise<RuntimeGitlabConnectStartResponse>;
		connectToken: (input: RuntimeGitlabConnectTokenRequest) => Promise<RuntimeGitlabConnectTokenResponse>;
		connectStatus: (input: RuntimeGitlabConnectStatusRequest) => Promise<RuntimeGitlabConnectStatus>;
		cancelConnect: (input: RuntimeGitlabConnectStatusRequest) => Promise<RuntimeGitlabMutationResponse>;
		disconnect: () => Promise<RuntimeGitlabMutationResponse>;
		listProjects: (input: RuntimeGitlabProjectListRequest) => Promise<RuntimeGitlabProjectListResponse>;
		listMergeRequests: (
			input: RuntimeGitlabMergeRequestListRequest,
		) => Promise<RuntimeGitlabMergeRequestListResponse>;
		getMergeRequest: (input: RuntimeGitlabMergeRequestRef) => Promise<RuntimeGitlabMergeRequestDetailResponse>;
		getDiffs: (input: RuntimeGitlabMergeRequestRef) => Promise<RuntimeGitlabDiffsResponse>;
		getVersions: (input: RuntimeGitlabMergeRequestRef) => Promise<RuntimeGitlabMergeRequestVersionsResponse>;
		getRawFile: (input: RuntimeGitlabRawFileRequest) => Promise<RuntimeGitlabRawFileResponse>;
		listDiscussions: (input: RuntimeGitlabMergeRequestRef) => Promise<RuntimeGitlabDiscussionListResponse>;
		createDiffDiscussion: (input: RuntimeGitlabCreateDiffNoteRequest) => Promise<RuntimeGitlabMutationResponse>;
		createNote: (input: RuntimeGitlabCreateNoteRequest) => Promise<RuntimeGitlabMutationResponse>;
		resolveDiscussion: (input: RuntimeGitlabResolveDiscussionRequest) => Promise<RuntimeGitlabMutationResponse>;
		setApproval: (
			input: RuntimeGitlabMergeRequestRef & { approved: boolean },
		) => Promise<RuntimeGitlabMutationResponse>;
	};
	reviewApi: {
		getSession: (input: RuntimeReviewSessionReadRequest) => Promise<RuntimeReviewSessionResponse>;
		saveSession: (input: RuntimeReviewSessionWriteRequest) => Promise<RuntimeReviewSessionResponse>;
		listSessionsWithDrafts: (input: { host: string }) => Promise<RuntimeReviewSession[]>;
		getRules: (input: RuntimeReviewRulesReadRequest) => Promise<RuntimeReviewRulesReadResponse>;
		getRulesConfig: (input: RuntimeReviewRulesReadRequest) => Promise<RuntimeReviewRulesConfigResponse>;
		setRulesConfig: (input: RuntimeReviewRulesConfig) => Promise<RuntimeReviewRulesConfigResponse>;
		listCommands: (input: RuntimeReviewCommandsRequest) => Promise<RuntimeReviewCommandsResponse>;
		getGraphImpact: (input: RuntimeReviewGraphImpactRequest) => Promise<RuntimeReviewGraphImpactResponse>;
		openGraphDashboard: (input: RuntimeReviewGraphDashboardRequest) => Promise<RuntimeReviewGraphDashboardResponse>;
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
		deleteClineProvider: t.procedure
			.input(runtimeClineDeleteProviderRequestSchema)
			.output(runtimeClineDeleteProviderResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.deleteClineProvider(ctx.workspaceScope, input);
			}),
		getClineCustomProviders: t.procedure
			.output(runtimeClineCustomProviderListResponseSchema)
			.query(async ({ ctx }) => {
				return await ctx.runtimeApi.getClineCustomProviders(ctx.workspaceScope);
			}),
		listClineApiSeats: t.procedure.output(runtimeClineApiSeatListResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.listClineApiSeats(ctx.workspaceScope);
		}),
		testClineProvider: t.procedure
			.input(runtimeClineTestProviderRequestSchema)
			.output(runtimeClineTestProviderResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.testClineProvider(ctx.workspaceScope, input);
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
		stageTaskSessionPasteImages: workspaceProcedure
			.input(runtimeTaskSessionStagePasteImagesRequestSchema)
			.output(runtimeTaskSessionStagePasteImagesResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.stageTaskSessionPasteImages(ctx.workspaceScope, input);
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
				const isAllowed = (item: RuntimeSkillInventoryItem, key: string) => {
					// Project-local assets (installed per-project via Manager or authored in the project)
					// must not be suppressed by the global Manager companion flags.
					if (item.origin === "project") {
						return true;
					}
					return !disabled.has(key);
				};
				return {
					...inventory,
					skills: inventory.skills.filter((s) => isAllowed(s, `knowledge:skill_${s.id}`)),
					agents: inventory.agents.filter((a) => isAllowed(a, `agents:${a.id}`)),
					commands: inventory.commands.filter((c) => isAllowed(c, `commands:${c.id}`)),
					workflows: inventory.workflows,
				};
			}),
		setWorkspaceLocalAssets: t.procedure
			.input(runtimeSetWorkspaceLocalAssetsRequestSchema)
			.output(runtimeSetWorkspaceLocalAssetsResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.setWorkspaceLocalAssets(input);
			}),
		getWorkspaceLocalAssets: t.procedure
			.input(runtimeGetWorkspaceLocalAssetsRequestSchema)
			.output(runtimeSetWorkspaceLocalAssetsResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.runtimeApi.getWorkspaceLocalAssets(input);
			}),
		listMcpInventory: t.procedure.output(runtimeMcpInventorySchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.listMcpInventory();
		}),
		claudeOrgMcpPolicy: t.procedure.output(RuntimeClaudeOrgMcpPolicySchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getClaudeOrgMcpPolicy();
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
		setTaskChatModel: workspaceProcedure
			.input(runtimeTaskChatModelRequestSchema)
			.output(runtimeTaskChatModelResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.setTaskChatModel(ctx.workspaceScope, input);
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
		getClaudeCacheStatus: t.procedure
			.input(runtimeClaudeCacheStatusRequestSchema.optional())
			.output(runtimeClaudeCacheStatusResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.runtimeApi.getClaudeCacheStatus(input);
			}),
		cleanClaudeCache: t.procedure
			.input(runtimeClaudeCacheCleanRequestSchema)
			.output(runtimeClaudeCacheCleanResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.cleanClaudeCache(input);
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
		mergeBranchIntoCurrent: workspaceProcedure
			.input(runtimeGitMergeIntoCurrentRequestSchema)
			.output(runtimeGitMergeIntoCurrentResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.mergeBranchIntoCurrent(ctx.workspaceScope, input);
			}),
		rebaseCurrentOnto: workspaceProcedure
			.input(runtimeGitRebaseCurrentOntoRequestSchema)
			.output(runtimeGitRebaseCurrentOntoResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.rebaseCurrentOnto(ctx.workspaceScope, input);
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
		cleanMergedWorktrees: workspaceProcedure
			.input(runtimeCleanMergedWorktreesRequestSchema.optional())
			.output(runtimeCleanMergedWorktreesResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.cleanMergedWorktrees(ctx.workspaceScope, input ?? undefined);
			}),
		cleanStash: workspaceProcedure.output(runtimeCleanStashResponseSchema).mutation(async ({ ctx }) => {
			return await ctx.workspaceApi.cleanStash(ctx.workspaceScope);
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
			.query(async ({ ctx, input, signal }) => {
				return await ctx.workspaceApi.loadGitLog(ctx.workspaceScope, input, signal);
			}),
		getGitRefs: workspaceProcedure
			.input(optionalTaskWorkspaceInfoRequestSchema)
			.output(runtimeGitRefsResponseSchema)
			.query(async ({ ctx, input, signal }) => {
				return await ctx.workspaceApi.loadGitRefs(ctx.workspaceScope, input ?? null, signal);
			}),
		getCommitDiff: workspaceProcedure
			.input(runtimeGitCommitDiffRequestSchema)
			.output(runtimeGitCommitDiffResponseSchema)
			.query(async ({ ctx, input, signal }) => {
				return await ctx.workspaceApi.loadCommitDiff(ctx.workspaceScope, input, signal);
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
	plans: t.router({
		list: t.procedure.output(runtimePlansListResponseSchema).query(async ({ ctx }) => {
			return await ctx.plansApi.list();
		}),
		importFromFolder: t.procedure
			.input(runtimePlansImportFromFolderRequestSchema)
			.output(runtimePlansImportFromFolderResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.plansApi.importFromFolder(input);
			}),
		importFile: t.procedure
			.input(runtimePlansImportFileRequestSchema)
			.output(runtimePlansImportFileResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.plansApi.importFile(input);
			}),
		create: t.procedure
			.input(runtimePlansCreateRequestSchema)
			.output(runtimePlansCreateResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.plansApi.create(input);
			}),
		remove: t.procedure
			.input(runtimePlansRemoveRequestSchema)
			.output(runtimePlansRemoveResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.plansApi.remove(input);
			}),
		read: t.procedure
			.input(runtimePlansReadRequestSchema)
			.output(runtimePlansReadResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.plansApi.read(input);
			}),
		write: t.procedure
			.input(runtimePlansWriteRequestSchema)
			.output(runtimePlansWriteResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.plansApi.write(input);
			}),
		writeSibling: t.procedure
			.input(runtimePlansWriteSiblingRequestSchema)
			.output(runtimePlansWriteSiblingResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.plansApi.writeSibling(input);
			}),
		writeBackup: t.procedure
			.input(runtimePlansWriteBackupRequestSchema)
			.output(runtimePlansWriteBackupResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.plansApi.writeBackup(input);
			}),
		readHtmlSource: t.procedure
			.input(runtimePlansHtmlSourceRequestSchema)
			.output(runtimePlansReadHtmlSourceResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.plansApi.readHtmlSource(input);
			}),
		writeHtmlSource: t.procedure
			.input(runtimePlansWriteHtmlSourceRequestSchema)
			.output(runtimePlansWriteHtmlSourceResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.plansApi.writeHtmlSource(input);
			}),
		writeAsset: t.procedure
			.input(runtimePlansWriteAssetRequestSchema)
			.output(runtimePlansWriteAssetResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.plansApi.writeAsset(input);
			}),
		historyList: t.procedure
			.input(runtimePlansHistoryListRequestSchema)
			.output(runtimePlansHistoryListResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.plansApi.historyList(input);
			}),
		historyMark: t.procedure
			.input(runtimePlansHistoryMarkRequestSchema)
			.output(runtimePlansHistoryMarkResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.plansApi.historyMark(input);
			}),
		historyUndo: t.procedure
			.input(runtimePlansHistoryMoveRequestSchema)
			.output(runtimePlansHistoryMaterializeResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.plansApi.historyUndo(input);
			}),
		historyRedo: t.procedure
			.input(runtimePlansHistoryMoveRequestSchema)
			.output(runtimePlansHistoryMaterializeResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.plansApi.historyRedo(input);
			}),
		historyRestore: t.procedure
			.input(runtimePlansHistoryRestoreRequestSchema)
			.output(runtimePlansHistoryMaterializeResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.plansApi.historyRestore(input);
			}),
		historyDiff: t.procedure
			.input(runtimePlansHistoryDiffRequestSchema)
			.output(runtimePlansHistoryDiffResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.plansApi.historyDiff(input);
			}),
	}),
	// Publishing a generated page as an Apps Script web app. Mirrored in the standalone
	// plan-editor router (`plan-editor-standalone/router.ts`), which shares `deployApi`.
	deploy: t.router({
		status: t.procedure
			.input(runtimeDeployStatusRequestSchema)
			.output(runtimeDeployStatusResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.deployApi.status(input);
			}),
		setConfig: t.procedure
			.input(runtimeDeployConfigUpdateRequestSchema)
			.output(runtimeDeployStatusResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.deployApi.setConfig(input);
			}),
		login: t.procedure
			.input(runtimeDeployLoginStartRequestSchema)
			.output(runtimeDeployLoginStatusSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.deployApi.login(input);
			}),
		loginStatus: t.procedure.output(runtimeDeployLoginStatusSchema).query(async ({ ctx }) => {
			return await ctx.deployApi.loginStatus();
		}),
		loginSubmitCode: t.procedure
			.input(runtimeDeployLoginCodeRequestSchema)
			.output(runtimeDeployLoginStatusSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.deployApi.loginSubmitCode(input);
			}),
		run: t.procedure
			.input(runtimeDeployRunRequestSchema)
			.output(runtimeDeployRunResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.deployApi.run(input);
			}),
		openUrl: t.procedure
			.input(runtimeDeployOpenUrlRequestSchema)
			.output(runtimeDeployOpenUrlResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.deployApi.openUrl(input);
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
		features: t.procedure
			.input(RuntimeManagerFeaturesRequestSchema)
			.output(RuntimeManagerFeaturesResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.managerApi.features(input);
			}),
		syncFeaturesToProject: t.procedure
			.input(RuntimeManagerSyncFeaturesRequestSchema)
			.output(RuntimeManagerSyncFeaturesResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.managerApi.syncFeaturesToProject(input);
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
		importAntigravityAccount: t.procedure
			.output(
				z.object({
					ok: z.boolean(),
					error: z.string().optional(),
					accountId: z.number().int().positive().optional(),
					email: z.string().optional(),
				}),
			)
			.mutation(async ({ ctx }) => {
				return await ctx.managerApi.importAntigravityAccount();
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
		reimportAntigravityAccount: t.procedure
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
				return await ctx.managerApi.reimportAntigravityAccount(input);
			}),
		accountProvider: t.procedure
			.input(RuntimeManagerAccountIdRequestSchema)
			.output(RuntimeManagerProviderSchema.nullable())
			.query(async ({ ctx, input }) => {
				return await ctx.managerApi.getAccountProvider(input.accountId);
			}),
		installationsOverview: t.procedure
			.input(z.object({ workspaceId: z.string().optional() }).optional())
			.output(RuntimeManagerInstallationsOverviewSchema.nullable())
			.query(async ({ ctx, input }) => {
				return await ctx.managerApi.getInstallationsOverview(input?.workspaceId);
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
		gitIdentity: t.procedure.output(RuntimeManagerGitIdentitySchema).query(async () => {
			return await resolveGitIdentity();
		}),
		createUsageAuthSession: t.procedure
			.input(RuntimeManagerUsageAuthSessionCreateRequestSchema)
			.output(RuntimeManagerUsageAuthSessionCreateResponseSchema)
			.mutation(async ({ input }) => {
				try {
					return await createUsageAuthSession(input.authLink, {
						sessionId: input.sessionId,
						authType: input.authType,
						sender: input.sender,
						receiver: input.receiver,
						accountName: input.accountName,
					});
				} catch (err) {
					throw new TRPCError({
						code: "BAD_GATEWAY",
						message: err instanceof Error ? err.message : "Could not create authorization form session",
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
	html: t.router({
		status: t.procedure.output(RuntimeHtmlStatusSchema).query(async ({ ctx }) => {
			return await ctx.htmlApi.status();
		}),
		templates: t.procedure.output(RuntimeHtmlTemplateSchema.array()).query(async ({ ctx }) => {
			return await ctx.htmlApi.templates();
		}),
		templateExample: t.procedure
			.input(z.object({ id: z.string().min(1) }))
			.output(RuntimeHtmlTemplateExampleSchema.nullable())
			.query(async ({ ctx, input }) => {
				return await ctx.htmlApi.templateExample(input.id);
			}),
	}),
	claude: t.router({
		usage: t.procedure.output(RuntimeClaudeUsageSchema).query(async ({ ctx }) => {
			return await ctx.claudeUsageApi.get();
		}),
	}),
	flowise: t.router({
		status: t.procedure.output(RuntimeFlowiseStatusSchema).query(async ({ ctx }) => {
			return await ctx.flowiseApi.status();
		}),
		flows: t.procedure.output(RuntimeFlowiseFlowSchema.array()).query(async ({ ctx }) => {
			return await ctx.flowiseApi.flows();
		}),
		llmProxyStatus: t.procedure.output(RuntimeFlowiseLlmProxyStatusSchema).query(async ({ ctx }) => {
			return await ctx.flowiseApi.llmProxyStatus();
		}),
	}),
	openmaic: t.router({
		status: t.procedure.output(RuntimeOpenmaicStatusSchema).query(async ({ ctx }) => {
			return await ctx.openmaicApi.status();
		}),
	}),
	orchestrator: t.router({
		status: t.procedure.output(RuntimeOrchestratorStatusSchema).query(async ({ ctx }) => {
			return await ctx.orchestratorApi.status();
		}),
	}),
	docSkill: t.router({
		status: t.procedure.output(RuntimeDocSkillStatusSchema).query(async ({ ctx }) => {
			return await ctx.docSkillApi.status();
		}),
		projects: t.procedure.output(RuntimeDocProjectSchema.array()).query(async ({ ctx }) => {
			return await ctx.docSkillApi.projects();
		}),
		createProject: t.procedure
			.input(RuntimeDocProjectCreateRequestSchema)
			.output(RuntimeDocProjectSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.docSkillApi.createProject(input);
			}),
	}),
	gitlab: t.router({
		status: t.procedure.output(runtimeGitlabConnectionSchema).query(async ({ ctx }) => {
			return await ctx.gitlabApi.status();
		}),
		connect: t.procedure
			.input(runtimeGitlabConnectStartRequestSchema)
			.output(runtimeGitlabConnectStartResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.gitlabApi.connect(input);
			}),
		connectToken: t.procedure
			.input(runtimeGitlabConnectTokenRequestSchema)
			.output(runtimeGitlabConnectTokenResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.gitlabApi.connectToken(input);
			}),
		connectStatus: t.procedure
			.input(runtimeGitlabConnectStatusRequestSchema)
			.output(runtimeGitlabConnectStatusSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.gitlabApi.connectStatus(input);
			}),
		cancelConnect: t.procedure
			.input(runtimeGitlabConnectStatusRequestSchema)
			.output(runtimeGitlabMutationResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.gitlabApi.cancelConnect(input);
			}),
		disconnect: t.procedure.output(runtimeGitlabMutationResponseSchema).mutation(async ({ ctx }) => {
			return await ctx.gitlabApi.disconnect();
		}),
		listProjects: t.procedure
			.input(runtimeGitlabProjectListRequestSchema)
			.output(runtimeGitlabProjectListResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.gitlabApi.listProjects(input);
			}),
		listMergeRequests: t.procedure
			.input(runtimeGitlabMergeRequestListRequestSchema)
			.output(runtimeGitlabMergeRequestListResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.gitlabApi.listMergeRequests(input);
			}),
		getMergeRequest: t.procedure
			.input(runtimeGitlabMergeRequestRefSchema)
			.output(runtimeGitlabMergeRequestDetailResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.gitlabApi.getMergeRequest(input);
			}),
		getDiffs: t.procedure
			.input(runtimeGitlabMergeRequestRefSchema)
			.output(runtimeGitlabDiffsResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.gitlabApi.getDiffs(input);
			}),
		getVersions: t.procedure
			.input(runtimeGitlabMergeRequestRefSchema)
			.output(runtimeGitlabMergeRequestVersionsResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.gitlabApi.getVersions(input);
			}),
		getRawFile: t.procedure
			.input(runtimeGitlabRawFileRequestSchema)
			.output(runtimeGitlabRawFileResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.gitlabApi.getRawFile(input);
			}),
		listDiscussions: t.procedure
			.input(runtimeGitlabMergeRequestRefSchema)
			.output(runtimeGitlabDiscussionListResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.gitlabApi.listDiscussions(input);
			}),
		createDiffDiscussion: t.procedure
			.input(runtimeGitlabCreateDiffNoteRequestSchema)
			.output(runtimeGitlabMutationResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.gitlabApi.createDiffDiscussion(input);
			}),
		createNote: t.procedure
			.input(runtimeGitlabCreateNoteRequestSchema)
			.output(runtimeGitlabMutationResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.gitlabApi.createNote(input);
			}),
		resolveDiscussion: t.procedure
			.input(runtimeGitlabResolveDiscussionRequestSchema)
			.output(runtimeGitlabMutationResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.gitlabApi.resolveDiscussion(input);
			}),
		setApproval: t.procedure
			.input(runtimeGitlabMergeRequestRefSchema.extend({ approved: z.boolean() }))
			.output(runtimeGitlabMutationResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.gitlabApi.setApproval(input);
			}),
	}),
	review: t.router({
		getSession: t.procedure
			.input(runtimeReviewSessionReadRequestSchema)
			.output(runtimeReviewSessionResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.reviewApi.getSession(input);
			}),
		saveSession: t.procedure
			.input(runtimeReviewSessionWriteRequestSchema)
			.output(runtimeReviewSessionResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.reviewApi.saveSession(input);
			}),
		listSessionsWithDrafts: t.procedure
			.input(z.object({ host: z.string().min(1) }))
			.output(runtimeReviewSessionSchema.array())
			.query(async ({ ctx, input }) => {
				return await ctx.reviewApi.listSessionsWithDrafts(input);
			}),
		getRules: t.procedure
			.input(runtimeReviewRulesReadRequestSchema)
			.output(runtimeReviewRulesReadResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.reviewApi.getRules(input);
			}),
		getRulesConfig: t.procedure
			.input(runtimeReviewRulesReadRequestSchema)
			.output(runtimeReviewRulesConfigResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.reviewApi.getRulesConfig(input);
			}),
		setRulesConfig: t.procedure
			.input(runtimeReviewRulesConfigSchema)
			.output(runtimeReviewRulesConfigResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.reviewApi.setRulesConfig(input);
			}),
		listCommands: t.procedure
			.input(runtimeReviewCommandsRequestSchema)
			.output(runtimeReviewCommandsResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.reviewApi.listCommands(input);
			}),
		getGraphImpact: t.procedure
			.input(runtimeReviewGraphImpactRequestSchema)
			.output(runtimeReviewGraphImpactResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.reviewApi.getGraphImpact(input);
			}),
		openGraphDashboard: t.procedure
			.input(runtimeReviewGraphDashboardRequestSchema)
			.output(runtimeReviewGraphDashboardResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.reviewApi.openGraphDashboard(input);
			}),
	}),
});

export type RuntimeAppRouter = typeof runtimeAppRouter;
export type RuntimeAppRouterInputs = inferRouterInputs<RuntimeAppRouter>;
export type RuntimeAppRouterOutputs = inferRouterOutputs<RuntimeAppRouter>;
