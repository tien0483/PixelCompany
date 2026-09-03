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
				// `npx` is on virtually every machine, so counting it as an install made the sidebar
				// report the Custom Agent ready wherever dsh was absent. Only a real binary counts.
				installed: binary !== null && !binary.viaNpx && patchPath !== null,
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
	if (input.binary === null || input.binary.viaNpx) {
		hints.push("Install dsh: npm install -g @deepseek-ai/dsh (or set PIXTIEL_DSH_BINARY).");
	}
	if (input.binary?.viaNpx) {
		hints.push(
			"Only npx is available — a launch would resolve the whole harness first (minutes, and a V8 heap OOM under the default 2 GB cap). Install dsh properly.",
		);
	}
	if (input.patchPath === null) {
		hints.push("Missing Custom Agent patch at backends/runtime/config/orchestrator/pixeloffice.patch.yml.");
	}
	if (!input.subagentsInstalled) {
		hints.push("Product plugins installing in $DSH_HOME/profiles/headless — retry after solo finishes the install.");
	}
	if (!input.flowiseOnline) {
		hints.push("Flowise offline — Agents tab flows unavailable until pnpm start starts the studio.");
	}
	if (input.binary !== null && !input.binary.viaNpx && input.patchPath !== null) {
		hints.push("Pick agent Custom Agent (dsh) on a task card for cross-provider delegation.");
		hints.push("Wire Flowise: pick a deployed flow under Custom agent (flow) on the card — dsh mounts it as a tool.");
	}
	return hints;
}
