/**
 * Per-task Model / Effort / Skill / MCP launch tags.
 *
 * Empty skill/MCP arrays inherit Manager/global installs. Non-empty arrays are
 * allowlists applied at Claude launch (scoped CLAUDE_CONFIG_DIR + mcp-config).
 * Cursor gets model/effort flags when supported and a prompt preface for tags.
 */
import { access, copyFile, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type {
	RuntimeMcpInventory,
	RuntimeSkillInventory,
	RuntimeTaskLaunchEffort,
	RuntimeTaskLaunchSettings,
} from "../core/api-contract";
import { getRuntimeHomePath } from "../state/workspace-state";
import { CLAUDE_CONFIG_DIR_ENV } from "../jacked/jacked-account-pin";

const SHARED_SYMLINK_NAMES = ["CLAUDE.md", "plugins", "agents", "commands", "projects"] as const;
const SAFE_CLAUDE_JSON_KEYS = [
	"autoUpdates",
	"autoUpdatesProtectedForNative",
	"showSpinnerTree",
	"claudeInChromeDefaultEnabled",
	"penguinModeOrgEnabled",
	"hasCompletedOnboarding",
	"lastOnboardingVersion",
	"hasSeenTasksHint",
	"hasCompletedClaudeInChromeOnboarding",
	"effortCalloutDismissed",
	"opusProMigrationComplete",
	"sonnet1m45MigrationComplete",
	"officialMarketplaceAutoInstallAttempted",
	"officialMarketplaceAutoInstalled",
	"lastReleaseNotesSeen",
	"installMethod",
] as const;

export function cloneTaskLaunchSettings(
	settings?: RuntimeTaskLaunchSettings | null,
): RuntimeTaskLaunchSettings | undefined {
	if (settings === undefined || settings === null) {
		return undefined;
	}
	const modelId = settings.modelId?.trim();
	const skillIds = normalizeIdList(settings.skillIds);
	const mcpServerIds = normalizeIdList(settings.mcpServerIds);
	const next: RuntimeTaskLaunchSettings = {
		...(modelId ? { modelId } : {}),
		...(settings.effort ? { effort: settings.effort } : {}),
		...(skillIds ? { skillIds } : {}),
		...(mcpServerIds ? { mcpServerIds } : {}),
	};
	if (
		next.modelId === undefined &&
		next.effort === undefined &&
		next.skillIds === undefined &&
		next.mcpServerIds === undefined
	) {
		return undefined;
	}
	return next;
}

function normalizeIdList(ids: string[] | undefined): string[] | undefined {
	if (ids === undefined) {
		return undefined;
	}
	const cleaned = [
		...new Set(
			ids
				.map((id) => id.trim())
				.filter((id) => id.length > 0),
		),
	];
	return cleaned.length > 0 ? cleaned : undefined;
}

export function hasSkillAllowlist(settings?: RuntimeTaskLaunchSettings | null): boolean {
	return (settings?.skillIds?.length ?? 0) > 0;
}

export function hasMcpAllowlist(settings?: RuntimeTaskLaunchSettings | null): boolean {
	return (settings?.mcpServerIds?.length ?? 0) > 0;
}

export function buildCursorLaunchTagPreface(settings?: RuntimeTaskLaunchSettings | null): string | null {
	const skillIds = settings?.skillIds?.filter((id) => id.trim().length > 0) ?? [];
	const mcpServerIds = settings?.mcpServerIds?.filter((id) => id.trim().length > 0) ?? [];
	if (skillIds.length === 0 && mcpServerIds.length === 0) {
		return null;
	}
	const parts: string[] = [
		"Task launch tags (PixelOffice): use only the following allowlisted resources for this session.",
	];
	if (skillIds.length > 0) {
		parts.push(`Skills: ${skillIds.join(", ")}.`);
	}
	if (mcpServerIds.length > 0) {
		parts.push(`MCP servers: ${mcpServerIds.join(", ")}.`);
	}
	parts.push("Do not rely on other installed skills or MCP servers for this task.");
	return parts.join(" ");
}

export function applyModelAndEffortArgs(
	args: string[],
	settings: RuntimeTaskLaunchSettings | undefined,
	options: { effortFlag?: string | null },
): void {
	const modelId = settings?.modelId?.trim();
	if (modelId && !hasCliOption(args, "--model") && !hasCliOption(args, "-m")) {
		args.push("--model", modelId);
	}
	const effort = settings?.effort;
	const effortFlag = options.effortFlag;
	if (effort && effortFlag && !hasCliOption(args, effortFlag)) {
		args.push(effortFlag, effort);
	}
}

function hasCliOption(args: string[], optionName: string): boolean {
	for (const arg of args) {
		if (arg === optionName || arg.startsWith(`${optionName}=`)) {
			return true;
		}
	}
	return false;
}

function globalClaudeDir(): string {
	return join(homedir(), ".claude");
}

function taskLaunchScratchDir(taskId: string): string {
	const slug = taskId.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "session";
	return join(getRuntimeHomePath(), "task-launch", slug);
}

async function pathExists(target: string): Promise<boolean> {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
}

async function ensureSymlink(source: string, target: string, isDirectory: boolean): Promise<void> {
	if (!(await pathExists(source))) {
		return;
	}
	try {
		await rm(target, { recursive: true, force: true });
	} catch {
		// Best effort.
	}
	try {
		await symlink(source, target, isDirectory ? "junction" : "file");
		return;
	} catch {
		try {
			await symlink(source, target, isDirectory ? "dir" : "file");
			return;
		} catch {
			// Windows often blocks file symlinks without Developer Mode. Fall back
			// to a copy so pin credentials and settings still reach the scoped dir.
		}
	}
	if (!isDirectory) {
		try {
			await copyFile(source, target);
		} catch {
			// Non-fatal: launch continues without that shared resource.
		}
	}
}

async function seedClaudeJsonForScopedDir(configDir: string, baseDir: string): Promise<void> {
	const target = join(configDir, ".claude.json");
	// Prefer the prepared pin/account config (already has oauthAccount + onboarding).
	const baseClaudeJson = join(baseDir, ".claude.json");
	if (await pathExists(baseClaudeJson)) {
		await ensureSymlink(baseClaudeJson, target, false);
		if (await pathExists(target)) {
			return;
		}
	}

	// Global Claude Code state lives at ~/.claude.json (NOT ~/.claude/.claude.json).
	// Without hasCompletedOnboarding + oauthAccount here, Claude Code shows the
	// first-run "Select login method" screen even when .credentials.json is present.
	const homeClaudeJson = join(homedir(), ".claude.json");
	let source: Record<string, unknown> = {};
	try {
		const parsed: unknown = JSON.parse(await readFile(homeClaudeJson, "utf8"));
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			source = parsed as Record<string, unknown>;
		}
	} catch {
		source = {};
	}

	const local: Record<string, unknown> = {};
	for (const key of SAFE_CLAUDE_JSON_KEYS) {
		if (key in source) {
			local[key] = source[key];
		}
	}
	if (source.oauthAccount && typeof source.oauthAccount === "object") {
		local.oauthAccount = source.oauthAccount;
	}
	if (source.projects && typeof source.projects === "object") {
		local.projects = source.projects;
	}
	if (local.hasCompletedOnboarding === undefined) {
		local.hasCompletedOnboarding = true;
	}
	await writeFile(target, JSON.stringify(local, null, 2), "utf8");
}

