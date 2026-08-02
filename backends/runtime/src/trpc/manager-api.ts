import type {
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
} from "../core/api-contract";
import type { ManagerClient } from "../manager/manager-client";
import type { ManagerMonitor } from "../manager/manager-monitor";
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
			return await refreshAfter(await deps.client.setFeatureEnabled(input.category, input.name, input.enabled));
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
			return await refreshAfter(await deps.client.validateAccount(input.accountId));
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
