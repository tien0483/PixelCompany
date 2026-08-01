import type {
	RuntimeJackedAccountAuthorizeCcRequest,
	RuntimeJackedAccountIdRequest,
	RuntimeJackedAccountLaunchCredential,
	RuntimeJackedAccountLaunchDir,
	RuntimeJackedAccountReauthRequest,
	RuntimeJackedAccountReorderRequest,
	RuntimeJackedAccountUpdateRequest,
	RuntimeJackedFeatureToggleRequest,
	RuntimeJackedHookLogs,
	RuntimeJackedInstallationsOverview,
	RuntimeJackedMutationResponse,
	RuntimeJackedPacks,
	RuntimeJackedPackToggleRequest,
	RuntimeJackedOAuthFlowStatus,
	RuntimeJackedOAuthFlowStatusRequest,
	RuntimeJackedOAuthStartRequest,
	RuntimeJackedOAuthStartResponse,
	RuntimeJackedOAuthSubmitCodeRequest,
	RuntimeJackedProvider,
	RuntimeJackedServerLogs,
	RuntimeJackedSessions,
	RuntimeJackedState,
	RuntimeJackedSwapLog,
	RuntimeJackedSwapPauseRequest,
	RuntimeJackedUsageOverview,
} from "../core/api-contract";
import type { JackedClient } from "../jacked/jacked-client";
import type { JackedMonitor } from "../jacked/jacked-monitor";
import type { RuntimeTrpcContext } from "./app-router";

export interface CreateJackedApiDependencies {
	client: JackedClient;
	monitor: JackedMonitor;
}

/**
 * Thin pass-through to claude-jacked.
 *
 * Every mutation refreshes the monitor afterwards rather than optimistically patching
 * cached state: jacked owns the outcome (a toggle can be refused, a swap can stall), so
 * the office should show what jacked actually did.
 */
