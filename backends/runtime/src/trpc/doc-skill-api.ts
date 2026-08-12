import type { RuntimeDocProject, RuntimeDocProjectCreateRequest, RuntimeDocSkillStatus } from "../core/api-contract";
import type { DocSkillClient } from "../doc-skill/doc-skill-client";
import type { RuntimeTrpcContext } from "./app-router";

export interface CreateDocSkillApiDependencies {
	client: DocSkillClient;
}

export function createDocSkillApi(deps: CreateDocSkillApiDependencies): RuntimeTrpcContext["docSkillApi"] {
	return {
		status: async (): Promise<RuntimeDocSkillStatus> => await deps.client.status(),
		projects: async (): Promise<RuntimeDocProject[]> => {
			return (await deps.client.listProjects()) ?? [];
		},
		createProject: async (input: RuntimeDocProjectCreateRequest): Promise<RuntimeDocProject> => {
			const result = await deps.client.createProject(input);
			if (!result.ok) {
				// Mirrors this codebase's tRPC-mutation convention: a client-side failure
				// union becomes a thrown Error here, since tRPC procedures communicate
				// failure via rejection, not a discriminated return value.
				const message =
					result.failure.kind === "http"
						? `Docs sidecar rejected the request (${result.failure.status}): ${result.failure.body}`
						: result.failure.kind === "malformed"
							? `Docs sidecar returned an unexpected response: ${result.failure.body}`
							: result.failure.kind === "timeout"
								? "Docs sidecar timed out."
								: `Docs sidecar unreachable: ${result.failure.message}`;
				throw new Error(message);
			}
			return result.value;
		},
	};
}
