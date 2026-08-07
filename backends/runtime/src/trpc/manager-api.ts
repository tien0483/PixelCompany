import type {
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
} from "../core/api-contract";
import type { ManagerClient } from "../manager/manager-client";
import type { ManagerMonitor } from "../manager/manager-monitor";
import {
	getWorkspaceManagerFeatures,
	loadWorkspaceContextById,
	setWorkspaceManagerFeature,
} from "../state/workspace-state";
import type { RuntimeTrpcContext } from "./app-router";

export interface CreateManagerApiDependencies {
	client: ManagerClient;
	monitor: ManagerMonitor;
}

/**
 * Thin pass-through to Manager.
 *
 * Every mutation refreshes the monitor afterwards rather than optimistically patching
 * cached state: Manager owns the outcome (a toggle can be refused, a swap can stall), so
 * the office should show what Manager actually did.
 */
export function createManagerApi(deps: CreateManagerApiDependencies): RuntimeTrpcContext["managerApi"] {
	const refreshAfter = async (result: { ok: boolean; error?: string }): Promise<RuntimeManagerMutationResponse> => {
		if (result.ok) {
			await deps.monitor.refresh();
		}
		return result.error === undefined ? { ok: result.ok } : { ok: result.ok, error: result.error };
	};

	/**
	 * Validate always rewrites validation_status/last_error server-side — even
	 * when the verdict is a failure — so the snapshot must be re-read either
	 * way, or the badge keeps showing the pre-check state.
	 */
	const refreshAlways = async (result: {
		ok: boolean;
		verdict: "good" | "bad" | "indeterminate";
		error?: string;
	}): Promise<RuntimeManagerMutationResponse> => {
		await deps.monitor.refresh();
		return { ok: result.ok, verdict: result.verdict, ...(result.error === undefined ? {} : { error: result.error }) };
	};

	/** Hooks are machine-wide, so a project sync only ever replays these three. */
	const isSyncableFeatureCategory = (value: string): value is "agents" | "commands" | "knowledge" =>
		value === "agents" || value === "commands" || value === "knowledge";

	/** Workspace id → attached repo path, or null when unknown / not supplied. */
	const resolveRepoPath = async (workspaceId: string | undefined): Promise<string | null> => {
		const trimmed = workspaceId?.trim();
		if (!trimmed) {
			return null;
		}
		const context = await loadWorkspaceContextById(trimmed);
		return context?.repoPath ?? null;
	};

	const MANAGED_PROVIDERS = new Set<RuntimeManagerProvider>(["claude", "cursor"]);

	const lookupManagedAccount = async (accountId: number) => {
		const state = deps.monitor.getState() ?? (await deps.monitor.refresh());
		if (state === null) {
			return { account: null, error: "Manager is offline." as const };
		}
		const account = state.accounts.find((entry) => entry.id === accountId) ?? null;
		if (!account || !MANAGED_PROVIDERS.has(account.provider)) {
			return { account: null, error: "Account is not available from PixelOffice." as const };
		}
		return { account, error: null };
	};

	const refuseUnmanagedAccount = async (accountId: number): Promise<RuntimeManagerMutationResponse | null> => {
		const lookup = await lookupManagedAccount(accountId);
		if (lookup.error !== null) {
			return { ok: false, error: lookup.error };
		}
		return null;
	};

	const refuseNonClaudeAccount = async (accountId: number): Promise<RuntimeManagerMutationResponse | null> => {
		const lookup = await lookupManagedAccount(accountId);
		if (lookup.error !== null) {
			return { ok: false, error: lookup.error };
		}
		if (lookup.account?.provider !== "claude") {
			return { ok: false, error: "Only Claude accounts support this action." };
		}
		return null;
	};

	const refuseNonCursorAccount = async (accountId: number): Promise<RuntimeManagerMutationResponse | null> => {
		const lookup = await lookupManagedAccount(accountId);
		if (lookup.error !== null) {
			return { ok: false, error: lookup.error };
		}
		if (lookup.account?.provider !== "cursor") {
			return { ok: false, error: "Only Cursor accounts support this action." };
		}
		return null;
	};

	return {
		getState: async (): Promise<RuntimeManagerState> => {
			return deps.monitor.getState() ?? (await deps.monitor.refresh());
		},
		setFeatureEnabled: async (input: RuntimeManagerFeatureToggleRequest) => {
			const repoPath = await resolveRepoPath(input.workspaceId);
			const result = await refreshAfter(
				await deps.client.setFeatureEnabled(input.category, input.name, input.enabled, repoPath),
			);
			// Record intent only once Manager confirms the write, and only for a
			// project-scoped toggle — hook features are machine-wide.
			const workspaceId = input.workspaceId?.trim();
			if (result.ok && workspaceId && repoPath !== null && input.category !== "hooks") {
				await setWorkspaceManagerFeature(workspaceId, `${input.category}/${input.name}`, input.enabled);
			}
			return result;
		},
		syncFeaturesToProject: async (
			input: RuntimeManagerSyncFeaturesRequest,
		): Promise<RuntimeManagerSyncFeaturesResponse> => {
			const repoPath = await resolveRepoPath(input.workspaceId);
			if (repoPath === null) {
				return { ok: false, applied: 0, failed: [], error: "That project is no longer attached." };
			}
			const recorded = await getWorkspaceManagerFeatures(input.workspaceId);
			const failed: string[] = [];
			let applied = 0;
			for (const key of recorded) {
				const separator = key.indexOf("/");
				const category = key.slice(0, separator);
				const name = key.slice(separator + 1);
				if (!isSyncableFeatureCategory(category) || name === "") {
					failed.push(key);
					continue;
				}
				const result = await deps.client.setFeatureEnabled(category, name, true, repoPath);
				if (result.ok) {
					applied += 1;
				} else {
					failed.push(key);
				}
			}
			if (applied > 0) {
				await deps.monitor.refresh();
			}
			return { ok: failed.length === 0, applied, failed };
		},
		features: async (input: RuntimeManagerFeaturesRequest): Promise<RuntimeManagerFeaturesResponse> => {
			// Read on demand rather than off the streamed snapshot: the monitor is one
			// shared singleton serving every connected client, so it cannot be pinned to
			// any single client's selected project.
			const repoPath = await resolveRepoPath(input.workspaceId);
			const snapshot = await deps.client.fetchSnapshot(repoPath);
			return {
				features: snapshot?.features ?? [],
				claudeDir: snapshot?.featuresScope?.claudeDir ?? null,
				repoPath: snapshot?.featuresScope?.repoPath ?? repoPath,
			};
		},
		pauseSwap: async (input: RuntimeManagerSwapPauseRequest) => {
			return await refreshAfter(await deps.client.pauseSwap(input.minutes));
		},
		resumeSwap: async () => {
			return await refreshAfter(await deps.client.resumeSwap());
		},
		useAccount: async (input: RuntimeManagerAccountIdRequest) => {
			const refused = await refuseUnmanagedAccount(input.accountId);
			if (refused !== null) {
				return refused;
			}
			return await refreshAfter(await deps.client.useAccount(input.accountId));
		},
		refreshAccount: async (input: RuntimeManagerAccountIdRequest) => {
			const refused = await refuseUnmanagedAccount(input.accountId);
			if (refused !== null) {
				return refused;
			}
			return await refreshAfter(await deps.client.refreshAccount(input.accountId));
		},
		refreshAllUsage: async () => {
			return await refreshAfter(await deps.client.refreshAllUsage());
		},
		reconcileActive: async () => {
			return await refreshAfter(await deps.client.reconcileActive());
		},
		updateAccount: async (input: RuntimeManagerAccountUpdateRequest) => {
			const refused = await refuseUnmanagedAccount(input.accountId);
			if (refused !== null) {
				return refused;
			}
			return await refreshAfter(
				await deps.client.updateAccount({
					accountId: input.accountId,
					...(input.isActive === undefined ? {} : { isActive: input.isActive }),
					...(input.displayName === undefined ? {} : { displayName: input.displayName }),
					...(input.donateLimitPercent === undefined ? {} : { donateLimitPercent: input.donateLimitPercent }),
				}),
			);
		},
		deleteAccount: async (input: RuntimeManagerAccountIdRequest) => {
			const refused = await refuseUnmanagedAccount(input.accountId);
			if (refused !== null) {
				return refused;
			}
			return await refreshAfter(await deps.client.deleteAccount(input.accountId));
		},
		validateAccount: async (input: RuntimeManagerAccountIdRequest) => {
			const refused = await refuseUnmanagedAccount(input.accountId);
			if (refused !== null) {
				return refused;
			}
			return await refreshAlways(await deps.client.validateAccount(input.accountId));
		},
		reorderAccounts: async (input: RuntimeManagerAccountReorderRequest) => {
			for (const accountId of input.accountIds) {
				const refused = await refuseUnmanagedAccount(accountId);
				if (refused !== null) {
					return refused;
				}
			}
			return await refreshAfter(await deps.client.reorderAccounts(input.accountIds));
		},
		startAccountReauth: async (
			input: RuntimeManagerAccountReauthRequest,
		): Promise<RuntimeManagerOAuthStartResponse> => {
			const refused = await refuseNonClaudeAccount(input.accountId);
			if (refused !== null) {
				return { ok: false, error: refused.error ?? "Only Claude accounts support this action." };
			}
			return await deps.client.startAccountReauth(input.accountId, input.remote === true);
		},
		startAccountAuthorizeCc: async (
			input: RuntimeManagerAccountAuthorizeCcRequest,
		): Promise<RuntimeManagerOAuthStartResponse> => {
			const refused = await refuseNonClaudeAccount(input.accountId);
			if (refused !== null) {
				return { ok: false, error: refused.error ?? "Only Claude accounts support this action." };
			}
			return await deps.client.startAccountAuthorizeCc(input.accountId, input.remote === true);
		},
		getActiveSessions: async (): Promise<RuntimeManagerSessions | null> => {
			return await deps.client.fetchActiveSessions();
		},
		getPacks: async (): Promise<RuntimeManagerPacks | null> => {
			return await deps.client.fetchPacks();
		},
		setPackEnabled: async (input: RuntimeManagerPackToggleRequest) => {
			// No monitor refresh: packs live outside the account snapshot, and the
			// Training shelf refetches the pack list itself after a toggle.
			return await deps.client.setPackEnabled(input.name, input.enabled);
		},
		getAccountLaunchDir: async (
			input: RuntimeManagerAccountIdRequest,
		): Promise<RuntimeManagerAccountLaunchDir | null> => {
			const refused = await refuseNonClaudeAccount(input.accountId);
			if (refused !== null) {
				return null;
			}
			return await deps.client.fetchAccountLaunchDir(input.accountId);
		},
		getAccountLaunchCredential: async (
			input: RuntimeManagerAccountIdRequest,
		): Promise<RuntimeManagerAccountLaunchCredential | null> => {
			const refused = await refuseNonCursorAccount(input.accountId);
			if (refused !== null) {
				return null;
			}
			return await deps.client.fetchAccountLaunchCredential(input.accountId);
		},
		importCursorAccount: async () => {
			const result = await deps.client.importCursorAccount();
			if (result.ok) {
				await deps.monitor.refresh();
			}
			return result;
		},
		importClaudeAccount: async () => {
			const result = await deps.client.importClaudeAccount();
			if (result.ok) {
				await deps.monitor.refresh();
			}
			return result;
		},
		reimportCursorAccount: async (input: RuntimeManagerAccountIdRequest) => {
			const refused = await refuseNonCursorAccount(input.accountId);
			if (refused !== null) {
				return refused;
			}
			const result = await deps.client.reimportCursorAccount(input.accountId);
			if (result.ok) {
				await deps.monitor.refresh();
			}
			return result;
		},
		getAccountProvider: async (accountId: number): Promise<RuntimeManagerProvider | null> => {
			const lookup = await lookupManagedAccount(accountId);
			return lookup.account?.provider ?? null;
		},
		getInstallationsOverview: async (): Promise<RuntimeManagerInstallationsOverview | null> => {
			return await deps.client.fetchInstallationsOverview();
		},
		getServerLogs: async (limit?: number): Promise<RuntimeManagerServerLogs | null> => {
			return await deps.client.fetchServerLogs(limit);
		},
		getHookLogs: async (limit?: number): Promise<RuntimeManagerHookLogs | null> => {
			return await deps.client.fetchHookLogs(limit);
		},
		getUsageOverview: async (days?: number): Promise<RuntimeManagerUsageOverview | null> => {
			return await deps.client.fetchUsageOverview(days);
		},
		getSwapLog: async (limit?: number): Promise<RuntimeManagerSwapLog | null> => {
			return await deps.client.fetchSwapLog(limit);
		},
		startClaudeOAuth: async (input?: RuntimeManagerOAuthStartRequest): Promise<RuntimeManagerOAuthStartResponse> => {
			return await deps.client.startClaudeOAuth(input?.remote === true);
		},
		getOAuthFlowStatus: async (
			input: RuntimeManagerOAuthFlowStatusRequest,
		): Promise<RuntimeManagerOAuthFlowStatus | null> => {
			const result = await deps.client.getOAuthFlowStatus(input.flowId);
			if (result?.status === "completed") {
				await deps.monitor.refresh();
			}
			return result;
		},
		submitOAuthCode: async (
			input: RuntimeManagerOAuthSubmitCodeRequest,
		): Promise<RuntimeManagerOAuthFlowStatus | null> => {
			const result = await deps.client.submitOAuthCode(input.flowId, input.code, input.donateLimitPercent);
			if (result?.status === "completed") {
				await deps.monitor.refresh();
			}
			return result;
		},
	};
}