async function writeScopedSettingsJson(
	configDir: string,
	baseDir: string,
	mcpServerIds: string[] | undefined,
): Promise<void> {
	const globalDir = globalClaudeDir();
	const candidates = [join(baseDir, "settings.json"), join(globalDir, "settings.json")];
	let sourcePath: string | null = null;
	for (const candidate of candidates) {
		if (await pathExists(candidate)) {
			sourcePath = candidate;
			break;
		}
	}
	const target = join(configDir, "settings.json");
	if (!sourcePath) {
		return;
	}

	// No MCP allowlist: reuse the Manager/global settings as-is.
	if (!mcpServerIds || mcpServerIds.length === 0) {
		await ensureSymlink(sourcePath, target, false);
		return;
	}

	// MCP allowlist: materialize settings without mcpServers so Claude does not
	// re-discover every global server alongside --mcp-config/--strict-mcp-config.
	let parsed: Record<string, unknown> = {};
	try {
		const raw: unknown = JSON.parse(await readFile(sourcePath, "utf8"));
		if (raw && typeof raw === "object" && !Array.isArray(raw)) {
			parsed = { ...(raw as Record<string, unknown>) };
		}
	} catch {
		parsed = {};
	}
	delete parsed.mcpServers;
	await writeFile(target, JSON.stringify(parsed, null, 2), "utf8");
}

/**
 * Build a short-lived CLAUDE_CONFIG_DIR that inherits pin/global credentials and
 * shared resources, optionally limiting skills and stripping MCP from settings.
 */
