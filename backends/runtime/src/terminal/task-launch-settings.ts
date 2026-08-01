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

export { buildCursorLaunchTagPreface, buildLaunchTagAllowlistUpdateNotice } from "./task-launch-tag-messages";

/** Always shared into scoped config. agents/commands/skills are allowlist-filtered. */
const SHARED_SYMLINK_NAMES = ["CLAUDE.md", "plugins", "projects"] as const;
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
	const agentIds = normalizeIdList(settings.agentIds);
	const commandIds = normalizeIdList(settings.commandIds);
	const mcpServerIds = normalizeIdList(settings.mcpServerIds);
	const next: RuntimeTaskLaunchSettings = {
		...(modelId ? { modelId } : {}),
		...(settings.effort ? { effort: settings.effort } : {}),
		...(skillIds ? { skillIds } : {}),
		...(agentIds ? { agentIds } : {}),
		...(commandIds ? { commandIds } : {}),
		...(mcpServerIds ? { mcpServerIds } : {}),
	};
	if (
		next.modelId === undefined &&
		next.effort === undefined &&
		next.skillIds === undefined &&
		next.agentIds === undefined &&
		next.commandIds === undefined &&
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

export function hasAgentAllowlist(settings?: RuntimeTaskLaunchSettings | null): boolean {
	return (settings?.agentIds?.length ?? 0) > 0;
}

export function hasCommandAllowlist(settings?: RuntimeTaskLaunchSettings | null): boolean {
	return (settings?.commandIds?.length ?? 0) > 0;
}

export function hasMcpAllowlist(settings?: RuntimeTaskLaunchSettings | null): boolean {
	return (settings?.mcpServerIds?.length ?? 0) > 0;
}

/** True when Claude needs a task-scoped CLAUDE_CONFIG_DIR for any resource allowlist. */
export function hasClaudeScopedConfigAllowlist(settings?: RuntimeTaskLaunchSettings | null): boolean {
	return (
		hasSkillAllowlist(settings) ||
		hasAgentAllowlist(settings) ||
		hasCommandAllowlist(settings) ||
		hasMcpAllowlist(settings)
	);
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
async function linkAllowlistedMarkdownFiles(input: {
	globalDir: string;
	configDir: string;
	subdir: "agents" | "commands";
	allowlist: string[];
}): Promise<void> {
	const globalSubdir = join(input.globalDir, input.subdir);
	const scopedSubdir = join(input.configDir, input.subdir);
	if (input.allowlist.length === 0) {
		await ensureLinkedPath(globalSubdir, scopedSubdir, { isDirectory: true });
		return;
	}
	await mkdir(scopedSubdir, { recursive: true });
	for (const rawId of input.allowlist) {
		const id = rawId.trim();
		if (!id) {
			continue;
		}
		const fileName = id.endsWith(".md") ? id : `${id}.md`;
		await ensureLinkedPath(join(globalSubdir, fileName), join(scopedSubdir, fileName), {
			isDirectory: false,
		});
	}
}

export async function prepareClaudeSkillScopedConfigDir(input: {
	taskId: string;
	skillIds?: string[];
	agentIds?: string[];
	commandIds?: string[];
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
			const skillMd = join(globalSkills, folderName, "SKILL.md");
			if (!(await pathExists(skillMd))) {
				continue;
			}
			await ensureLinkedPath(join(globalSkills, folderName), join(skillsDir, folderName), {
				isDirectory: true,
			});
		}
	}

	await linkAllowlistedMarkdownFiles({
		globalDir,
		configDir,
		subdir: "agents",
		allowlist: (input.agentIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0),
	});
	await linkAllowlistedMarkdownFiles({
		globalDir,
		configDir,
		subdir: "commands",
		allowlist: (input.commandIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0),
	});

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

function parseSkillMarkdownMeta(raw: string): { displayName?: string; description?: string } {
	const trimmed = raw.trimStart();
	if (!trimmed.startsWith("---")) {
		return {};
	}
	const end = trimmed.indexOf("\n---", 3);
	if (end < 0) {
		return {};
	}
	const frontmatter = trimmed.slice(3, end).trim();
	let displayName: string | undefined;
	let description: string | undefined;
	for (const line of frontmatter.split(/\r?\n/)) {
		const match = /^(name|description)\s*:\s*(.+)\s*$/.exec(line);
		if (!match) {
			continue;
		}
		const key = match[1];
		const value = (match[2] ?? "").trim().replace(/^["']|["']$/g, "");
		if (!value) {
			continue;
		}
		if (key === "name") {
			displayName = value;
		} else if (key === "description") {
			description = value;
		}
	}
	return {
		...(displayName ? { displayName } : {}),
		...(description ? { description } : {}),
	};
}

function describeMcpServerConfig(config: unknown): string | undefined {
	if (!config || typeof config !== "object" || Array.isArray(config)) {
		return undefined;
	}
	const record = config as Record<string, unknown>;
	const command = typeof record.command === "string" ? record.command.trim() : "";
	const url = typeof record.url === "string" ? record.url.trim() : "";
	const args = Array.isArray(record.args)
		? record.args.filter((arg): arg is string => typeof arg === "string" && arg.trim().length > 0)
		: [];
	if (command) {
		return args.length > 0 ? `${command} ${args.join(" ")}` : command;
	}
	if (url) {
		return url;
	}
	const type = typeof record.type === "string" ? record.type.trim() : "";
	return type || undefined;
}

/** Dev fixtures written during PixelOffice manual QA — hide from card/Manager pickers. */
const DEV_TEST_INVENTORY_ID_PREFIX = "pixeloffice-manual-";

function isDevTestInventoryId(id: string): boolean {
	return id.startsWith(DEV_TEST_INVENTORY_ID_PREFIX);
}

function isDevTestSkillItem(item: { id: string; description?: string }): boolean {
	if (isDevTestInventoryId(item.id)) {
		return true;
	}
	const description = item.description?.trim().toLowerCase() ?? "";
	return description.includes("harmless pixeloffice manual-test skill");
}

function dropDevTestSkillItems<T extends { id: string; description?: string }>(items: T[]): T[] {
	return items.filter((item) => !isDevTestSkillItem(item));
}

async function readSkillsFromRoot(
	skillsRoot: string,
	source: RuntimeSkillInventory["skills"][number]["source"],
): Promise<RuntimeSkillInventory["skills"]> {
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
			const skillMdPath = join(skillsRoot, id, "SKILL.md");
			// Manager toggle-off used to leave empty skill folders; require SKILL.md.
			if (!(await pathExists(skillMdPath))) {
				continue;
			}
			let displayName = id;
			let description: string | undefined;
			try {
				const skillMd = await readFile(skillMdPath, "utf8");
				const meta = parseSkillMarkdownMeta(skillMd);
				if (meta.displayName) {
					displayName = meta.displayName;
				}
				description = meta.description;
			} catch {
				// Unreadable SKILL.md — still list by folder id.
			}
			skills.push({
				id,
				displayName,
				...(description ? { description } : {}),
				source,
			});
		}
	} catch {
		// Root missing — skip.
	}
	return skills;
}

async function readMarkdownInventory(
	root: string,
	source: RuntimeSkillInventory["skills"][number]["source"],
): Promise<RuntimeSkillInventory["skills"]> {
	const items: RuntimeSkillInventory["skills"] = [];
	try {
		const entries = await readdir(root, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isFile() && !entry.isSymbolicLink()) {
				continue;
			}
			const name = entry.name.trim();
			if (!name.toLowerCase().endsWith(".md") || name.startsWith(".")) {
				continue;
			}
			const id = name.slice(0, -".md".length);
			if (!id) {
				continue;
			}
			let displayName = id;
			let description: string | undefined;
			try {
				const raw = await readFile(join(root, name), "utf8");
				const meta = parseSkillMarkdownMeta(raw);
				if (meta.displayName) {
					displayName = meta.displayName;
				}
				description = meta.description;
			} catch {
				// Keep id-only.
			}
			items.push({
				id,
				displayName,
				...(description ? { description } : {}),
				source,
			});
		}
	} catch {
		// Root missing.
	}
	return items.sort((left, right) => left.displayName.localeCompare(right.displayName));
}

/**
 * Real Manager resources for card tags:
 * - Training skills: ~/.claude/skills (+ ~/.agents/skills)
 * - Staff agents: ~/.claude/agents
 * - Playbook commands: ~/.claude/commands
 */
export async function listClaudeSkillInventory(): Promise<RuntimeSkillInventory> {
	const roots: Array<{ path: string; source: RuntimeSkillInventory["skills"][number]["source"] }> = [
		{ path: join(globalClaudeDir(), "skills"), source: "disk" },
		{ path: join(homedir(), ".agents", "skills"), source: "pack" },
	];
	const byId = new Map<string, RuntimeSkillInventory["skills"][number]>();
	for (const root of roots) {
		const found = await readSkillsFromRoot(root.path, root.source);
		for (const skill of found) {
			const existing = byId.get(skill.id);
			// Prefer ~/.claude/skills (disk) over agents/pack duplicates.
			if (!existing || (existing.source !== "disk" && skill.source === "disk")) {
				byId.set(skill.id, skill);
			}
		}
	}
	const skills = dropDevTestSkillItems(
		[...byId.values()].sort((left, right) => left.displayName.localeCompare(right.displayName)),
	);
	const agents = dropDevTestSkillItems(await readMarkdownInventory(join(globalClaudeDir(), "agents"), "disk"));
	const commands = dropDevTestSkillItems(
		await readMarkdownInventory(join(globalClaudeDir(), "commands"), "disk"),
	);
	return { skills, agents, commands };
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
			for (const [id, config] of Object.entries(mcpServers as Record<string, unknown>)) {
				const trimmed = id.trim();
				if (!trimmed || isDevTestInventoryId(trimmed)) {
					continue;
				}
				const description = describeMcpServerConfig(config);
				servers.push({
					id: trimmed,
					displayName: trimmed,
					...(description ? { description } : {}),
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
