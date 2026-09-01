import { getRuntimeAgentCatalogEntry } from "../core/agent-catalog";
import type { RuntimeAgentId } from "../core/api-contract";

export const CLAUDE_LAUNCH_PERMISSION_SETTINGS = ["off", "auto", "plan", "acceptEdits"] as const;
export type ClaudeLaunchPermissionSetting = (typeof CLAUDE_LAUNCH_PERMISSION_SETTINGS)[number];

export const GEMINI_LAUNCH_MODE_SETTINGS = ["off", "accept-edits", "plan"] as const;
export type GeminiLaunchModeSetting = (typeof GEMINI_LAUNCH_MODE_SETTINGS)[number];

export interface RuntimeAgentLaunchOptionEntry {
	autonomousEnabled?: boolean;
	claudePermissionMode?: ClaudeLaunchPermissionSetting;
	geminiSkipPermissions?: boolean;
	geminiMode?: GeminiLaunchModeSetting;
}

export type RuntimeAgentLaunchOptions = Partial<Record<RuntimeAgentId, RuntimeAgentLaunchOptionEntry>>;

const LAUNCH_SUPPORTED_AGENT_IDS: readonly RuntimeAgentId[] = [
	"claude",
	"cursor",
	"gemini",
	"codex",
	"cline",
	"droid",
	"kiro",
	"orchestrator",
];

export const DEFAULT_AGENT_LAUNCH_OPTIONS_WHEN_AUTONOMOUS: RuntimeAgentLaunchOptions = {
	claude: { claudePermissionMode: "auto" },
	cursor: { autonomousEnabled: true },
	gemini: { geminiSkipPermissions: true, geminiMode: "accept-edits" },
	codex: { autonomousEnabled: true },
	cline: { autonomousEnabled: true },
	droid: { autonomousEnabled: true },
	kiro: { autonomousEnabled: true },
};

export const DEFAULT_AGENT_LAUNCH_OPTIONS_WHEN_MANUAL: RuntimeAgentLaunchOptions = {
	claude: { claudePermissionMode: "off" },
	cursor: { autonomousEnabled: false },
	gemini: { geminiSkipPermissions: false, geminiMode: "off" },
	codex: { autonomousEnabled: false },
	cline: { autonomousEnabled: false },
	droid: { autonomousEnabled: false },
	kiro: { autonomousEnabled: false },
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseClaudeLaunchPermissionSetting(value: unknown): ClaudeLaunchPermissionSetting | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	return (CLAUDE_LAUNCH_PERMISSION_SETTINGS as readonly string[]).includes(value)
		? (value as ClaudeLaunchPermissionSetting)
		: undefined;
}

function parseGeminiLaunchModeSetting(value: unknown): GeminiLaunchModeSetting | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	return (GEMINI_LAUNCH_MODE_SETTINGS as readonly string[]).includes(value)
		? (value as GeminiLaunchModeSetting)
		: undefined;
}

function parseAgentLaunchOptionEntry(value: unknown): RuntimeAgentLaunchOptionEntry | null {
	if (!isRecord(value)) {
		return null;
	}
	const entry: RuntimeAgentLaunchOptionEntry = {};
	if (typeof value.autonomousEnabled === "boolean") {
		entry.autonomousEnabled = value.autonomousEnabled;
	}
	const claudePermissionMode = parseClaudeLaunchPermissionSetting(value.claudePermissionMode);
	if (claudePermissionMode !== undefined) {
		entry.claudePermissionMode = claudePermissionMode;
	}
	if (typeof value.geminiSkipPermissions === "boolean") {
		entry.geminiSkipPermissions = value.geminiSkipPermissions;
	}
	const geminiMode = parseGeminiLaunchModeSetting(value.geminiMode);
	if (geminiMode !== undefined) {
		entry.geminiMode = geminiMode;
	}
	return Object.keys(entry).length > 0 ? entry : null;
}

function isRuntimeAgentId(value: string): value is RuntimeAgentId {
	return (LAUNCH_SUPPORTED_AGENT_IDS as readonly string[]).includes(value);
}

export function createDefaultAgentLaunchOptions(autonomousEnabled: boolean): RuntimeAgentLaunchOptions {
	const source = autonomousEnabled
		? DEFAULT_AGENT_LAUNCH_OPTIONS_WHEN_AUTONOMOUS
		: DEFAULT_AGENT_LAUNCH_OPTIONS_WHEN_MANUAL;
	return structuredClone(source);
}

