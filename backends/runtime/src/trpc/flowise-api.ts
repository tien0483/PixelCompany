import type {
	RuntimeFlowiseFlow,
	RuntimeFlowiseLlmProxyStatus,
	RuntimeFlowiseStatus,
} from "../core/api-contract";
import type { ClineApiSeatCredentials } from "../cline-sdk/cline-provider-service";
import type { FlowiseClient } from "../flowise/flowise-client";
import { findFlowiseRoot } from "../flowise/flowise-endpoint";
import { resolveFlowiseLlmProxyStatus } from "../flowise/flowise-llm-proxy";
import type { ManagerMonitor } from "../manager/manager-monitor";
import type { RuntimeTrpcContext } from "./app-router";

export interface CreateFlowiseApiDependencies {
	client: FlowiseClient;
	monitor: ManagerMonitor;
	getAccountLaunchDir: (accountId: number) => Promise<{ configDir: string } | null>;
	getAccountLaunchCredential: (accountId: number) => Promise<{ apiKey: string } | null>;
	useManagerAccount: (accountId: number) => Promise<boolean>;
	resolveApiSeatCredentials: (providerId: string) => Promise<ClineApiSeatCredentials | null>;
}

export function createFlowiseApi(deps: CreateFlowiseApiDependencies): RuntimeTrpcContext["flowiseApi"] {
	const seatDeps = {
		monitor: deps.monitor,
		getAccountLaunchDir: deps.getAccountLaunchDir,
		getAccountLaunchCredential: deps.getAccountLaunchCredential,
		useManagerAccount: deps.useManagerAccount,
		resolveApiSeatCredentials: deps.resolveApiSeatCredentials,
	};
	return {
		status: async (): Promise<RuntimeFlowiseStatus> => {
			const installed = findFlowiseRoot() !== null;
			const live = await deps.client.status();
			return { ...live, installed };
		},
		flows: async (): Promise<RuntimeFlowiseFlow[]> => {
			return (await deps.client.listFlows()) ?? [];
		},
		llmProxyStatus: async (): Promise<RuntimeFlowiseLlmProxyStatus> => {
			return await resolveFlowiseLlmProxyStatus(seatDeps);
		},
	};
}
