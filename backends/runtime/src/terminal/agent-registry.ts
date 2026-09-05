import type { RuntimeConfigState } from "../config/runtime-config";
import { deriveLegacyAutonomousModeEnabled } from "../config/agent-launch-options";
import {
	getRuntimeAgentBinaryCandidates,
	getRuntimeLaunchSupportedAgentCatalog,
	RUNTIME_AGENT_CATALOG,
} from "../core/agent-catalog";
import type {
	RuntimeAgentDefinition,
	RuntimeAgentId,
	RuntimeClineProviderSettings,
	RuntimeConfigResponse,
} from "../core/api-contract";
import { resolveDshBinary } from "../orchestrator/dsh-binary";
import { resolveOrchestratorPatchPath } from "../orchestrator/dsh-endpoint";
import { isBinaryAvailableOnPath } from "./command-discovery";

/** What the UI shows for Cline; the real argv is built by `clineAdapter`. */
const CLINE_HARNESS_DISPLAY_COMMAND = "kanban cline-agent";

export interface ResolvedAgentCommand {
	agentId: RuntimeAgentId;
	label: string;
	command: string;
	binary: string;
	args: string[];
}

function getDefaultArgs(agentId: RuntimeAgentId): string[] {
	const entry = RUNTIME_AGENT_CATALOG.find((candidate) => candidate.id === agentId);
	if (!entry) {
		return [];
	}
	return [...entry.baseArgs];
}

function quoteForDisplay(part: string): string {
	if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(part)) {
		return part;
	}
	return JSON.stringify(part);
}

function joinCommand(binary: string, args: string[]): string {
	if (args.length === 0) {
		return binary;
	}
	return [binary, ...args.map(quoteForDisplay)].join(" ");
}

function parseBooleanEnvValue(value: string | undefined): boolean {
	const normalized = value?.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function isRuntimeDebugModeEnabled(): boolean {
	const debugModeValue = process.env.KANBAN_DEBUG_MODE ?? process.env.DEBUG_MODE ?? process.env.debug_mode;
	return parseBooleanEnvValue(debugModeValue);
}

export function detectInstalledCommands(): string[] {
	const candidates = [
		...new Set(RUNTIME_AGENT_CATALOG.flatMap((entry) => [entry.binary, ...(entry.binaryAliases ?? [])])),
		"npx",
	];
	const detected: string[] = [];

	for (const candidate of candidates) {
		if (isBinaryAvailableOnPath(candidate)) {
			detected.push(candidate);
		}
	}

	return detected;
}

function getCuratedDefinitions(runtimeConfig: RuntimeConfigState, detected: string[]): RuntimeAgentDefinition[] {
	const detectedSet = new Set(detected);
	return getRuntimeLaunchSupportedAgentCatalog().map((entry) => {
		const defaultArgs = getDefaultArgs(entry.id);
		const binary =
			entry.id === "cline"
				? CLINE_HARNESS_DISPLAY_COMMAND
				: (getRuntimeAgentBinaryCandidates(entry.id).find((candidate) => detectedSet.has(candidate)) ?? entry.binary);
		const command = joinCommand(binary, defaultArgs);
		const hasDetectedBinary = getRuntimeAgentBinaryCandidates(entry.id).some((candidate) =>
			detectedSet.has(candidate),
		);
		let isInstalled = entry.id === "cline" ? true : hasDetectedBinary;
		if (entry.id === "orchestrator") {
			isInstalled = resolveDshBinary() !== null && resolveOrchestratorPatchPath() !== null;
		}
		return {
			id: entry.id,
			label: entry.label,
			binary,
			command,
			defaultArgs,
			installed: isInstalled,
			configured: runtimeConfig.selectedAgentId === entry.id,
		};
	});
}

export function resolveAgentCommand(runtimeConfig: RuntimeConfigState): ResolvedAgentCommand | null {
	const selected = getRuntimeLaunchSupportedAgentCatalog().find((entry) => entry.id === runtimeConfig.selectedAgentId);
	if (!selected) {
		return null;
	}
	const defaultArgs = getDefaultArgs(selected.id);
	if (selected.id === "cline") {
		// Cline's harness is this runtime's own `kanban cline-agent` subcommand, so there is
		// nothing on PATH to probe — the catalog's `binary: "cline"` is a display name only, and
		// `clineAdapter` replaces it with the resolved node + entrypoint pair at launch.
		return {
			agentId: selected.id,
			label: selected.label,
			command: joinCommand(CLINE_HARNESS_DISPLAY_COMMAND, defaultArgs),
			binary: CLINE_HARNESS_DISPLAY_COMMAND,
			args: defaultArgs,
		};
	}
	const binary = getRuntimeAgentBinaryCandidates(selected.id).find((candidate) => isBinaryAvailableOnPath(candidate));
	if (binary) {
		const command = joinCommand(binary, defaultArgs);
		return {
			agentId: selected.id,
			label: selected.label,
			command,
			binary,
			args: defaultArgs,
		};
	}
	return null;
}

export function buildRuntimeConfigResponse(
	runtimeConfig: RuntimeConfigState,
	clineProviderSettings: RuntimeClineProviderSettings,
): RuntimeConfigResponse {
	const detectedCommands = detectInstalledCommands();
	const agents = getCuratedDefinitions(runtimeConfig, detectedCommands);
	const resolved = resolveAgentCommand(runtimeConfig);
	const effectiveCommand = resolved ? joinCommand(resolved.binary, resolved.args) : null;

	return {
		selectedAgentId: runtimeConfig.selectedAgentId,
		selectedShortcutLabel: runtimeConfig.selectedShortcutLabel,
		defaultSubagentSeatProviderId: runtimeConfig.defaultSubagentSeatProviderId,
		defaultSubagentSeatModelId: runtimeConfig.defaultSubagentSeatModelId,
		agentLaunchOptions: runtimeConfig.agentLaunchOptions,
		agentAutonomousModeEnabled: deriveLegacyAutonomousModeEnabled(
			runtimeConfig.selectedAgentId,
			runtimeConfig.agentLaunchOptions,
		),
		debugModeEnabled: isRuntimeDebugModeEnabled(),
		effectiveCommand,
		globalConfigPath: runtimeConfig.globalConfigPath,
		projectConfigPath: runtimeConfig.projectConfigPath,
		readyForReviewNotificationsEnabled: runtimeConfig.readyForReviewNotificationsEnabled,
		detectedCommands,
		agents,
		shortcuts: runtimeConfig.shortcuts,
		clineProviderSettings,
		commitPromptTemplate: runtimeConfig.commitPromptTemplate,
		openPrPromptTemplate: runtimeConfig.openPrPromptTemplate,
		commitPromptTemplateDefault: runtimeConfig.commitPromptTemplateDefault,
		openPrPromptTemplateDefault: runtimeConfig.openPrPromptTemplateDefault,
		agentDisplayName: runtimeConfig.agentDisplayName,
		seamCommentTagTemplate: runtimeConfig.seamCommentTagTemplate,
		seamCommentTagTemplateDefault: runtimeConfig.seamCommentTagTemplateDefault,
		commitTrailerMode: runtimeConfig.commitTrailerMode,
		commitTrailerTemplate: runtimeConfig.commitTrailerTemplate,
		commitTrailerTemplateDefault: runtimeConfig.commitTrailerTemplateDefault,
	};
}
