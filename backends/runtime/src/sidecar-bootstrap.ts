// Spawns optional sidecars after the runtime HTTP server is listening so slow or
// missing services (OmniRoute, Flowise, OpenMAIC, stack daemons, …) never delay
// first paint on :3484.

import { join } from "node:path";

import type { DocSkillProcess } from "./doc-skill/doc-skill-process";
import type { FlowiseProcess } from "./flowise/flowise-process";
import type { HtmlProcess } from "./html/html-process";
import type { OmniRouteProcess } from "./omniroute/omniroute-process";
import type { OpenmaicProcess } from "./openmaic/openmaic-process";
import type { OrchestratorProcess } from "./orchestrator/orchestrator-process";
import { linkStackSkillsAtStartup } from "./stack/link-stack-skills-runtime";
import type { StackProcess } from "./stack/stack-daemon";

export interface ClosableSidecar {
	close: () => Promise<void>;
}

export interface SidecarBundle {
	omniRoute: OmniRouteProcess;
	html: HtmlProcess;
	stack: StackProcess;
	headroom: StackProcess;
	ccr: StackProcess;
	devTools: StackProcess;
	docSkill: DocSkillProcess;
	flowise: FlowiseProcess;
	openmaic: OpenmaicProcess;
	orchestrator: OrchestratorProcess;
}

function noopSidecar(): ClosableSidecar {
	return { close: async () => {} };
}

export function createNoopSidecarBundle(): SidecarBundle {
	const noop = noopSidecar();
	return {
		omniRoute: noop as OmniRouteProcess,
		html: noop as HtmlProcess,
		stack: noop as StackProcess,
		headroom: noop as StackProcess,
		ccr: noop as StackProcess,
		devTools: noop as StackProcess,
		docSkill: noop as DocSkillProcess,
		flowise: noop as FlowiseProcess,
		openmaic: noop as OpenmaicProcess,
		orchestrator: noop as OrchestratorProcess,
	};
}

export async function closeSidecarBundle(bundle: SidecarBundle): Promise<void> {
	await bundle.omniRoute.close();
	await bundle.html.close();
	await bundle.stack.close();
	await bundle.headroom.close();
	await bundle.ccr.close();
	await bundle.devTools.close();
	await bundle.docSkill.close();
	await bundle.flowise.close();
	await bundle.openmaic.close();
	await bundle.orchestrator.close();
}

export interface SidecarLogging {
	warn: (message: string) => void;
	log: (message: string) => void;
}

export interface BootstrapOptionalSidecarsDependencies extends SidecarLogging {
	expectedTemplateSkillsDir?: string;
}

/**
 * Starts every optional sidecar in parallel. Call only after the runtime server
 * is listening — callers must not await this on the critical path to first paint.
 */
export async function bootstrapOptionalSidecars(
	deps: BootstrapOptionalSidecarsDependencies,
): Promise<SidecarBundle> {
	const [
		{ startOmniRouteProcess },
		{ startHtmlProcess },
		{ startStackProcess },
		{ startHeadroomProcess },
		{ startCcrProcess, startDevToolsProcess },
		{ startDocSkillProcess },
		{ startFlowiseProcess },
		{ startOpenmaicProcess },
		{ startOrchestratorProcess },
	] = await Promise.all([
		import("./omniroute/omniroute-process.js"),
		import("./html/html-process.js"),
		import("./stack/stack-process.js"),
		import("./stack/headroom-process.js"),
		import("./stack/stack-extra-daemons.js"),
		import("./doc-skill/doc-skill-process.js"),
		import("./flowise/flowise-process.js"),
		import("./openmaic/openmaic-process.js"),
		import("./orchestrator/orchestrator-process.js"),
	]);

	await linkStackSkillsAtStartup({ quiet: true });

	const stackDaemonLogging = {
		warn: deps.warn,
		log: deps.log,
	};

	const [
		omniRoute,
		html,
		stack,
		headroom,
		ccr,
		devTools,
		docSkill,
		flowise,
		openmaic,
		orchestrator,
	] = await Promise.all([
		startOmniRouteProcess({ warn: deps.warn, log: deps.log }),
		startHtmlProcess({
			warn: deps.warn,
			log: deps.log,
			...(deps.expectedTemplateSkillsDir === undefined
				? {}
				: { expectedTemplateSkillsDir: deps.expectedTemplateSkillsDir }),
		}),
		startStackProcess({ warn: deps.warn, log: deps.log }),
		startHeadroomProcess(stackDaemonLogging),
		startCcrProcess(stackDaemonLogging),
		startDevToolsProcess(stackDaemonLogging),
		startDocSkillProcess({ warn: deps.warn, log: deps.log }),
		startFlowiseProcess({ warn: deps.warn, log: deps.log }),
		startOpenmaicProcess({ warn: deps.warn, log: deps.log }),
		startOrchestratorProcess({ warn: deps.warn, log: deps.log }),
	]);

	return {
		omniRoute,
		html,
		stack,
		headroom,
		ccr,
		devTools,
		docSkill,
		flowise,
		openmaic,
		orchestrator,
	};
}

export function attachFlowiseEmbedSeeding(
	bundle: SidecarBundle,
	deps: SidecarLogging & {
		flowiseClientBaseUrl: string;
		resolveFlowiseDataDir: () => string | null;
		// Returns whether it seeded; the caller does not care, so keep the dep type
		// wide enough for the real implementation (which resolves a boolean).
		seedFlowiseEmbedAccount: (input: {
			baseUrl: string;
			dataDir: string;
			warn: (message: string) => void;
			log: (message: string) => void;
		}) => Promise<unknown>;
	},
): void {
	void bundle.flowise.ready.then(async (isUp) => {
		const dataDir = deps.resolveFlowiseDataDir();
		if (!isUp || dataDir === null) {
			return;
		}
		await deps.seedFlowiseEmbedAccount({
			baseUrl: deps.flowiseClientBaseUrl,
			dataDir,
			warn: deps.warn,
			log: deps.log,
		});
	});
}

/** Resolves the template-skills dir used to refuse foreign HTML sidecars. */
export function resolveExpectedTemplateSkillsDir(
	findAgentDataRoot: () => string | null,
): string | undefined {
	const agentDataRoot = findAgentDataRoot();
	return agentDataRoot === null ? undefined : join(agentDataRoot, "templates", "skills");
}
