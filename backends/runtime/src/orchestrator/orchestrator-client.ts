import type { RuntimeOrchestratorStatus } from "../core/api-contract";
import { createFlowiseClient } from "../flowise/flowise-client";
import { resolveDshBinary } from "./dsh-binary";
import { resolveDefaultDshHome, resolveOrchestratorPatchPath } from "./dsh-endpoint";
import { probeDshProductSubagentsInstalled } from "./dsh-home-setup";

export interface OrchestratorClient {
	status: () => Promise<RuntimeOrchestratorStatus>;
}

export interface CreateOrchestratorClientDependencies {
	warn: (message: string) => void;
}

export function createOrchestratorClient(deps: CreateOrchestratorClientDependencies): OrchestratorClient {
	const flowiseClient = createFlowiseClient({ warn: deps.warn });
	return {
		status: async (): Promise<RuntimeOrchestratorStatus> => {
			const binary = resolveDshBinary();
			const patchPath = resolveOrchestratorPatchPath();
			const dshHome = resolveDefaultDshHome();
			const flowiseLive = await flowiseClient.status();
			const subagentsInstalled = await probeDshProductSubagentsInstalled(dshHome);
			return {
				installed: binary !== null && patchPath !== null,
				binary: binary?.path ?? null,
				dshHome,
				patchPath,
				flowiseOnline: flowiseLive.online,
				subagentsInstalled,
				hints: buildHints({ binary, patchPath, flowiseOnline: flowiseLive.online, subagentsInstalled }),
			};
		},
	};
}

function buildHints(input: {
	binary: ReturnType<typeof resolveDshBinary>;
	patchPath: string | null;
	flowiseOnline: boolean;
	subagentsInstalled: boolean;
}): string[] {
	const hints: string[] = [];
	if (input.binary === null) {
		hints.push("Install dsh: npm install -g @deepseek-ai/dsh (or set PIXELOFFICE_DSH_BINARY).");
	}
	if (input.patchPath === null) {
		hints.push("Missing Custom Agent patch at backends/runtime/config/orchestrator/pixeloffice.patch.yml.");
	}
	if (!input.subagentsInstalled) {
		hints.push("Product plugins installing in $DSH_HOME/profiles/headless — retry after solo finishes the install.");
	}
	if (!input.flowiseOnline) {
		hints.push("Flowise offline — Agents tab flows unavailable until pnpm run solo starts the studio.");
	}
	if (input.binary !== null && input.patchPath !== null) {
		hints.push("Pick agent Custom Agent (dsh) on a task card for cross-provider delegation.");
		hints.push("Wire Flowise: pick a deployed flow under Custom agent (flow) on the card — dsh mounts it as a tool.");
	}
	return hints;
}
