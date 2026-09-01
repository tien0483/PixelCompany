/**
 * Per-task Model / Effort / Skill / MCP launch tags.
 *
 * Empty skill/MCP arrays inherit Manager/global installs. Non-empty arrays are
 * allowlists applied at Claude launch (scoped CLAUDE_CONFIG_DIR + mcp-config).
 * Cursor gets model/effort flags when supported and a prompt preface for tags.
 */
import { access, chmod, copyFile, cp, mkdir, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import type {
	RuntimeMcpInventory,
	RuntimeSkillInventory,
	RuntimeTaskLaunchEffort,
	RuntimeTaskLaunchSettings,
} from "../core/api-contract";
import type { FlowiseClient } from "../flowise/flowise-client";
import { FABLE_SEAT_MODEL_ID } from "../manager/claude-auto-seat-ranking";
import { mergeFlowiseMcpInventory } from "../flowise/flowise-mcp";
import { resolveMcpAllowlistServers } from "./agent-mcp-launch";
import { getRuntimeHomePath } from "../state/workspace-state";
import { collectVaultLaunchEnv } from "../vault";

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
	const workflowIds = normalizeIdList(settings.workflowIds);
	const mcpServerIds = normalizeIdList(settings.mcpServerIds);
	const customAgentFlowIds = normalizeIdList(settings.customAgentFlowIds);
	const subagentSeatProviderId = settings.subagentSeatProviderId?.trim();
	const subagentSeatModelId = settings.subagentSeatModelId?.trim();
	const next: RuntimeTaskLaunchSettings = {
		...(modelId ? { modelId } : {}),
		...(settings.effort ? { effort: settings.effort } : {}),
		...(skillIds ? { skillIds } : {}),
		...(agentIds ? { agentIds } : {}),
		...(commandIds ? { commandIds } : {}),
		...(workflowIds ? { workflowIds } : {}),
		...(mcpServerIds ? { mcpServerIds } : {}),
		...(customAgentFlowIds ? { customAgentFlowIds } : {}),
		// A model without a provider names nothing resolvable, so it is dropped with it.
		...(subagentSeatProviderId ? { subagentSeatProviderId } : {}),
		...(subagentSeatProviderId && subagentSeatModelId ? { subagentSeatModelId } : {}),
	};
	if (
		next.modelId === undefined &&
		next.effort === undefined &&
		next.skillIds === undefined &&
		next.agentIds === undefined &&
		next.commandIds === undefined &&
		next.workflowIds === undefined &&
		next.mcpServerIds === undefined &&
		next.customAgentFlowIds === undefined &&
		next.subagentSeatProviderId === undefined
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

export function hasWorkflowAllowlist(settings?: RuntimeTaskLaunchSettings | null): boolean {
	return (settings?.workflowIds?.length ?? 0) > 0;
}

export function hasMcpAllowlist(settings?: RuntimeTaskLaunchSettings | null): boolean {
	return (settings?.mcpServerIds?.length ?? 0) > 0;
}

export function hasSubagentSeat(settings?: RuntimeTaskLaunchSettings | null): boolean {
	return (settings?.subagentSeatProviderId?.trim().length ?? 0) > 0;
}

/** True when Claude needs a task-scoped CLAUDE_CONFIG_DIR for any resource allowlist. */
export function hasClaudeScopedConfigAllowlist(settings?: RuntimeTaskLaunchSettings | null): boolean {
	return (
		hasSkillAllowlist(settings) ||
		hasAgentAllowlist(settings) ||
		hasCommandAllowlist(settings) ||
		hasWorkflowAllowlist(settings) ||
		hasMcpAllowlist(settings)
	);
}

/**
 * Overwrites a card's model with the Fable preset's.
 *
 * Applied server-side at launch rather than only in the picker, so a card saved before the
 * preset existed — or a `kanban start` invocation that never opened the UI — cannot launch
 * Fable's seat on some other model. Effort is left to the card (or the CLI default when
 * unset). Every other launch setting (allowlists, subagent seat) passes through untouched.
 */
export function applyFableSeatLaunchSettings(
	settings: RuntimeTaskLaunchSettings | undefined,
): RuntimeTaskLaunchSettings {
	return { ...settings, modelId: FABLE_SEAT_MODEL_ID };
}

export function applyModelAndEffortArgs(
	args: string[],
	settings: RuntimeTaskLaunchSettings | undefined,
	options: { effortFlag?: string | null; allowedEfforts?: readonly string[] },
): void {
	const modelId = settings?.modelId?.trim();
	if (modelId && !hasCliOption(args, "--model") && !hasCliOption(args, "-m")) {
		args.push("--model", modelId);
	}
	let effort = settings?.effort;
	if (effort && options.allowedEfforts && !options.allowedEfforts.includes(effort)) {
		effort = options.allowedEfforts[options.allowedEfforts.length - 1] as RuntimeTaskLaunchEffort;
	}
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
/**
 * Link every entry of `sourceDir` into `targetDir` individually, keeping the target a
 * *real* directory. A whole-dir symlink is cheaper but cannot be overlaid — a later
 * per-id link would land inside the source instead. A missing source is not an error.
 * Returns the base names linked (skill folder name, or file name without `.md`).
 */
async function materializeInheritedDir(input: {
	sourceDir: string;
	targetDir: string;
	entryKind: "markdown-file" | "skill-dir";
}): Promise<Set<string>> {
	const linkedBaseNames = new Set<string>();
	await mkdir(input.targetDir, { recursive: true });
	const entries = await readdir(input.sourceDir, { withFileTypes: true }).catch(() => []);
	for (const entry of entries) {
		const name = entry.name.trim();
		if (!name || name.startsWith(".")) {
			continue;
		}
		if (input.entryKind === "markdown-file") {
			if (!entry.isFile() && !entry.isSymbolicLink()) {
				continue;
			}
			if (!name.toLowerCase().endsWith(".md")) {
				continue;
			}
			if (await ensureLinkedPath(join(input.sourceDir, name), join(input.targetDir, name), { isDirectory: false })) {
				linkedBaseNames.add(name.slice(0, -".md".length));
			}
			continue;
		}
		if (!entry.isDirectory() && !entry.isSymbolicLink()) {
			continue;
		}
		if (!(await pathExists(join(input.sourceDir, name, "SKILL.md")))) {
			continue;
		}
		if (await ensureLinkedPath(join(input.sourceDir, name), join(input.targetDir, name), { isDirectory: true })) {
			linkedBaseNames.add(name);
		}
	}
	return linkedBaseNames;
}

/** Overlay Manager-installed `<managerDir>/<id>.md` onto an already-materialized dir. */
async function overlayManagerMarkdownFiles(input: {
	managerDir: string;
	ids: Set<string>;
	targetDir: string;
	linkedBaseNames: Set<string>;
}): Promise<void> {
	for (const baseName of input.ids) {
		const fileName = `${baseName}.md`;
		if (
			await ensureLinkedPath(join(input.managerDir, fileName), join(input.targetDir, fileName), {
				isDirectory: false,
			})
		) {
			input.linkedBaseNames.add(baseName);
		}
	}
}

/**
 * Link allowlisted `<subdir>/*.md` into the scoped config dir. Global sources link
 * first; each project source root (e.g. `<repo>/.agent/agents`) then overrides on the
 * same base name so a project-local asset wins over a same-id global one. Returns the
 * set of base names (id without `.md`) that were actually linked.
 */
async function linkAllowlistedMarkdownFiles(input: {
	globalDir: string;
	configDir: string;
	subdir: "agents" | "commands";
	allowlist: string[];
	projectRoots?: string[];
	/** `<repo>/.claude/<subdir>` restricted to Manager-installed ids; wins over the rest. */
	managerRoot?: { dir: string; ids: Set<string> };
}): Promise<Set<string>> {
	const globalSubdir = join(input.globalDir, input.subdir);
	const scopedSubdir = join(input.configDir, input.subdir);
	const linkedBaseNames = new Set<string>();
	if (input.allowlist.length === 0) {
		const managerRoot = input.managerRoot;
		if (!managerRoot) {
			// Nothing to overlay — one symlink inherits every global asset.
			await ensureLinkedPath(globalSubdir, scopedSubdir, { isDirectory: true });
			return linkedBaseNames;
		}
		// Manager installs have to overlay the inherited set, so the dir must be real.
		for (const baseName of await materializeInheritedDir({
			sourceDir: globalSubdir,
			targetDir: scopedSubdir,
			entryKind: "markdown-file",
		})) {
			linkedBaseNames.add(baseName);
		}
		await overlayManagerMarkdownFiles({
			managerDir: managerRoot.dir,
			ids: managerRoot.ids,
			targetDir: scopedSubdir,
			linkedBaseNames,
		});
		return linkedBaseNames;
	}
	await mkdir(scopedSubdir, { recursive: true });
	for (const rawId of input.allowlist) {
		const id = rawId.trim();
		if (!id) {
			continue;
		}
		const baseName = id.endsWith(".md") ? id.slice(0, -".md".length) : id;
		const fileName = `${baseName}.md`;
		if (
			await ensureLinkedPath(join(globalSubdir, fileName), join(scopedSubdir, fileName), {
				isDirectory: false,
			})
		) {
			linkedBaseNames.add(baseName);
		}
		for (const projectRoot of input.projectRoots ?? []) {
			// Project overrides global on the same base name (ensureLinkedPath removes first).
			if (
				await ensureLinkedPath(join(projectRoot, fileName), join(scopedSubdir, fileName), {
					isDirectory: false,
				})
			) {
				linkedBaseNames.add(baseName);
			}
		}
		if (
			input.managerRoot?.ids.has(baseName) &&
			(await ensureLinkedPath(join(input.managerRoot.dir, fileName), join(scopedSubdir, fileName), {
				isDirectory: false,
			}))
		) {
			linkedBaseNames.add(baseName);
		}
	}
	return linkedBaseNames;
}

export async function prepareClaudeSkillScopedConfigDir(input: {
	taskId: string;
	skillIds?: string[];
	agentIds?: string[];
	commandIds?: string[];
	mcpServerIds?: string[];
	/**
	 * Attached project checkout. When set, allowlisted `<repo>/.agent/*` skills/agents/
	 * commands (and `workflowIds`) are bridged into the scoped config dir so they run.
	 * `<repo>/.claude/*` is NOT bridged — the agent reads it natively from cwd.
	 */
	repoPath?: string;
	/** Project workflow ids (`<repo>/.agent/workflows/<id>.md`) bridged into commands. */
	workflowIds?: string[];
	/**
	 * Main-repo checkout holding Manager installs. `<repo>/.claude` is normally read
	 * natively from cwd, but a task runs in a git worktree and a Manager install is
	 * untracked there, so allowlisted `managerFeatures` ids are bridged from here.
	 * Must be the repo path, not the task worktree.
	 */
	managerRepoPath?: string;
	/** Recorded `<category>/<name>` Manager intents for this workspace. */
	managerFeatures?: readonly string[];
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

	// Project bridge roots. Only `<repo>/.agent/*` is bridged — `<repo>/.claude/*`
	// is discovered natively from the task cwd, so re-linking it here would duplicate.
	const resolvedRepo = input.repoPath?.trim() ? resolveHostPath(input.repoPath.trim()) : null;
	const projectAgentSkillsRoot = resolvedRepo ? join(resolvedRepo, ".agent", "skills") : null;
	const projectAgentDir = resolvedRepo ? join(resolvedRepo, ".agent", "agents") : null;
	const projectCommandDir = resolvedRepo ? join(resolvedRepo, ".agent", "commands") : null;
	const projectWorkflowDir = resolvedRepo ? join(resolvedRepo, ".agent", "workflows") : null;

	// Manager-installed `<repo>/.claude` assets, trusted by id and bridged like the
	// `.agent` roots above (a worktree checkout does not carry them).
	const managerIds = managerFeatureInventoryIds(input.managerFeatures);
	const managerClaudeDir =
		input.managerRepoPath?.trim() && hasManagerFeatureIds(managerIds)
			? join(resolveHostPath(input.managerRepoPath.trim()), ".claude")
			: null;

	const skillsDir = join(configDir, "skills");
	const globalSkills = join(globalDir, "skills");
	const skillAllowlist = (input.skillIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0);
	if (skillAllowlist.length === 0) {
		if (managerClaudeDir) {
			// Manager installs have to overlay the inherited set, so the dir must be real.
			await materializeInheritedDir({ sourceDir: globalSkills, targetDir: skillsDir, entryKind: "skill-dir" });
			for (const folderName of managerIds.skills) {
				const managerSkillDir = join(managerClaudeDir, "skills", folderName);
				if (await pathExists(join(managerSkillDir, "SKILL.md"))) {
					await ensureLinkedPath(managerSkillDir, join(skillsDir, folderName), { isDirectory: true });
				}
			}
		} else {
			// Inherit all Manager skills (link, or recursive copy in restricted envs).
			await ensureLinkedPath(globalSkills, skillsDir, { isDirectory: true });
		}
	} else {
		await mkdir(skillsDir, { recursive: true });
		for (const skillId of skillAllowlist) {
			// Jacked feature names use skill_<folder>; disk folders do not.
			const folderName = skillId.startsWith("skill_") ? skillId.slice("skill_".length) : skillId;
			if (!folderName) {
				continue;
			}
			const globalSkillMd = join(globalSkills, folderName, "SKILL.md");
			if (await pathExists(globalSkillMd)) {
				await ensureLinkedPath(join(globalSkills, folderName), join(skillsDir, folderName), {
					isDirectory: true,
				});
			}
			// Bridge the project's `.agent` skill (wins over global on the same id).
			if (projectAgentSkillsRoot) {
				const projectSkillMd = join(projectAgentSkillsRoot, folderName, "SKILL.md");
				if (await pathExists(projectSkillMd)) {
					await ensureLinkedPath(join(projectAgentSkillsRoot, folderName), join(skillsDir, folderName), {
						isDirectory: true,
					});
				}
			}
			if (managerClaudeDir && managerIds.skills.has(folderName)) {
				const managerSkillDir = join(managerClaudeDir, "skills", folderName);
				if (await pathExists(join(managerSkillDir, "SKILL.md"))) {
					await ensureLinkedPath(managerSkillDir, join(skillsDir, folderName), { isDirectory: true });
				}
			}
		}
	}

	await linkAllowlistedMarkdownFiles({
		globalDir,
		configDir,
		subdir: "agents",
		allowlist: (input.agentIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0),
		projectRoots: projectAgentDir ? [projectAgentDir] : [],
		...(managerClaudeDir ? { managerRoot: { dir: join(managerClaudeDir, "agents"), ids: managerIds.agents } } : {}),
	});

	const commandAllowlist = (input.commandIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0);
	const workflowIds = (input.workflowIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0);
	const commandsDir = join(configDir, "commands");
	let linkedCommandBaseNames: Set<string>;
	if (workflowIds.length === 0) {
		linkedCommandBaseNames = await linkAllowlistedMarkdownFiles({
			globalDir,
			configDir,
			subdir: "commands",
			allowlist: commandAllowlist,
			projectRoots: projectCommandDir ? [projectCommandDir] : [],
			...(managerClaudeDir
				? { managerRoot: { dir: join(managerClaudeDir, "commands"), ids: managerIds.commands } }
				: {}),
		});
	} else {
		// Workflows land in `commands`, so it must be a real dir (never a symlink to the
		// global commands folder). Materialize the inherited/allowlisted commands first.
		await mkdir(commandsDir, { recursive: true });
		linkedCommandBaseNames = new Set<string>();
		const globalCommandsDir = join(globalDir, "commands");
		if (commandAllowlist.length === 0) {
			// Inherit all global commands as individual links so workflows can join them.
			linkedCommandBaseNames = await materializeInheritedDir({
				sourceDir: globalCommandsDir,
				targetDir: commandsDir,
				entryKind: "markdown-file",
			});
			if (managerClaudeDir) {
				await overlayManagerMarkdownFiles({
					managerDir: join(managerClaudeDir, "commands"),
					ids: managerIds.commands,
					targetDir: commandsDir,
					linkedBaseNames: linkedCommandBaseNames,
				});
			}
		} else {
			for (const rawId of commandAllowlist) {
				const baseName = rawId.endsWith(".md") ? rawId.slice(0, -".md".length) : rawId;
				const fileName = `${baseName}.md`;
				if (await ensureLinkedPath(join(globalCommandsDir, fileName), join(commandsDir, fileName), { isDirectory: false })) {
					linkedCommandBaseNames.add(baseName);
				}
				if (projectCommandDir) {
					if (await ensureLinkedPath(join(projectCommandDir, fileName), join(commandsDir, fileName), { isDirectory: false })) {
						linkedCommandBaseNames.add(baseName);
					}
				}
				if (
					managerClaudeDir &&
					managerIds.commands.has(baseName) &&
					(await ensureLinkedPath(join(managerClaudeDir, "commands", fileName), join(commandsDir, fileName), {
						isDirectory: false,
					}))
				) {
					linkedCommandBaseNames.add(baseName);
				}
			}
		}
	}

	// Bridge workflows into `commands` so they invoke as slash-commands. A base-name
	// collision with an already-linked command is prefixed `wf-` so both stay reachable.
	if (workflowIds.length > 0 && projectWorkflowDir) {
		await mkdir(commandsDir, { recursive: true });
		for (const rawId of workflowIds) {
			const baseName = rawId.endsWith(".md") ? rawId.slice(0, -".md".length) : rawId;
			const source = join(projectWorkflowDir, `${baseName}.md`);
			if (!(await pathExists(source))) {
				continue;
			}
			const targetName = linkedCommandBaseNames.has(baseName) ? `wf-${baseName}.md` : `${baseName}.md`;
			if (await ensureLinkedPath(source, join(commandsDir, targetName), { isDirectory: false })) {
				linkedCommandBaseNames.add(targetName.slice(0, -".md".length));
			}
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
	const allow = new Set(input.mcpServerIds.map((id) => id.trim()).filter(Boolean));
	if (allow.size === 0) {
		return null;
	}

	const filtered = await resolveMcpAllowlistServers({
		mcpServerIds: input.mcpServerIds,
		globalConfigPath: join(globalClaudeDir(), "settings.json"),
		warn: (message) => {
			console.warn(`[kanban] ${message}`);
		},
	});

	const { mcpEnvByServerId } = await collectVaultLaunchEnv(input.mcpServerIds);
	for (const [serverId, rawConfig] of Object.entries(filtered)) {
		const vaultEnv = mcpEnvByServerId[serverId];
		if (vaultEnv && Object.keys(vaultEnv).length > 0 && rawConfig && typeof rawConfig === "object") {
			const serverConfig = rawConfig as Record<string, unknown>;
			serverConfig.env = {
				...((serverConfig.env as Record<string, string> | undefined) ?? {}),
				...vaultEnv,
			};
		}
	}

	const scratch = taskLaunchScratchDir(input.taskId);
	await mkdir(scratch, { recursive: true });
	const mcpConfigPath = join(scratch, "mcp.allowlist.json");
	await writeFile(mcpConfigPath, JSON.stringify({ mcpServers: filtered }, null, 2), "utf8");
	await chmod(mcpConfigPath, 0o600).catch(() => {});
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

type InventoryOrigin = RuntimeSkillInventory["skills"][number]["origin"];
type InventoryRoot = NonNullable<RuntimeSkillInventory["skills"][number]["root"]>;

interface InventoryTag {
	origin?: InventoryOrigin;
	root?: InventoryRoot;
}

function stampInventoryTag<T extends { origin: InventoryOrigin; root?: InventoryRoot }>(tag: InventoryTag): {
	origin: InventoryOrigin;
	root?: InventoryRoot;
} {
	return {
		origin: tag.origin ?? "global",
		...(tag.root ? { root: tag.root } : {}),
	} as { origin: InventoryOrigin; root?: InventoryRoot };
}

async function readSkillsFromRoot(
	skillsRoot: string,
	source: RuntimeSkillInventory["skills"][number]["source"],
	tag: InventoryTag = {},
): Promise<RuntimeSkillInventory["skills"]> {
	const stamp = stampInventoryTag(tag);
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
				...stamp,
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
	tag: InventoryTag = {},
): Promise<RuntimeSkillInventory["skills"]> {
	const stamp = stampInventoryTag(tag);
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
				...stamp,
			});
		}
	} catch {
		// Root missing.
	}
	return items.sort((left, right) => left.displayName.localeCompare(right.displayName));
}

/** Project-local roots (relative to the attached repo) that can carry assets. */
const PROJECT_LOCAL_ROOT_DIRS: Record<InventoryRoot, string> = {
	claude: ".claude",
	agent: ".agent",
};

/** Inventory ids a project enabled through the Manager shelves, split by kind. */
export interface ManagerFeatureInventoryIds {
	skills: Set<string>;
	agents: Set<string>;
	commands: Set<string>;
}

/**
 * Map recorded `<category>/<name>` Manager intents onto the ids their installs carry
 * on disk. Manager writes skills as `<repo>/.claude/skills/<x>/SKILL.md` for the
 * feature `knowledge/skill_<x>`, so the `skill_` prefix is dropped here exactly like
 * the scoped-config allowlist does. `knowledge/rules`, `knowledge/reference` and
 * `hooks/*` have no inventory item and are ignored.
 */
export function managerFeatureInventoryIds(keys: readonly string[] | undefined): ManagerFeatureInventoryIds {
	const ids: ManagerFeatureInventoryIds = { skills: new Set(), agents: new Set(), commands: new Set() };
	for (const rawKey of keys ?? []) {
		const key = rawKey.trim();
		const separator = key.indexOf("/");
		if (separator <= 0) {
			continue;
		}
		const category = key.slice(0, separator);
		const name = key.slice(separator + 1).trim();
		if (!name) {
			continue;
		}
		if (category === "agents") {
			ids.agents.add(name);
		} else if (category === "commands") {
			ids.commands.add(name);
		} else if (category === "knowledge" && name.startsWith("skill_")) {
			const skillId = name.slice("skill_".length);
			if (skillId) {
				ids.skills.add(skillId);
			}
		}
	}
	return ids;
}

export function hasManagerFeatureIds(ids: ManagerFeatureInventoryIds): boolean {
	return ids.skills.size > 0 || ids.agents.size > 0 || ids.commands.size > 0;
}

/** Merge project over global by id (project wins), then sort by display name. */
function mergeInventoryByOrigin(
	global: RuntimeSkillInventory["skills"],
	project: RuntimeSkillInventory["skills"],
): RuntimeSkillInventory["skills"] {
	const byId = new Map<string, RuntimeSkillInventory["skills"][number]>();
	// Project first so project wins on id collision; roots earlier in the list win.
	for (const item of [...project, ...global]) {
		if (!byId.has(item.id)) {
			byId.set(item.id, item);
		}
	}
	return [...byId.values()].sort((left, right) => left.displayName.localeCompare(right.displayName));
}

/**
 * Real Manager resources for card tags:
 * - Training skills: ~/.claude/skills (+ ~/.agents/skills)
 * - Staff agents: ~/.claude/agents
 * - Playbook commands: ~/.claude/commands
 *
 * When `repoPath` is set and `opts.localAssetsEnabled`, additionally surfaces the
 * project's own `<repo>/.claude/*` and `<repo>/.agent/*` assets (tagged
 * `origin: "project"`, `root`), with project entries overriding global on same id.
 *
 * `opts.managerFeatures` is the exception to that opt-in: a Manager shelf toggle
 * installs into `<repo>/.claude` and records the intent, so those ids are surfaced
 * even with local assets off. Anything else the repo happens to carry stays gated.
 */
export async function listClaudeSkillInventory(
	repoPath?: string,
	opts?: { localAssetsEnabled?: boolean; roots?: InventoryRoot[]; managerFeatures?: readonly string[] },
): Promise<RuntimeSkillInventory> {
	const roots: Array<{ path: string; source: RuntimeSkillInventory["skills"][number]["source"] }> = [
		{ path: join(globalClaudeDir(), "skills"), source: "disk" },
		{ path: join(homedir(), ".agents", "skills"), source: "pack" },
	];
	const byId = new Map<string, RuntimeSkillInventory["skills"][number]>();
	for (const root of roots) {
		const found = await readSkillsFromRoot(root.path, root.source, { origin: "global" });
		for (const skill of found) {
			const existing = byId.get(skill.id);
			// Prefer ~/.claude/skills (disk) over agents/pack duplicates.
			if (!existing || (existing.source !== "disk" && skill.source === "disk")) {
				byId.set(skill.id, skill);
			}
		}
	}
	const globalSkills = [...byId.values()];
	const globalAgents = await readMarkdownInventory(join(globalClaudeDir(), "agents"), "disk", { origin: "global" });
	const globalCommands = await readMarkdownInventory(join(globalClaudeDir(), "commands"), "disk", { origin: "global" });

	const projectSkills: RuntimeSkillInventory["skills"] = [];
	const projectAgents: RuntimeSkillInventory["skills"] = [];
	const projectCommands: RuntimeSkillInventory["skills"] = [];
	const projectWorkflows: RuntimeSkillInventory["skills"] = [];
	const managerIds = managerFeatureInventoryIds(opts?.managerFeatures);
	if (repoPath && (opts?.localAssetsEnabled || hasManagerFeatureIds(managerIds))) {
		const resolvedRepo = resolveHostPath(repoPath);
		if (hasManagerFeatureIds(managerIds)) {
			// Manager installs only ever land in `<repo>/.claude`, and only these ids are
			// trusted — the rest of that directory still needs the local-assets opt-in.
			const managerRoot = join(resolvedRepo, PROJECT_LOCAL_ROOT_DIRS.claude);
			const tag: InventoryTag = { origin: "project", root: "claude" };
			const keep = (items: RuntimeSkillInventory["skills"], allowed: Set<string>) =>
				items.filter((item) => allowed.has(item.id));
			projectSkills.push(
				...keep(await readSkillsFromRoot(join(managerRoot, "skills"), "disk", tag), managerIds.skills),
			);
			projectAgents.push(
				...keep(await readMarkdownInventory(join(managerRoot, "agents"), "disk", tag), managerIds.agents),
			);
			projectCommands.push(
				...keep(await readMarkdownInventory(join(managerRoot, "commands"), "disk", tag), managerIds.commands),
			);
		}
		if (opts?.localAssetsEnabled) {
			const enabledRoots =
				opts.roots && opts.roots.length > 0
					? (["claude", "agent"] as InventoryRoot[]).filter((root) => opts.roots?.includes(root))
					: (["claude", "agent"] as InventoryRoot[]);
			for (const root of enabledRoots) {
				const rootDir = join(resolvedRepo, PROJECT_LOCAL_ROOT_DIRS[root]);
				const tag: InventoryTag = { origin: "project", root };
				projectSkills.push(...(await readSkillsFromRoot(join(rootDir, "skills"), "disk", tag)));
				projectAgents.push(...(await readMarkdownInventory(join(rootDir, "agents"), "disk", tag)));
				projectCommands.push(...(await readMarkdownInventory(join(rootDir, "commands"), "disk", tag)));
				projectWorkflows.push(...(await readMarkdownInventory(join(rootDir, "workflows"), "disk", tag)));
			}
		}
	}

	const skills = dropDevTestSkillItems(mergeInventoryByOrigin(globalSkills, projectSkills));
	const agents = dropDevTestSkillItems(mergeInventoryByOrigin(globalAgents, projectAgents));
	const commands = dropDevTestSkillItems(mergeInventoryByOrigin(globalCommands, projectCommands));
	const workflows = dropDevTestSkillItems(mergeInventoryByOrigin([], projectWorkflows));
	return { skills, agents, commands, workflows };
}

export async function listClaudeMcpInventory(flowiseClient?: FlowiseClient | null): Promise<RuntimeMcpInventory> {
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
	return mergeFlowiseMcpInventory({ servers }, flowiseClient);
}

export type { RuntimeTaskLaunchEffort };