export function createJackedApi(deps: CreateJackedApiDependencies): RuntimeTrpcContext["jackedApi"] {
	const refreshAfter = async (result: { ok: boolean; error?: string }): Promise<RuntimeJackedMutationResponse> => {
		if (result.ok) {
			await deps.monitor.refresh();
		}
		return result.error === undefined ? { ok: result.ok } : { ok: result.ok, error: result.error };
	};

	const MANAGED_PROVIDERS = new Set<RuntimeJackedProvider>(["claude", "cursor"]);

	const lookupManagedAccount = async (accountId: number) => {
		const state = deps.monitor.getState() ?? (await deps.monitor.refresh());
		if (state === null) {
			return { account: null, error: "Jacked is offline." as const };
		}
		const account = state.accounts.find((entry) => entry.id === accountId) ?? null;
		if (!account || !MANAGED_PROVIDERS.has(account.provider)) {
			return { account: null, error: "Account is not available from PixelOffice." as const };
		}
		return { account, error: null };
	};

	const refuseUnmanagedAccount = async (
		accountId: number,
	): Promise<RuntimeJackedMutationResponse | null> => {
		const lookup = await lookupManagedAccount(accountId);
		if (lookup.error !== null) {
			return { ok: false, error: lookup.error };
		}
		return null;
	};

	const refuseNonClaudeAccount = async (
		accountId: number,
	): Promise<RuntimeJackedMutationResponse | null> => {
		const lookup = await lookupManagedAccount(accountId);
		if (lookup.error !== null) {
			return { ok: false, error: lookup.error };
		}
		if (lookup.account?.provider !== "claude") {
			return { ok: false, error: "Only Claude accounts support this action." };
		}
		return null;
	};

	const refuseNonCursorAccount = async (
		accountId: number,
	): Promise<RuntimeJackedMutationResponse | null> => {
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
		getState: async (): Promise<RuntimeJackedState> => {
			return deps.monitor.getState() ?? (await deps.monitor.refresh());
		},
		setFeatureEnabled: async (input: RuntimeJackedFeatureToggleRequest) => {
			return await refreshAfter(await deps.client.setFeatureEnabled(input.category, input.name, input.enabled));
		},
		pauseSwap: async (input: RuntimeJackedSwapPauseRequest) => {
			return await refreshAfter(await deps.client.pauseSwap(input.minutes));
		},
		resumeSwap: async () => {
			return await refreshAfter(await deps.client.resumeSwap());
		},
		useAccount: async (input: RuntimeJackedAccountIdRequest) => {
			const refused = await refuseUnmanagedAccount(input.accountId);
			if (refused !== null) {
				return refused;
			}
			return await refreshAfter(await deps.client.useAccount(input.accountId));
		},
		refreshAccount: async (input: RuntimeJackedAccountIdRequest) => {
			const refused = await refuseUnmanagedAccount(input.accountId);
			if (refused !== null) {
				return refused;
			}
			return await refreshAfter(await deps.client.refreshAccount(input.accountId));
		},
		refreshAllUsage: async () => {
			return await refreshAfter(await deps.client.refreshAllUsage());
		},
		updateAccount: async (input: RuntimeJackedAccountUpdateRequest) => {
			const refused = await refuseUnmanagedAccount(input.accountId);
			if (refused !== null) {
				return refused;
			}
			return await refreshAfter(
				await deps.client.updateAccount({
					accountId: input.accountId,
					...(input.isActive === undefined ? {} : { isActive: input.isActive }),
					...(input.displayName === undefined ? {} : { displayName: input.displayName }),
				}),
			);
		},
		deleteAccount: async (input: RuntimeJackedAccountIdRequest) => {
			const refused = await refuseUnmanagedAccount(input.accountId);
			if (refused !== null) {
				return refused;
			}
			return await refreshAfter(await deps.client.deleteAccount(input.accountId));
		},
		validateAccount: async (input: RuntimeJackedAccountIdRequest) => {
			const refused = await refuseUnmanagedAccount(input.accountId);
			if (refused !== null) {
				return refused;
			}
			return await refreshAfter(await deps.client.validateAccount(input.accountId));
		},
		reorderAccounts: async (input: RuntimeJackedAccountReorderRequest) => {
			for (const accountId of input.accountIds) {
				const refused = await refuseUnmanagedAccount(accountId);
				if (refused !== null) {
					return refused;
				}
			}
			return await refreshAfter(await deps.client.reorderAccounts(input.accountIds));
		},
		startAccountReauth: async (
			input: RuntimeJackedAccountReauthRequest,
		): Promise<RuntimeJackedOAuthStartResponse> => {
			const refused = await refuseNonClaudeAccount(input.accountId);
			if (refused !== null) {
				return { ok: false, error: refused.error ?? "Only Claude accounts support this action." };
			}
			return await deps.client.startAccountReauth(input.accountId, input.remote === true);
		},
		startAccountAuthorizeCc: async (
			input: RuntimeJackedAccountAuthorizeCcRequest,
		): Promise<RuntimeJackedOAuthStartResponse> => {
			const refused = await refuseNonClaudeAccount(input.accountId);
			if (refused !== null) {
				return { ok: false, error: refused.error ?? "Only Claude accounts support this action." };
			}
			return await deps.client.startAccountAuthorizeCc(input.accountId, input.remote === true);
		},
		getActiveSessions: async (): Promise<RuntimeJackedSessions | null> => {
			return await deps.client.fetchActiveSessions();
		},
		getPacks: async (): Promise<RuntimeJackedPacks | null> => {
			return await deps.client.fetchPacks();
		},
		setPackEnabled: async (input: RuntimeJackedPackToggleRequest) => {
			// No monitor refresh: packs live outside the account snapshot, and the
			// Training shelf refetches the pack list itself after a toggle.
			return await deps.client.setPackEnabled(input.name, input.enabled);
		},
		getAccountLaunchDir: async (
			input: RuntimeJackedAccountIdRequest,
		): Promise<RuntimeJackedAccountLaunchDir | null> => {
			const refused = await refuseNonClaudeAccount(input.accountId);
			if (refused !== null) {
				return null;
			}
			return await deps.client.fetchAccountLaunchDir(input.accountId);
		},
		getAccountLaunchCredential: async (
			input: RuntimeJackedAccountIdRequest,
		): Promise<RuntimeJackedAccountLaunchCredential | null> => {
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
		reimportCursorAccount: async (input: RuntimeJackedAccountIdRequest) => {
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
		getAccountProvider: async (accountId: number): Promise<RuntimeJackedProvider | null> => {
			const lookup = await lookupManagedAccount(accountId);
			return lookup.account?.provider ?? null;
		},
		getInstallationsOverview: async (): Promise<RuntimeJackedInstallationsOverview | null> => {
			return await deps.client.fetchInstallationsOverview();
		},
		getServerLogs: async (limit?: number): Promise<RuntimeJackedServerLogs | null> => {
			return await deps.client.fetchServerLogs(limit);
		},
		getHookLogs: async (limit?: number): Promise<RuntimeJackedHookLogs | null> => {
			return await deps.client.fetchHookLogs(limit);
		},
		getUsageOverview: async (days?: number): Promise<RuntimeJackedUsageOverview | null> => {
			return await deps.client.fetchUsageOverview(days);
		},
		getSwapLog: async (limit?: number): Promise<RuntimeJackedSwapLog | null> => {
			return await deps.client.fetchSwapLog(limit);
		},
		startClaudeOAuth: async (input?: RuntimeJackedOAuthStartRequest): Promise<RuntimeJackedOAuthStartResponse> => {
			return await deps.client.startClaudeOAuth(input?.remote === true);
		},
		getOAuthFlowStatus: async (
			input: RuntimeJackedOAuthFlowStatusRequest,
		): Promise<RuntimeJackedOAuthFlowStatus | null> => {
			const result = await deps.client.getOAuthFlowStatus(input.flowId);
			if (result?.status === "completed") {
				await deps.monitor.refresh();
			}
			return result;
		},
		submitOAuthCode: async (
			input: RuntimeJackedOAuthSubmitCodeRequest,
		): Promise<RuntimeJackedOAuthFlowStatus | null> => {
			const result = await deps.client.submitOAuthCode(input.flowId, input.code);
			if (result?.status === "completed") {
				await deps.monitor.refresh();
			}
			return result;
		},
	};
}
