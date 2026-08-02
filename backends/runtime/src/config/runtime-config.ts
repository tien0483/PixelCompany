// Persists Kanban-owned runtime preferences on disk.
// This module should store Kanban settings such as selected agents,
// shortcuts, and prompt templates, not SDK-owned Cline secrets or OAuth data.
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { getRuntimeAgentCatalogEntry, isRuntimeAgentLaunchSupported } from "../core/agent-catalog";
import type { RuntimeAgentId, RuntimeProjectShortcut } from "../core/api-contract";
import { type LockRequest, lockedFileSystem } from "../fs/locked-file-system";
import { detectInstalledCommands } from "../terminal/agent-registry";
import { LEGACY_RUNTIME_HOME_PARENT_DIR_NAME, RUNTIME_HOME_PARENT_DIR_NAME } from "../workspace/task-worktree-path";
import { areRuntimeProjectShortcutsEqual } from "./shortcut-utils";

interface RuntimeGlobalConfigFileShape {
	selectedAgentId?: RuntimeAgentId;
	selectedShortcutLabel?: string;
	agentAutonomousModeEnabled?: boolean;
	readyForReviewNotificationsEnabled?: boolean;
	commitPromptTemplate?: string;
	openPrPromptTemplate?: string;
	agentDisplayName?: string;
	seamCommentTagTemplate?: string;
}

interface RuntimeProjectConfigFileShape {
	shortcuts?: RuntimeProjectShortcut[];
}

export interface RuntimeConfigState {
	globalConfigPath: string;
	projectConfigPath: string | null;
	selectedAgentId: RuntimeAgentId;
	selectedShortcutLabel: string | null;
	agentAutonomousModeEnabled: boolean;
	readyForReviewNotificationsEnabled: boolean;
	shortcuts: RuntimeProjectShortcut[];
	commitPromptTemplate: string;
	openPrPromptTemplate: string;
	commitPromptTemplateDefault: string;
	openPrPromptTemplateDefault: string;
	agentDisplayName: string;
	seamCommentTagTemplate: string;
	seamCommentTagTemplateDefault: string;
}

export interface RuntimeConfigUpdateInput {
	selectedAgentId?: RuntimeAgentId;
	selectedShortcutLabel?: string | null;
	agentAutonomousModeEnabled?: boolean;
	readyForReviewNotificationsEnabled?: boolean;
	shortcuts?: RuntimeProjectShortcut[];
	commitPromptTemplate?: string;
	openPrPromptTemplate?: string;
	agentDisplayName?: string;
	seamCommentTagTemplate?: string;
}

const RUNTIME_HOME_PARENT_DIR = RUNTIME_HOME_PARENT_DIR_NAME;
const RUNTIME_HOME_DIR = "kanban";
const CONFIG_FILENAME = "config.json";
const PROJECT_CONFIG_PARENT_DIR = RUNTIME_HOME_PARENT_DIR_NAME;
const LEGACY_PROJECT_CONFIG_PARENT_DIR = LEGACY_RUNTIME_HOME_PARENT_DIR_NAME;
const PROJECT_CONFIG_DIR = "kanban";
const PROJECT_CONFIG_FILENAME = "config.json";
// `normalizeAgentId` coerces any persisted id that is no longer launch-supported
// (for example an older config.json holding "cline") to DEFAULT_AGENT_ID.
const DEFAULT_AGENT_ID: RuntimeAgentId = "claude";
const AUTO_SELECT_AGENT_PRIORITY: readonly RuntimeAgentId[] = ["claude", "cursor"];
const DEFAULT_AGENT_AUTONOMOUS_MODE_ENABLED = true;
const DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED = true;
const DEFAULT_COMMIT_PROMPT_TEMPLATE = `You are in a worktree on a detached HEAD, created from {{base_ref}}. When you finish the task, commit the working changes onto a dedicated task branch. Do NOT modify {{base_ref}} — a human merges the task branch into {{base_ref}} later from the board (the "Merge → {{base_ref}}" button on the task card takes effect in {{base_ref}}).

- Do not run destructive commands: git reset --hard, git clean -fdx, git worktree remove, rm/mv on repository paths.
- Do not check out, cherry-pick onto, or otherwise touch the {{base_ref}} worktree.
- Keep all work in the current task worktree.

Steps:
1. In the current task worktree, stage the pending task changes (git add -A, or stage the intended files).
2. Create the task branch at the current HEAD and switch to it: git switch -c {{task_branch}}
   - If {{task_branch}} already exists, switch to it instead: git switch {{task_branch}}
3. Commit the staged changes on {{task_branch}} with a clear Conventional Commits message.
4. Do not push and do not merge into {{base_ref}}; the human does that from the board.
5. Report:
   - Task branch name: {{task_branch}}
   - Final commit hash
   - Final commit message
   - Any remaining manual follow-up needed`;
