/**
 * Per-task Model / Effort / Skill / MCP launch tags.
 *
 * Empty skill/MCP arrays inherit Manager/global installs. Non-empty arrays are
 * allowlists applied at Claude launch (scoped CLAUDE_CONFIG_DIR + mcp-config).
 * Cursor gets model/effort flags when supported and a prompt preface for tags.
 */
import { access, copyFile, cp, mkdir, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import type {
	RuntimeMcpInventory,
	RuntimeSkillInventory,
	RuntimeTaskLaunchEffort,
	RuntimeTaskLaunchSettings,
} from "../core/api-contract";
import { getRuntimeHomePath } from "../state/workspace-state";

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

/**
 * Resolve a path Jacked/Claude may hand us across Windows, WSL, or a sandbox.
 * Accepts absolute host paths as-is; keeps relative paths resolved from cwd.
 */
export function resolveHostPath(rawPath: string): string {
	const trimmed = rawPath.trim();
	if (!trimmed) {
		return trimmed;
	}
	// WSL can see Windows paths when Jacked was started from /mnt/<drive>.
	// Convert `C:\foo` / `C:/foo` → `/mnt/c/foo` when we are not on win32.
	if (process.platform !== "win32") {
		const windowsPath = /^([A-Za-z]):[\\/](.*)$/.exec(trimmed);
		if (windowsPath) {
			const drive = windowsPath[1]?.toLowerCase();
			const rest = (windowsPath[2] ?? "").replace(/\\/g, "/");
			if (drive) {
				return `/mnt/${drive}/${rest}`.replace(/\/+/g, "/");
			}
		}
	}
	return isAbsolute(trimmed) ? trimmed : resolve(trimmed);
}

async function resolveExistingPath(rawPath: string): Promise<string | null> {
	const candidate = resolveHostPath(rawPath);
	if (!(await pathExists(candidate))) {
		return null;
	}
	try {
		return await realpath(candidate);
	} catch {
		return candidate;
	}
}

async function removePath(target: string): Promise<void> {
	try {
		await rm(target, { recursive: true, force: true });
	} catch {
		// Best effort.
	}
}

async function copyPath(source: string, target: string, isDirectory: boolean): Promise<boolean> {
	try {
		await removePath(target);
		if (isDirectory) {
			await cp(source, target, { recursive: true, force: true, errorOnExist: false });
		} else {
			await mkdir(dirname(target), { recursive: true });
			await copyFile(source, target);
		}
		return true;
	} catch {
		return false;
	}
}

/**
 * Link `source` → `target`, with portable fallbacks:
 * - Windows dirs: junction (no admin) then dir symlink
 * - Windows files / sandboxes: file symlink then copy
 * - Linux/WSL: plain symlink (type ignored), then recursive copy
 *
 * Credential-like files should pass `preferCopy: true` so Claude/Jacked never
 * depend on symlink privileges (Jacked also refuses symlink credential writes).
 */
export async function ensureLinkedPath(
	source: string,
	target: string,
	options: { isDirectory: boolean; preferCopy?: boolean },
): Promise<boolean> {
	const resolvedSource = await resolveExistingPath(source);
	if (!resolvedSource) {
		return false;
	}
	await removePath(target);

	if (options.preferCopy) {
		return await copyPath(resolvedSource, target, options.isDirectory);
	}

	const linkTypes: Array<"junction" | "dir" | "file" | null> = options.isDirectory
		? process.platform === "win32"
			? ["junction", "dir", null]
			: [null, "dir"]
		: process.platform === "win32"
			? ["file", null]
			: [null, "file"];

	for (const linkType of linkTypes) {
		try {
			if (linkType === null) {
				await symlink(resolvedSource, target);
			} else {
				await symlink(resolvedSource, target, linkType);
			}
			return true;
		} catch {
			// Try the next strategy.
		}
	}

	return await copyPath(resolvedSource, target, options.isDirectory);
}

async function seedClaudeJsonForScopedDir(configDir: string, baseDir: string): Promise<void> {
	const target = join(configDir, ".claude.json");
	// Prefer the prepared pin/account config (already has oauthAccount + onboarding).
	// Always copy — never symlink — so Windows/sandbox without symlink rights still auth.
	const baseClaudeJson = join(baseDir, ".claude.json");
	if (await ensureLinkedPath(baseClaudeJson, target, { isDirectory: false, preferCopy: true })) {
		return;
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

	// Always materialize settings as a real file. Symlinked settings break in
	// sandboxes and can reintroduce global mcpServers when an allowlist is set.
	let parsed: Record<string, unknown> = {};
	try {
		const raw: unknown = JSON.parse(await readFile(sourcePath, "utf8"));
		if (raw && typeof raw === "object" && !Array.isArray(raw)) {
			parsed = { ...(raw as Record<string, unknown>) };
		}
	} catch {
		parsed = {};
	}
	if (mcpServerIds && mcpServerIds.length > 0) {
		delete parsed.mcpServers;
	}
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
	const requestedBase = input.baseConfigDir?.trim() ? resolveHostPath(input.baseConfigDir.trim()) : "";
	const baseDir = requestedBase && (await pathExists(requestedBase)) ? requestedBase : globalDir;
	const configDir = taskLaunchScratchDir(input.taskId);
	await rm(configDir, { recursive: true, force: true }).catch(() => {});
	await mkdir(configDir, { recursive: true });

	for (const name of SHARED_SYMLINK_NAMES) {
		const source = join(baseDir, name);
		const fallback = join(globalDir, name);
		const resolvedSource = (await pathExists(source)) ? source : fallback;
		const isDirectory = name !== "CLAUDE.md";
		await ensureLinkedPath(resolvedSource, join(configDir, name), { isDirectory });
	}

	await writeScopedSettingsJson(configDir, baseDir, input.mcpServerIds);

	// Credentials: always copy. Symlinks fail without Windows Developer Mode /
	// sandbox CAP_DAC, and Jacked refuses to treat symlink credential files as writable.
	const credentialCandidates = [join(baseDir, ".credentials.json"), join(globalDir, ".credentials.json")];
	for (const source of credentialCandidates) {
		if (
			await ensureLinkedPath(source, join(configDir, ".credentials.json"), {
				isDirectory: false,
				preferCopy: true,
			})
		) {
			break;
		}
	}
	await seedClaudeJsonForScopedDir(configDir, baseDir);

	const skillsDir = join(configDir, "skills");
	const globalSkills = join(globalDir, "skills");
	const skillAllowlist = (input.skillIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0);
	if (skillAllowlist.length === 0) {
		// Inherit all Manager skills (link, or recursive copy in restricted envs).
		await ensureLinkedPath(globalSkills, skillsDir, { isDirectory: true });
	} else {
		await mkdir(skillsDir, { recursive: true });
		for (const skillId of skillAllowlist) {
			// Jacked feature names use skill_<folder>; disk folders do not.
			const folderName = skillId.startsWith("skill_") ? skillId.slice("skill_".length) : skillId;
			if (!folderName) {
				continue;
			}
			await ensureLinkedPath(join(globalSkills, folderName), join(skillsDir, folderName), {
				isDirectory: true,
			});
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
