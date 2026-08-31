import type { RuntimeOrchestratorStatus } from "../core/api-contract";
import type { OrchestratorClient } from "../orchestrator/orchestrator-client";

export interface CreateOrchestratorApiDependencies {
	client: OrchestratorClient;
}

export function createOrchestratorApi(
	deps: CreateOrchestratorApiDependencies,
): { status: () => Promise<RuntimeOrchestratorStatus> } {
	return {
		status: async (): Promise<RuntimeOrchestratorStatus> => {
			return await deps.client.status();
		},
	};
}