const DEFAULT_OPEN_PR_PROMPT_TEMPLATE = `You are in a worktree on a detached HEAD. When you are finished with the task, open a pull request against {{base_ref}}.

- Do not run destructive commands: git reset --hard, git clean -fdx, git worktree remove, rm/mv on repository paths.
- Do not modify the base worktree.
- Keep all PR preparation in the current task worktree.

Steps:
1. Ensure all intended changes are committed in the current task worktree.
2. If currently on detached HEAD, create a branch at the current commit in this worktree.
3. Push the branch to origin and set upstream.
4. Create a pull request with base {{base_ref}} and head as the pushed branch (use gh CLI if available).
5. If a pull request already exists for the same head and base, return that existing PR URL instead of creating a duplicate.
6. If PR creation is blocked, explain exactly why and provide the exact commands to complete it manually.
7. Report:
   - PR title: PR URL
   - Base branch
   - Head branch
   - Any follow-up needed`;
const DEFAULT_SEAM_COMMENT_TAG_TEMPLATE = "// {{ticket_id}} ({{agent_name}}):";

export function pickBestInstalledAgentIdFromDetected(detectedCommands: readonly string[]): RuntimeAgentId | null {
	const detected = new Set(detectedCommands);
	for (const agentId of AUTO_SELECT_AGENT_PRIORITY) {
		const canonicalBinary = getRuntimeAgentCatalogEntry(agentId)?.binary ?? agentId;
		if (detected.has(canonicalBinary) || detected.has(agentId)) {
			return agentId;
		}
	}
	return null;
}

function getRuntimeHomePath(): string {
	return join(homedir(), RUNTIME_HOME_PARENT_DIR, RUNTIME_HOME_DIR);
}

function normalizeAgentId(agentId: RuntimeAgentId | string | null | undefined): RuntimeAgentId {
	if (
		(agentId === "claude" ||
			agentId === "codex" ||
			agentId === "cursor" ||
			agentId === "gemini" ||
			agentId === "opencode" ||
			agentId === "droid" ||
			agentId === "kiro" ||
			agentId === "cline") &&
		isRuntimeAgentLaunchSupported(agentId)
	) {
		return agentId;
	}
	return DEFAULT_AGENT_ID;
}

function pickBestInstalledAgentId(): RuntimeAgentId | null {
	return pickBestInstalledAgentIdFromDetected(detectInstalledCommands());
}

function normalizeShortcut(shortcut: RuntimeProjectShortcut): RuntimeProjectShortcut | null {
	if (!shortcut || typeof shortcut !== "object") {
		return null;
	}

	const label = typeof shortcut.label === "string" ? shortcut.label.trim() : "";
	const command = typeof shortcut.command === "string" ? shortcut.command.trim() : "";
	const icon = typeof shortcut.icon === "string" ? shortcut.icon.trim() : "";

	if (!label || !command) {
		return null;
	}

	return {
		label,
		command,
		icon: icon || undefined,
	};
}

function normalizeShortcuts(shortcuts: RuntimeProjectShortcut[] | null | undefined): RuntimeProjectShortcut[] {
	if (!Array.isArray(shortcuts)) {
		return [];
	}
	const normalized: RuntimeProjectShortcut[] = [];
	for (const shortcut of shortcuts) {
		const parsed = normalizeShortcut(shortcut);
		if (parsed) {
			normalized.push(parsed);
		}
	}
	return normalized;
}