export async function prepareClaudeSkillScopedConfigDir(input: {
	taskId: string;
	skillIds?: string[];
	mcpServerIds?: string[];
	/** Existing pin / active-account CLAUDE_CONFIG_DIR, if any. */
	baseConfigDir?: string | null;
}): Promise<{ configDir: string; cleanup: () => Promise<void> }> {
	const globalDir = globalClaudeDir();
	const baseDir = input.baseConfigDir?.trim() || globalDir;
	const configDir = taskLaunchScratchDir(input.taskId);
	await rm(configDir, { recursive: true, force: true }).catch(() => {});
	await mkdir(configDir, { recursive: true });

	for (const name of SHARED_SYMLINK_NAMES) {
		const source = join(baseDir, name);
		const fallback = join(globalDir, name);
		const resolvedSource = (await pathExists(source)) ? source : fallback;
		await ensureSymlink(resolvedSource, join(configDir, name), name !== "CLAUDE.md");
	}

	await writeScopedSettingsJson(configDir, baseDir, input.mcpServerIds);

	// Credentials: prefer the prepared Jacked account dir, else global ~/.claude.
	const credentialCandidates = [join(baseDir, ".credentials.json"), join(globalDir, ".credentials.json")];
	for (const source of credentialCandidates) {
		if (await pathExists(source)) {
			await ensureSymlink(source, join(configDir, ".credentials.json"), false);
			break;
		}
	}
	await seedClaudeJsonForScopedDir(configDir, baseDir);

	const skillsDir = join(configDir, "skills");
	const globalSkills = join(globalDir, "skills");
	const skillAllowlist = (input.skillIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0);
	if (skillAllowlist.length === 0) {
		// Inherit all Manager skills.
		await ensureSymlink(globalSkills, skillsDir, true);
	} else {
		await mkdir(skillsDir, { recursive: true });
		for (const skillId of skillAllowlist) {
			// Jacked feature names use skill_<folder>; disk folders do not.
			const folderName = skillId.startsWith("skill_") ? skillId.slice("skill_".length) : skillId;
			if (!folderName) {
				continue;
			}
			await ensureSymlink(join(globalSkills, folderName), join(skillsDir, folderName), true);
		}
	}

	return {
		configDir,
		cleanup: async () => {
			await rm(configDir, { recursive: true, force: true }).catch(() => {});
		},
	};
}

export async function prepareClaudeMcpAllowlistConfig(input: {
	taskId: string;
	mcpServerIds: string[];
}): Promise<{ mcpConfigPath: string; cleanup: () => Promise<void> } | null> {
	const settingsPath = join(globalClaudeDir(), "settings.json");
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(settingsPath, "utf8"));
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") {
		return null;
	}
	const mcpServers = (parsed as { mcpServers?: unknown }).mcpServers;
	if (!mcpServers || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
		return null;
	}
	const allow = new Set(input.mcpServerIds.map((id) => id.trim()).filter(Boolean));
	const filtered: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(mcpServers as Record<string, unknown>)) {
		if (allow.has(key)) {
			filtered[key] = value;
		}
	}
	const scratch = taskLaunchScratchDir(input.taskId);
	await mkdir(scratch, { recursive: true });
	const mcpConfigPath = join(scratch, "mcp.allowlist.json");
	await writeFile(mcpConfigPath, JSON.stringify({ mcpServers: filtered }, null, 2), "utf8");
	return {
		mcpConfigPath,
		cleanup: async () => {
			await rm(mcpConfigPath, { force: true }).catch(() => {});
		},
	};
}

export async function listClaudeSkillInventory(): Promise<RuntimeSkillInventory> {
	const skillsRoot = join(globalClaudeDir(), "skills");
	const skills: RuntimeSkillInventory["skills"] = [];
	try {
		const entries = await readdir(skillsRoot, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory() && !entry.isSymbolicLink()) {
				continue;
			}
			const id = entry.name.trim();
			if (!id || id.startsWith(".")) {
				continue;
			}
			skills.push({
				id,
				displayName: id,
				source: "disk",
			});
		}
	} catch {
		// No skills dir yet.
	}
	skills.sort((left, right) => left.displayName.localeCompare(right.displayName));
	return { skills };
}

export async function listClaudeMcpInventory(): Promise<RuntimeMcpInventory> {
	const settingsPath = join(globalClaudeDir(), "settings.json");
	const servers: RuntimeMcpInventory["servers"] = [];
	try {
		const parsed: unknown = JSON.parse(await readFile(settingsPath, "utf8"));
		const mcpServers =
			parsed && typeof parsed === "object"
				? (parsed as { mcpServers?: unknown }).mcpServers
				: undefined;
		if (mcpServers && typeof mcpServers === "object" && !Array.isArray(mcpServers)) {
			for (const id of Object.keys(mcpServers as Record<string, unknown>)) {
				const trimmed = id.trim();
				if (!trimmed) {
					continue;
				}
				servers.push({
					id: trimmed,
					displayName: trimmed,
					provider: "claude",
				});
			}
		}
	} catch {
		// Missing or invalid settings — empty inventory.
	}
	servers.sort((left, right) => left.displayName.localeCompare(right.displayName));
	return { servers };
}

export type { RuntimeTaskLaunchEffort };
