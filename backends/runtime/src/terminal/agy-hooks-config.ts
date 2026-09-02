import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/** agy reads customizations from `<cwd>/.agents/`; gemini-cli never looks here. */
export const AGY_CUSTOMIZATION_DIR_NAME = ".agents";
export const AGY_HOOKS_FILE_NAME = "hooks.json";

/** Every entry this runtime owns is keyed with this prefix so a re-prepare can drop its own stale rows. */
export const AGY_KANBAN_HOOK_KEY_PREFIX = "kanban-";

const AGY_HOOKS_EXCLUDE_ENTRY = `/${AGY_CUSTOMIZATION_DIR_NAME}/${AGY_HOOKS_FILE_NAME}`;

export type AgyHookCommandBuilder = (args: string[]) => string;

interface AgyCommandHandler {
	type: "command";
	command: string;
}

interface AgyMatcherHandler {
	matcher: string;
	hooks: AgyCommandHandler[];
}

export type AgyHookEntry = Record<string, AgyCommandHandler[] | AgyMatcherHandler[]>;

export function resolveAgyHooksPaths(cwd: string): { dir: string; file: string } {
	const dir = join(cwd, AGY_CUSTOMIZATION_DIR_NAME);
	return { dir, file: join(dir, AGY_HOOKS_FILE_NAME) };
}

function buildAgyFailOpenPreToolCommand(command: string, platform: NodeJS.Platform = process.platform): string {
	if (platform === "win32") {
		return command;
	}
	const escapedCommand = command
		.replaceAll("\\", "\\\\")
		.replaceAll('"', '\\"')
		.replaceAll("$", "\\$")
		.replaceAll("`", "\\`");
	return `bash -c "printf '{}\\\\n'; (cat | ${escapedCommand} >/dev/null 2>&1 || true) & exit 0"`;
}

/**
 * agy's hooks file is name-keyed — one object per named hook, each mapping a native
 * event to its handlers — and it supports only `PreToolUse`, `PostToolUse`,
 * `PreInvocation`, `PostInvocation` and `Stop`. The gemini-cli aliases
 * (`AfterAgent` / `BeforeAgent` / `BeforeTool` / `AfterTool` / `Notification`) are
 * deliberately absent: agy would never fire them, and listing them only invites the
 * next reader to assume it does.
 *
 * Only the two tool events take a `matcher` wrapper; the rest are flat handler lists.
 *
 * The native event name is passed through to `hooks gemini-hook --event`, which maps
 * it back to a Kanban event via `mapGeminiHookEvent`.
 */
export function buildAgyHooksJson(buildCommand: AgyHookCommandBuilder): Record<string, AgyHookEntry> {
	const command = (event: string): AgyCommandHandler => ({
		type: "command",
		command: buildCommand(["gemini-hook", "--event", event]),
	});
	const matched = (handler: AgyCommandHandler): AgyMatcherHandler => ({
		matcher: "*",
		hooks: [handler],
	});
	const preToolCommand: AgyCommandHandler = {
		type: "command",
		command: buildAgyFailOpenPreToolCommand(buildCommand(["gemini-hook", "--event", "PreToolUse"])),
	};

	return {
		[`${AGY_KANBAN_HOOK_KEY_PREFIX}stop`]: { Stop: [command("Stop")] },
		[`${AGY_KANBAN_HOOK_KEY_PREFIX}post-invocation`]: { PostInvocation: [command("PostInvocation")] },
		[`${AGY_KANBAN_HOOK_KEY_PREFIX}pre-invocation`]: { PreInvocation: [command("PreInvocation")] },
		[`${AGY_KANBAN_HOOK_KEY_PREFIX}pre-tool-use`]: { PreToolUse: [matched(preToolCommand)] },
		[`${AGY_KANBAN_HOOK_KEY_PREFIX}post-tool-use`]: { PostToolUse: [matched(command("PostToolUse"))] },
	};
}