function normalizePromptTemplate(value: unknown, fallback: string): string {
	if (typeof value !== "string") {
		return fallback;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? value : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
	if (typeof value === "boolean") {
		return value;
	}
	return fallback;
}

function normalizeAgentDisplayName(value: unknown): string {
	if (typeof value !== "string") {
		return "";
	}
	return value.trim();
}

function normalizeShortcutLabel(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

function hasOwnKey<T extends object>(value: T | null, key: keyof T): boolean {
	if (!value) {
		return false;
	}
	return Object.hasOwn(value, key);
}

export function getRuntimeGlobalConfigPath(): string {
	return join(getRuntimeHomePath(), CONFIG_FILENAME);
}

export function getRuntimeProjectConfigPath(cwd: string): string {
	return join(resolve(cwd), PROJECT_CONFIG_PARENT_DIR, PROJECT_CONFIG_DIR, PROJECT_CONFIG_FILENAME);
}

/** Per-project shortcuts written before the home-directory rename. Read-only fallback. */
function getLegacyRuntimeProjectConfigPath(cwd: string): string {
	return join(resolve(cwd), LEGACY_PROJECT_CONFIG_PARENT_DIR, PROJECT_CONFIG_DIR, PROJECT_CONFIG_FILENAME);
}

interface RuntimeConfigPaths {
	globalConfigPath: string;
	projectConfigPath: string | null;
}

function normalizePathForComparison(path: string): string {
	const normalized = resolve(path).replaceAll("\\", "/");
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function resolveRuntimeConfigPaths(cwd: string | null): RuntimeConfigPaths {
	const globalConfigPath = getRuntimeGlobalConfigPath();
	if (cwd === null) {
		return {
			globalConfigPath,
			projectConfigPath: null,
		};
	}

	const normalizedCwd = normalizePathForComparison(cwd);
	const normalizedHome = normalizePathForComparison(homedir());
	if (normalizedCwd === normalizedHome) {
		return {
			globalConfigPath,
			projectConfigPath: null,
		};
	}

	return {
		globalConfigPath,
		projectConfigPath: getRuntimeProjectConfigPath(cwd),
	};
}

function getRuntimeConfigLockRequests(cwd: string | null): LockRequest[] {
	const paths = resolveRuntimeConfigPaths(cwd);
	const requests: LockRequest[] = [
		{
			path: paths.globalConfigPath,
			type: "file",
		},
	];
	if (paths.projectConfigPath) {
		requests.push({
			path: paths.projectConfigPath,
			type: "file",
		});
	}
	return requests;
}

function toRuntimeConfigState({
	globalConfigPath,
	projectConfigPath,
	globalConfig,
	projectConfig,
}: {
	globalConfigPath: string;
	projectConfigPath: string | null;
	globalConfig: RuntimeGlobalConfigFileShape | null;
	projectConfig: RuntimeProjectConfigFileShape | null;
}): RuntimeConfigState {
	return {
		globalConfigPath,
		projectConfigPath,
		selectedAgentId: normalizeAgentId(globalConfig?.selectedAgentId),
		selectedShortcutLabel: normalizeShortcutLabel(globalConfig?.selectedShortcutLabel),
		agentAutonomousModeEnabled: normalizeBoolean(
			globalConfig?.agentAutonomousModeEnabled,
			DEFAULT_AGENT_AUTONOMOUS_MODE_ENABLED,
		),
		readyForReviewNotificationsEnabled: normalizeBoolean(
			globalConfig?.readyForReviewNotificationsEnabled,
			DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED,
		),
		shortcuts: normalizeShortcuts(projectConfig?.shortcuts),
		commitPromptTemplate: normalizePromptTemplate(globalConfig?.commitPromptTemplate, DEFAULT_COMMIT_PROMPT_TEMPLATE),
		openPrPromptTemplate: normalizePromptTemplate(
			globalConfig?.openPrPromptTemplate,
			DEFAULT_OPEN_PR_PROMPT_TEMPLATE,
		),
		commitPromptTemplateDefault: DEFAULT_COMMIT_PROMPT_TEMPLATE,
		openPrPromptTemplateDefault: DEFAULT_OPEN_PR_PROMPT_TEMPLATE,
		agentDisplayName: normalizeAgentDisplayName(globalConfig?.agentDisplayName),
		seamCommentTagTemplate: normalizePromptTemplate(
			globalConfig?.seamCommentTagTemplate,
			DEFAULT_SEAM_COMMENT_TAG_TEMPLATE,
		),
		seamCommentTagTemplateDefault: DEFAULT_SEAM_COMMENT_TAG_TEMPLATE,
	};
}

async function readRuntimeConfigFile<T>(configPath: string): Promise<T | null> {
	try {
		const raw = await readFile(configPath, "utf8");
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

async function writeRuntimeGlobalConfigFile(
	configPath: string,
	config: {
		selectedAgentId?: RuntimeAgentId;
		selectedShortcutLabel?: string | null;
		agentAutonomousModeEnabled?: boolean;
		readyForReviewNotificationsEnabled?: boolean;
		commitPromptTemplate?: string;
		openPrPromptTemplate?: string;
		agentDisplayName?: string;
		seamCommentTagTemplate?: string;
	},
): Promise<void> {
	const existing = await readRuntimeConfigFile<RuntimeGlobalConfigFileShape>(configPath);
	const selectedAgentId = config.selectedAgentId === undefined ? undefined : normalizeAgentId(config.selectedAgentId);
	const existingSelectedAgentId = hasOwnKey(existing, "selectedAgentId")
		? normalizeAgentId(existing?.selectedAgentId)
		: undefined;
	const selectedShortcutLabel =
		config.selectedShortcutLabel === undefined ? undefined : normalizeShortcutLabel(config.selectedShortcutLabel);
	const existingSelectedShortcutLabel = hasOwnKey(existing, "selectedShortcutLabel")
		? normalizeShortcutLabel(existing?.selectedShortcutLabel)
		: undefined;
	const agentAutonomousModeEnabled =
		config.agentAutonomousModeEnabled === undefined
			? DEFAULT_AGENT_AUTONOMOUS_MODE_ENABLED
			: normalizeBoolean(config.agentAutonomousModeEnabled, DEFAULT_AGENT_AUTONOMOUS_MODE_ENABLED);
	const readyForReviewNotificationsEnabled =
		config.readyForReviewNotificationsEnabled === undefined
			? DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED
			: normalizeBoolean(config.readyForReviewNotificationsEnabled, DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED);
	const commitPromptTemplate =
		config.commitPromptTemplate === undefined
			? DEFAULT_COMMIT_PROMPT_TEMPLATE
			: normalizePromptTemplate(config.commitPromptTemplate, DEFAULT_COMMIT_PROMPT_TEMPLATE);
	const openPrPromptTemplate =
		config.openPrPromptTemplate === undefined
			? DEFAULT_OPEN_PR_PROMPT_TEMPLATE
			: normalizePromptTemplate(config.openPrPromptTemplate, DEFAULT_OPEN_PR_PROMPT_TEMPLATE);
	const agentDisplayName =
		config.agentDisplayName === undefined ? "" : normalizeAgentDisplayName(config.agentDisplayName);
	const seamCommentTagTemplate =
		config.seamCommentTagTemplate === undefined
			? DEFAULT_SEAM_COMMENT_TAG_TEMPLATE
			: normalizePromptTemplate(config.seamCommentTagTemplate, DEFAULT_SEAM_COMMENT_TAG_TEMPLATE);

	const payload: RuntimeGlobalConfigFileShape = {};
	if (selectedAgentId !== undefined) {
		if (hasOwnKey(existing, "selectedAgentId") || selectedAgentId !== DEFAULT_AGENT_ID) {
			payload.selectedAgentId = selectedAgentId;
		}
	} else if (existingSelectedAgentId !== undefined) {
		payload.selectedAgentId = existingSelectedAgentId;
	}
	if (selectedShortcutLabel !== undefined) {
		if (selectedShortcutLabel) {
			payload.selectedShortcutLabel = selectedShortcutLabel;
		}
	} else if (existingSelectedShortcutLabel) {
		payload.selectedShortcutLabel = existingSelectedShortcutLabel;
	}
	if (
		hasOwnKey(existing, "agentAutonomousModeEnabled") ||
		agentAutonomousModeEnabled !== DEFAULT_AGENT_AUTONOMOUS_MODE_ENABLED
	) {
		payload.agentAutonomousModeEnabled = agentAutonomousModeEnabled;
	}
	if (
		hasOwnKey(existing, "readyForReviewNotificationsEnabled") ||
		readyForReviewNotificationsEnabled !== DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED
	) {
		payload.readyForReviewNotificationsEnabled = readyForReviewNotificationsEnabled;
	}
	if (hasOwnKey(existing, "commitPromptTemplate") || commitPromptTemplate !== DEFAULT_COMMIT_PROMPT_TEMPLATE) {
		payload.commitPromptTemplate = commitPromptTemplate;
	}
	if (hasOwnKey(existing, "openPrPromptTemplate") || openPrPromptTemplate !== DEFAULT_OPEN_PR_PROMPT_TEMPLATE) {
		payload.openPrPromptTemplate = openPrPromptTemplate;
	}
	if (hasOwnKey(existing, "agentDisplayName") || agentDisplayName !== "") {
		payload.agentDisplayName = agentDisplayName;
	}
	if (
		hasOwnKey(existing, "seamCommentTagTemplate") ||
		seamCommentTagTemplate !== DEFAULT_SEAM_COMMENT_TAG_TEMPLATE
	) {
		payload.seamCommentTagTemplate = seamCommentTagTemplate;
	}

	await lockedFileSystem.writeJsonFileAtomic(configPath, payload, {
		lock: null,
	});
}

async function writeRuntimeProjectConfigFile(
	configPath: string | null,
	config: { shortcuts: RuntimeProjectShortcut[] },
): Promise<void> {
	const normalizedShortcuts = normalizeShortcuts(config.shortcuts);
	if (!configPath) {
		if (normalizedShortcuts.length > 0) {
			throw new Error("Cannot save project shortcuts without a selected project.");
		}
		return;
	}
	if (normalizedShortcuts.length === 0) {
		await rm(configPath, { force: true });
		try {
			await rm(dirname(configPath));
		} catch {
			// Ignore missing or non-empty project config directories.
		}
		return;
	}
	await lockedFileSystem.writeJsonFileAtomic(
		configPath,
		{
			shortcuts: normalizedShortcuts,
		} satisfies RuntimeProjectConfigFileShape,
		{
			lock: null,
		},
	);
}

interface RuntimeConfigFiles {
	globalConfigPath: string;
	projectConfigPath: string | null;
	globalConfig: RuntimeGlobalConfigFileShape | null;
	projectConfig: RuntimeProjectConfigFileShape | null;
}

async function readRuntimeConfigFiles(cwd: string | null): Promise<RuntimeConfigFiles> {
	const { globalConfigPath, projectConfigPath } = resolveRuntimeConfigPaths(cwd);
	// Project shortcuts fall back to the pre-rename location so a repo carrying only
	// the legacy file keeps its shortcuts; writes always go to the current path.
	const projectConfig = projectConfigPath
		? ((await readRuntimeConfigFile<RuntimeProjectConfigFileShape>(projectConfigPath)) ??
			(cwd === null
				? null
				: await readRuntimeConfigFile<RuntimeProjectConfigFileShape>(getLegacyRuntimeProjectConfigPath(cwd))))
		: null;
	return {
		globalConfigPath,
		projectConfigPath,
		globalConfig: await readRuntimeConfigFile<RuntimeGlobalConfigFileShape>(globalConfigPath),
		projectConfig,
	};
}

async function loadRuntimeConfigLocked(cwd: string | null): Promise<RuntimeConfigState> {
	const configFiles = await readRuntimeConfigFiles(cwd);
	// Empty `{}` (or a file with no selectedAgentId) is treated like a first boot so we
	// persist an explicit default instead of silently coercing to Claude forever.
	const needsAgentSelection =
		configFiles.globalConfig === null ||
		!hasOwnKey(configFiles.globalConfig, "selectedAgentId") ||
		configFiles.globalConfig.selectedAgentId === undefined ||
		configFiles.globalConfig.selectedAgentId === null;
	if (needsAgentSelection) {
		const autoSelectedAgentId = pickBestInstalledAgentId();
		if (autoSelectedAgentId) {
			await writeRuntimeGlobalConfigFile(configFiles.globalConfigPath, {
				selectedAgentId: autoSelectedAgentId,
			});
			configFiles.globalConfig = {
				...(configFiles.globalConfig ?? {}),
				selectedAgentId: autoSelectedAgentId,
			};
		}
	}
	return toRuntimeConfigState(configFiles);
}

function createRuntimeConfigStateFromValues(input: {
	globalConfigPath: string;
	projectConfigPath: string | null;
	selectedAgentId: RuntimeAgentId;
	selectedShortcutLabel: string | null;
	agentAutonomousModeEnabled: boolean;
	readyForReviewNotificationsEnabled: boolean;
	shortcuts: RuntimeProjectShortcut[];
	commitPromptTemplate: string;
	openPrPromptTemplate: string;
	agentDisplayName: string;
	seamCommentTagTemplate: string;
}): RuntimeConfigState {
	return {
		globalConfigPath: input.globalConfigPath,
		projectConfigPath: input.projectConfigPath,
		selectedAgentId: normalizeAgentId(input.selectedAgentId),
		selectedShortcutLabel: normalizeShortcutLabel(input.selectedShortcutLabel),
		agentAutonomousModeEnabled: normalizeBoolean(
			input.agentAutonomousModeEnabled,
			DEFAULT_AGENT_AUTONOMOUS_MODE_ENABLED,
		),
		readyForReviewNotificationsEnabled: normalizeBoolean(
			input.readyForReviewNotificationsEnabled,
			DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED,
		),
		shortcuts: normalizeShortcuts(input.shortcuts),
		commitPromptTemplate: normalizePromptTemplate(input.commitPromptTemplate, DEFAULT_COMMIT_PROMPT_TEMPLATE),
		openPrPromptTemplate: normalizePromptTemplate(input.openPrPromptTemplate, DEFAULT_OPEN_PR_PROMPT_TEMPLATE),
		commitPromptTemplateDefault: DEFAULT_COMMIT_PROMPT_TEMPLATE,
		openPrPromptTemplateDefault: DEFAULT_OPEN_PR_PROMPT_TEMPLATE,
		agentDisplayName: normalizeAgentDisplayName(input.agentDisplayName),
		seamCommentTagTemplate: normalizePromptTemplate(
			input.seamCommentTagTemplate,
			DEFAULT_SEAM_COMMENT_TAG_TEMPLATE,
		),
		seamCommentTagTemplateDefault: DEFAULT_SEAM_COMMENT_TAG_TEMPLATE,
	};
}

export function toGlobalRuntimeConfigState(current: RuntimeConfigState): RuntimeConfigState {
	return createRuntimeConfigStateFromValues({
		globalConfigPath: current.globalConfigPath,
		projectConfigPath: null,
		selectedAgentId: current.selectedAgentId,
		selectedShortcutLabel: current.selectedShortcutLabel,
		agentAutonomousModeEnabled: current.agentAutonomousModeEnabled,
		readyForReviewNotificationsEnabled: current.readyForReviewNotificationsEnabled,
		shortcuts: [],
		commitPromptTemplate: current.commitPromptTemplate,
		openPrPromptTemplate: current.openPrPromptTemplate,
		agentDisplayName: current.agentDisplayName,
		seamCommentTagTemplate: current.seamCommentTagTemplate,
	});
}

export async function loadRuntimeConfig(cwd: string): Promise<RuntimeConfigState> {
	const configFiles = await readRuntimeConfigFiles(cwd);
	if (configFiles.globalConfig !== null) {
		return toRuntimeConfigState(configFiles);
	}
	return await lockedFileSystem.withLocks(
		getRuntimeConfigLockRequests(cwd),
		async () => await loadRuntimeConfigLocked(cwd),
	);
}

export async function loadGlobalRuntimeConfig(): Promise<RuntimeConfigState> {
	const configFiles = await readRuntimeConfigFiles(null);
	if (configFiles.globalConfig !== null) {
		return toRuntimeConfigState(configFiles);
	}
	return await lockedFileSystem.withLocks(
		getRuntimeConfigLockRequests(null),
		async () => await loadRuntimeConfigLocked(null),
	);
}

export async function saveRuntimeConfig(
	cwd: string,
	config: {
		selectedAgentId: RuntimeAgentId;
		selectedShortcutLabel: string | null;
		agentAutonomousModeEnabled: boolean;
		readyForReviewNotificationsEnabled: boolean;
		shortcuts: RuntimeProjectShortcut[];
		commitPromptTemplate: string;
		openPrPromptTemplate: string;
		agentDisplayName: string;
		seamCommentTagTemplate: string;
	},
): Promise<RuntimeConfigState> {
	const { globalConfigPath, projectConfigPath } = resolveRuntimeConfigPaths(cwd);
	return await lockedFileSystem.withLocks(getRuntimeConfigLockRequests(cwd), async () => {
		await writeRuntimeGlobalConfigFile(globalConfigPath, {
			selectedAgentId: config.selectedAgentId,
			selectedShortcutLabel: config.selectedShortcutLabel,
			agentAutonomousModeEnabled: config.agentAutonomousModeEnabled,
			readyForReviewNotificationsEnabled: config.readyForReviewNotificationsEnabled,
			commitPromptTemplate: config.commitPromptTemplate,
			openPrPromptTemplate: config.openPrPromptTemplate,
			agentDisplayName: config.agentDisplayName,
			seamCommentTagTemplate: config.seamCommentTagTemplate,
		});
		await writeRuntimeProjectConfigFile(projectConfigPath, { shortcuts: config.shortcuts });
		return createRuntimeConfigStateFromValues({
			globalConfigPath,
			projectConfigPath,
			selectedAgentId: config.selectedAgentId,
			selectedShortcutLabel: config.selectedShortcutLabel,
			agentAutonomousModeEnabled: config.agentAutonomousModeEnabled,
			readyForReviewNotificationsEnabled: config.readyForReviewNotificationsEnabled,
			shortcuts: config.shortcuts,
			commitPromptTemplate: config.commitPromptTemplate,
			openPrPromptTemplate: config.openPrPromptTemplate,
			agentDisplayName: config.agentDisplayName,
			seamCommentTagTemplate: config.seamCommentTagTemplate,
		});
	});
}

export async function updateRuntimeConfig(cwd: string, updates: RuntimeConfigUpdateInput): Promise<RuntimeConfigState> {
	const { globalConfigPath, projectConfigPath } = resolveRuntimeConfigPaths(cwd);
	return await lockedFileSystem.withLocks(getRuntimeConfigLockRequests(cwd), async () => {
		const current = await loadRuntimeConfigLocked(cwd);
		if (projectConfigPath === null && normalizeShortcuts(updates.shortcuts).length > 0) {
			throw new Error("Cannot save project shortcuts without a selected project.");
		}
		const nextConfig = {
			selectedAgentId: updates.selectedAgentId ?? current.selectedAgentId,
			selectedShortcutLabel:
				updates.selectedShortcutLabel === undefined ? current.selectedShortcutLabel : updates.selectedShortcutLabel,
			agentAutonomousModeEnabled: updates.agentAutonomousModeEnabled ?? current.agentAutonomousModeEnabled,
			readyForReviewNotificationsEnabled:
				updates.readyForReviewNotificationsEnabled ?? current.readyForReviewNotificationsEnabled,
			shortcuts: projectConfigPath ? (updates.shortcuts ?? current.shortcuts) : current.shortcuts,
			commitPromptTemplate: updates.commitPromptTemplate ?? current.commitPromptTemplate,
			openPrPromptTemplate: updates.openPrPromptTemplate ?? current.openPrPromptTemplate,
			agentDisplayName: updates.agentDisplayName ?? current.agentDisplayName,
			seamCommentTagTemplate: updates.seamCommentTagTemplate ?? current.seamCommentTagTemplate,
		};

		const hasChanges =
			nextConfig.selectedAgentId !== current.selectedAgentId ||
			nextConfig.selectedShortcutLabel !== current.selectedShortcutLabel ||
			nextConfig.agentAutonomousModeEnabled !== current.agentAutonomousModeEnabled ||
			nextConfig.readyForReviewNotificationsEnabled !== current.readyForReviewNotificationsEnabled ||
			nextConfig.commitPromptTemplate !== current.commitPromptTemplate ||
			nextConfig.openPrPromptTemplate !== current.openPrPromptTemplate ||
			nextConfig.agentDisplayName !== current.agentDisplayName ||
			nextConfig.seamCommentTagTemplate !== current.seamCommentTagTemplate ||
			!areRuntimeProjectShortcutsEqual(nextConfig.shortcuts, current.shortcuts);

		if (!hasChanges) {
			return current;
		}

		await writeRuntimeGlobalConfigFile(globalConfigPath, {
			selectedAgentId: nextConfig.selectedAgentId,
			selectedShortcutLabel: nextConfig.selectedShortcutLabel,
			agentAutonomousModeEnabled: nextConfig.agentAutonomousModeEnabled,
			readyForReviewNotificationsEnabled: nextConfig.readyForReviewNotificationsEnabled,
			commitPromptTemplate: nextConfig.commitPromptTemplate,
			openPrPromptTemplate: nextConfig.openPrPromptTemplate,
			agentDisplayName: nextConfig.agentDisplayName,
			seamCommentTagTemplate: nextConfig.seamCommentTagTemplate,
		});
		await writeRuntimeProjectConfigFile(projectConfigPath, {
			shortcuts: nextConfig.shortcuts,
		});
		return createRuntimeConfigStateFromValues({
			globalConfigPath,
			projectConfigPath,
			selectedAgentId: nextConfig.selectedAgentId,
			selectedShortcutLabel: nextConfig.selectedShortcutLabel,
			agentAutonomousModeEnabled: nextConfig.agentAutonomousModeEnabled,
			readyForReviewNotificationsEnabled: nextConfig.readyForReviewNotificationsEnabled,
			shortcuts: nextConfig.shortcuts,
			commitPromptTemplate: nextConfig.commitPromptTemplate,
			openPrPromptTemplate: nextConfig.openPrPromptTemplate,
			agentDisplayName: nextConfig.agentDisplayName,
			seamCommentTagTemplate: nextConfig.seamCommentTagTemplate,
		});
	});
}

export async function updateGlobalRuntimeConfig(
	current: RuntimeConfigState,
	updates: RuntimeConfigUpdateInput,
): Promise<RuntimeConfigState> {
	const globalConfigPath = getRuntimeGlobalConfigPath();
	return await lockedFileSystem.withLocks(
		[
			{
				path: globalConfigPath,
				type: "file",
			},
		],
		async () => {
			const nextConfig = {
				selectedAgentId: updates.selectedAgentId ?? current.selectedAgentId,
				selectedShortcutLabel:
					updates.selectedShortcutLabel === undefined
						? current.selectedShortcutLabel
						: updates.selectedShortcutLabel,
				agentAutonomousModeEnabled: updates.agentAutonomousModeEnabled ?? current.agentAutonomousModeEnabled,
				readyForReviewNotificationsEnabled:
					updates.readyForReviewNotificationsEnabled ?? current.readyForReviewNotificationsEnabled,
				shortcuts: current.shortcuts,
				commitPromptTemplate: updates.commitPromptTemplate ?? current.commitPromptTemplate,
				openPrPromptTemplate: updates.openPrPromptTemplate ?? current.openPrPromptTemplate,
				agentDisplayName: updates.agentDisplayName ?? current.agentDisplayName,
				seamCommentTagTemplate: updates.seamCommentTagTemplate ?? current.seamCommentTagTemplate,
			};

			const hasChanges =
				nextConfig.selectedAgentId !== current.selectedAgentId ||
				nextConfig.selectedShortcutLabel !== current.selectedShortcutLabel ||
				nextConfig.agentAutonomousModeEnabled !== current.agentAutonomousModeEnabled ||
				nextConfig.readyForReviewNotificationsEnabled !== current.readyForReviewNotificationsEnabled ||
				nextConfig.commitPromptTemplate !== current.commitPromptTemplate ||
				nextConfig.openPrPromptTemplate !== current.openPrPromptTemplate ||
				nextConfig.agentDisplayName !== current.agentDisplayName ||
				nextConfig.seamCommentTagTemplate !== current.seamCommentTagTemplate;

			if (!hasChanges) {
				return current;
			}

			await writeRuntimeGlobalConfigFile(globalConfigPath, {
				selectedAgentId: nextConfig.selectedAgentId,
				selectedShortcutLabel: nextConfig.selectedShortcutLabel,
				agentAutonomousModeEnabled: nextConfig.agentAutonomousModeEnabled,
				readyForReviewNotificationsEnabled: nextConfig.readyForReviewNotificationsEnabled,
				commitPromptTemplate: nextConfig.commitPromptTemplate,
				openPrPromptTemplate: nextConfig.openPrPromptTemplate,
				agentDisplayName: nextConfig.agentDisplayName,
				seamCommentTagTemplate: nextConfig.seamCommentTagTemplate,
			});

			return createRuntimeConfigStateFromValues({
				globalConfigPath,
				projectConfigPath: current.projectConfigPath,
				selectedAgentId: nextConfig.selectedAgentId,
				selectedShortcutLabel: nextConfig.selectedShortcutLabel,
				agentAutonomousModeEnabled: nextConfig.agentAutonomousModeEnabled,
				readyForReviewNotificationsEnabled: nextConfig.readyForReviewNotificationsEnabled,
				shortcuts: nextConfig.shortcuts,
				commitPromptTemplate: nextConfig.commitPromptTemplate,
				openPrPromptTemplate: nextConfig.openPrPromptTemplate,
				agentDisplayName: nextConfig.agentDisplayName,
				seamCommentTagTemplate: nextConfig.seamCommentTagTemplate,
			});
		},
	);
}
