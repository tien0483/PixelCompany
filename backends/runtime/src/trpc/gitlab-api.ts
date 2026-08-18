import type {
	RuntimeGitlabConnectStartRequest,
	RuntimeGitlabConnectStartResponse,
	RuntimeGitlabConnectStatus,
	RuntimeGitlabConnection,
	RuntimeGitlabCreateDiffNoteRequest,
	RuntimeGitlabCreateNoteRequest,
	RuntimeGitlabDiffsResponse,
	RuntimeGitlabDiscussionListResponse,
	RuntimeGitlabMergeRequestDetailResponse,
	RuntimeGitlabMergeRequestListRequest,
	RuntimeGitlabMergeRequestListResponse,
	RuntimeGitlabMergeRequestRef,
	RuntimeGitlabMergeRequestVersionsResponse,
	RuntimeGitlabMutationResponse,
	RuntimeGitlabProjectListRequest,
	RuntimeGitlabProjectListResponse,
	RuntimeGitlabRawFileRequest,
	RuntimeGitlabRawFileResponse,
	RuntimeGitlabResolveDiscussionRequest,
} from "../core/api-contract";
import { type GitlabClient, describeGitlabFailure } from "../gitlab/gitlab-client";
import { clearGitlabCredential, type GitlabCredential } from "../gitlab/gitlab-credentials";
import type { GitlabOauthSession } from "../gitlab/gitlab-oauth";
import type { RuntimeTrpcContext } from "./app-router";

const DISCONNECTED: RuntimeGitlabConnection = {
	connected: false,
	host: null,
	username: null,
	name: null,
	userId: null,
	expiresAt: null,
};

export function toConnection(credential: GitlabCredential | null): RuntimeGitlabConnection {
	if (!credential) {
		return DISCONNECTED;
	}
	return {
		// A credential awaiting re-authorization is reported as not connected: every
		// call it could make would fail, and a green "connected" badge over a dead
		// token is the worst of the three states to show.
		connected: credential.reauthRequired !== true,
		host: credential.host,
		username: credential.username,
		name: credential.name,
		userId: credential.userId,
		expiresAt: credential.expiresAt,
		...(credential.reauthRequired === true ? { reauthRequired: true } : {}),
	};
}

export interface CreateGitlabApiDependencies {
	client: GitlabClient;
	oauth: GitlabOauthSession;
	openInBrowser: (url: string) => void;
	warn: (message: string) => void;
}

/**
 * Unlike `docSkillApi`, failures are returned as `{ ok: false, error }` rather
 * than thrown. The Review surface renders several of these panels side by side,
 * and a thrown tRPC error takes the whole panel down with it — a per-panel error
 * line keeps the rest of the review usable when, say, discussions fail but the
 * diff loaded fine.
 */