export function mergeAgyHooksJson(
	existingContent: string | null,
	kanbanEntries: Record<string, AgyHookEntry>,
): Record<string, unknown> {
	if (existingContent === null) {
		return { ...kanbanEntries };
	}
	let existing: Record<string, unknown>;
	try {
		const parsed: unknown = JSON.parse(existingContent);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return { ...kanbanEntries };
		}
		existing = parsed as Record<string, unknown>;
	} catch {
		// Corrupt file: our entries are the only ones we can vouch for.
		return { ...kanbanEntries };
	}
	const foreign: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(existing)) {
		// Drop our own stale rows so a renamed event never lingers.
		if (key.startsWith(AGY_KANBAN_HOOK_KEY_PREFIX)) {
			continue;
		}
		foreign[key] = value;
	}
	return { ...foreign, ...kanbanEntries };
}

export interface PrepareAgyHooksConfigInput {
	cwd: string;
	buildCommand: AgyHookCommandBuilder;
}

/**
 * Writes task-scoped agy hooks under the worktree, mirroring `prepareProjectMcpConfig`:
 * the worktree is where `KANBAN_HOOK_TASK_ID` / `KANBAN_HOOK_WORKSPACE_ID` are guaranteed
 * to be in the agent's environment, and a per-task file has no global state to reconcile.
 * The returned cleanup restores whatever was there before, or removes the file entirely.
 */
export async function prepareAgyHooksConfig(
	input: PrepareAgyHooksConfigInput,
): Promise<{ file: string; cleanup: () => Promise<void> }> {
	const { dir, file } = resolveAgyHooksPaths(input.cwd);

	let beforeContent: string | null = null;
	try {
		beforeContent = await readFile(file, "utf8");
	} catch {
		beforeContent = null;
	}

	const merged = mergeAgyHooksJson(beforeContent, buildAgyHooksJson(input.buildCommand));
	await mkdir(dir, { recursive: true });
	await writeFile(file, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
	ensureAgyHooksExcluded(input.cwd);

	return {
		file,
		cleanup: async () => {
			if (beforeContent === null) {
				await rm(file, { force: true }).catch(() => {});
				return;
			}
			await writeFile(file, beforeContent, "utf8").catch(() => {});
		},
	};
}

/**
 * Keeps the generated hooks file out of `git status` for the task's own diff.
 *
 * A linked worktree has no private `info/exclude` — git reads that from the *common*
 * git dir — so the entry has to be resolved through `.git` (a file holding
 * `gitdir: <path>` in a worktree) and then that dir's `commondir` pointer.
 *
 * Best-effort throughout: an unwritable exclude is cosmetic and must never stop a launch.
 */
export function ensureAgyHooksExcluded(cwd: string): void {
	try {
		const dotGit = join(cwd, ".git");
		if (!existsSync(dotGit)) {
			return;
		}
		let gitDir = dotGit;
		if (statSync(dotGit).isFile()) {
			const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8").trim());
			if (match?.[1] === undefined) {
				return;
			}
			gitDir = resolve(cwd, match[1].trim());
		}
		const commonDirPointer = join(gitDir, "commondir");
		const commonDir = existsSync(commonDirPointer)
			? resolve(gitDir, readFileSync(commonDirPointer, "utf8").trim())
			: gitDir;

		const infoDir = join(commonDir, "info");
		const excludePath = join(infoDir, "exclude");
		const existing = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
		if (existing.split("\n").some((line) => line.trim() === AGY_HOOKS_EXCLUDE_ENTRY)) {
			return;
		}
		mkdirSync(infoDir, { recursive: true });
		const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
		appendFileSync(
			excludePath,
			`${prefix}# PixelOffice: per-task Antigravity hooks are generated at launch.\n${AGY_HOOKS_EXCLUDE_ENTRY}\n`,
		);
	} catch {
		// Cosmetic only — see above.
	}
}