export function normalizeAgentLaunchOptions(
	raw: unknown,
	legacyAutonomousModeEnabled?: boolean,
): RuntimeAgentLaunchOptions {
	if (isRecord(raw)) {
		const normalized: RuntimeAgentLaunchOptions = {};
		for (const [agentId, entryValue] of Object.entries(raw)) {
			if (!isRuntimeAgentId(agentId)) {
				continue;
			}
			const entry = parseAgentLaunchOptionEntry(entryValue);
			if (entry !== null) {
				normalized[agentId] = entry;
			}
		}
		if (Object.keys(normalized).length > 0) {
			return normalized;
		}
	}
	return createDefaultAgentLaunchOptions(legacyAutonomousModeEnabled ?? true);
}

export function getAgentLaunchOptionEntry(
	agentId: RuntimeAgentId,
	options: RuntimeAgentLaunchOptions,
): RuntimeAgentLaunchOptionEntry {
	return options[agentId] ?? createDefaultAgentLaunchOptions(true)[agentId] ?? {};
}

export function resolveAutonomousModeEnabledForLaunch(
	agentId: RuntimeAgentId,
	options: RuntimeAgentLaunchOptions,
): boolean {
	const entry = getAgentLaunchOptionEntry(agentId, options);
	if (agentId === "claude") {
		const mode = entry.claudePermissionMode ?? "auto";
		return mode !== "off";
	}
	if (agentId === "gemini") {
		return entry.geminiSkipPermissions === true || entry.geminiMode === "accept-edits";
	}
	return entry.autonomousEnabled ?? true;
}

export function resolveConfiguredClaudePermissionMode(
	options: RuntimeAgentLaunchOptions,
): ClaudeLaunchPermissionSetting {
	return getAgentLaunchOptionEntry("claude", options).claudePermissionMode ?? "auto";
}

export function resolveGeminiLaunchEntry(options: RuntimeAgentLaunchOptions): {
	skipPermissions: boolean;
	mode: GeminiLaunchModeSetting;
} {
	const entry = getAgentLaunchOptionEntry("gemini", options);
	return {
		skipPermissions: entry.geminiSkipPermissions ?? true,
		mode: entry.geminiMode ?? "accept-edits",
	};
}

export function buildAgentLaunchPreviewArgs(
	agentId: RuntimeAgentId,
	options: RuntimeAgentLaunchOptions,
): string[] {
	if (agentId === "cline") {
		return [];
	}
	if (agentId === "claude") {
		const mode = getAgentLaunchOptionEntry("claude", options).claudePermissionMode ?? "auto";
		if (mode === "off") {
			return [];
		}
		return ["--permission-mode", mode];
	}
	if (agentId === "gemini") {
		const { skipPermissions, mode } = resolveGeminiLaunchEntry(options);
		const args: string[] = [];
		if (skipPermissions) {
			args.push("--dangerously-skip-permissions");
		}
		if (mode === "accept-edits") {
			args.push("--mode", "accept-edits");
		} else if (mode === "plan") {
			args.push("--mode", "plan");
		}
		return args;
	}
	const catalogEntry = getRuntimeAgentCatalogEntry(agentId);
	if (!catalogEntry) {
		return [];
	}
	const enabled = resolveAutonomousModeEnabledForLaunch(agentId, options);
	return enabled ? [...catalogEntry.autonomousArgs] : [];
}

function normalizeEntryForCompare(entry: RuntimeAgentLaunchOptionEntry | undefined): RuntimeAgentLaunchOptionEntry {
	if (!entry) {
		return {};
	}
	const normalized: RuntimeAgentLaunchOptionEntry = {};
	if (entry.autonomousEnabled !== undefined) {
		normalized.autonomousEnabled = entry.autonomousEnabled;
	}
	if (entry.claudePermissionMode !== undefined) {
		normalized.claudePermissionMode = entry.claudePermissionMode;
	}
	if (entry.geminiSkipPermissions !== undefined) {
		normalized.geminiSkipPermissions = entry.geminiSkipPermissions;
	}
	if (entry.geminiMode !== undefined) {
		normalized.geminiMode = entry.geminiMode;
	}
	return normalized;
}

export function areAgentLaunchOptionsEqual(
	left: RuntimeAgentLaunchOptions,
	right: RuntimeAgentLaunchOptions,
): boolean {
	const agentIds = new Set<RuntimeAgentId>([
		...(Object.keys(left) as RuntimeAgentId[]),
		...(Object.keys(right) as RuntimeAgentId[]),
	]);
	for (const agentId of agentIds) {
		const leftEntry = normalizeEntryForCompare(left[agentId]);
		const rightEntry = normalizeEntryForCompare(right[agentId]);
		if (JSON.stringify(leftEntry) !== JSON.stringify(rightEntry)) {
			return false;
		}
	}
	return true;
}

export function deriveLegacyAutonomousModeEnabled(
	selectedAgentId: RuntimeAgentId,
	options: RuntimeAgentLaunchOptions,
): boolean {
	return resolveAutonomousModeEnabledForLaunch(selectedAgentId, options);
}