export function createGitlabApi(deps: CreateGitlabApiDependencies): RuntimeTrpcContext["gitlabApi"] {
	const { client, oauth } = deps;

	const fail = (error: unknown): string =>
		error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown GitLab error.";

	return {
		status: async (): Promise<RuntimeGitlabConnection> => toConnection(await client.getCredential()),

		connect: async (input: RuntimeGitlabConnectStartRequest): Promise<RuntimeGitlabConnectStartResponse> => {
			try {
				const flow = await oauth.start({ host: input.host, warn: deps.warn });
				deps.openInBrowser(flow.authorizeUrl);
				return { ok: true, authorizeUrl: flow.authorizeUrl, flowId: flow.flowId };
			} catch (error) {
				const message = fail(error);
				deps.warn(`GitLab connect failed: ${message}`);
				return { ok: false, error: message };
			}
		},

		connectStatus: async (input: { flowId: string }): Promise<RuntimeGitlabConnectStatus> => {
			const state = oauth.getState(input.flowId);
			if (state.state === "connected") {
				return { state: "connected", connection: toConnection(state.credential) };
			}
			if (state.state === "failed") {
				return { state: "failed", connection: null, error: state.error };
			}
			return { state: "pending", connection: null };
		},

		disconnect: async (): Promise<RuntimeGitlabMutationResponse> => {
			try {
				await clearGitlabCredential();
				return { ok: true };
			} catch (error) {
				return { ok: false, error: fail(error) };
			}
		},

		listProjects: async (input: RuntimeGitlabProjectListRequest): Promise<RuntimeGitlabProjectListResponse> => {
			const result = await client.listProjects(input);
			return result.ok
				? { ok: true, projects: result.value }
				: { ok: false, projects: [], error: describeGitlabFailure(result.failure) };
		},

		listMergeRequests: async (
			input: RuntimeGitlabMergeRequestListRequest,
		): Promise<RuntimeGitlabMergeRequestListResponse> => {
			const result = await client.listMergeRequests(input);
			return result.ok
				? { ok: true, mergeRequests: result.value }
				: { ok: false, mergeRequests: [], error: describeGitlabFailure(result.failure) };
		},

		getMergeRequest: async (
			input: RuntimeGitlabMergeRequestRef,
		): Promise<RuntimeGitlabMergeRequestDetailResponse> => {
			const result = await client.getMergeRequest(input);
			return result.ok
				? { ok: true, mergeRequest: result.value }
				: { ok: false, mergeRequest: null, error: describeGitlabFailure(result.failure) };
		},

		getDiffs: async (input: RuntimeGitlabMergeRequestRef): Promise<RuntimeGitlabDiffsResponse> => {
			const result = await client.getMergeRequestDiffs(input);
			return result.ok
				? { ok: true, files: result.value.files, diffRefs: result.value.diffRefs, truncated: result.value.truncated }
				: { ok: false, files: [], diffRefs: null, truncated: false, error: describeGitlabFailure(result.failure) };
		},

		getVersions: async (
			input: RuntimeGitlabMergeRequestRef,
		): Promise<RuntimeGitlabMergeRequestVersionsResponse> => {
			const result = await client.getMergeRequestVersions(input);
			return result.ok
				? { ok: true, versions: result.value }
				: { ok: false, versions: [], error: describeGitlabFailure(result.failure) };
		},

		getRawFile: async (input: RuntimeGitlabRawFileRequest): Promise<RuntimeGitlabRawFileResponse> => {
			const result = await client.getRawFile(input);
			return result.ok
				? { ok: true, content: result.value }
				: { ok: false, content: null, error: describeGitlabFailure(result.failure) };
		},

		listDiscussions: async (
			input: RuntimeGitlabMergeRequestRef,
		): Promise<RuntimeGitlabDiscussionListResponse> => {
			const result = await client.listDiscussions(input);
			return result.ok
				? { ok: true, discussions: result.value }
				: { ok: false, discussions: [], error: describeGitlabFailure(result.failure) };
		},

		createDiffDiscussion: async (
			input: RuntimeGitlabCreateDiffNoteRequest,
		): Promise<RuntimeGitlabMutationResponse> => {
			const result = await client.createDiffDiscussion(input);
			return result.ok ? { ok: true } : { ok: false, error: describeGitlabFailure(result.failure) };
		},

		createNote: async (input: RuntimeGitlabCreateNoteRequest): Promise<RuntimeGitlabMutationResponse> => {
			const result = await client.createNote(input);
			return result.ok ? { ok: true } : { ok: false, error: describeGitlabFailure(result.failure) };
		},

		resolveDiscussion: async (
			input: RuntimeGitlabResolveDiscussionRequest,
		): Promise<RuntimeGitlabMutationResponse> => {
			const result = await client.resolveDiscussion(input);
			return result.ok ? { ok: true } : { ok: false, error: describeGitlabFailure(result.failure) };
		},

		setApproval: async (
			input: RuntimeGitlabMergeRequestRef & { approved: boolean },
		): Promise<RuntimeGitlabMutationResponse> => {
			const result = await client.setApproval(input);
			return result.ok ? { ok: true } : { ok: false, error: describeGitlabFailure(result.failure) };
		},
	};
}
