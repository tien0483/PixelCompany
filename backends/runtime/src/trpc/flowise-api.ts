import type { RuntimeFlowiseFlow, RuntimeFlowiseLlmProxyStatus, RuntimeFlowiseStatus } from "../core/api-contract";
import type { FlowiseClient } from "../flowise/flowise-client";
import { findFlowiseRoot } from "../flowise/flowise-endpoint";
import { resolveFlowiseLlmProxyStatus } from "../flowise/flowise-llm-proxy";
import type { RuntimeTrpcContext } from "./app-router";

export interface CreateFlowiseApiDependencies {
	client: FlowiseClient;
}

export function createFlowiseApi(deps: CreateFlowiseApiDependencies): RuntimeTrpcContext["flowiseApi"] {
	return {
		status: async (): Promise<RuntimeFlowiseStatus> => {
			// Read the submodule per call rather than caching it at construction: initializing
			// the fork and building it is exactly the thing a user does *while* the runtime is
			// running, and a cached false would keep the tab saying "not installed" until the
			// next restart.
			const installed = findFlowiseRoot() !== null;
			const live = await deps.client.status();
			return { ...live, installed };
		},
		flows: async (): Promise<RuntimeFlowiseFlow[]> => {
			return (await deps.client.listFlows()) ?? [];
		},
		llmProxyStatus: async (): Promise<RuntimeFlowiseLlmProxyStatus> => {
			return resolveFlowiseLlmProxyStatus();
		},
	};
}
