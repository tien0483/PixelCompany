// Recovers the permission mode a Claude Code session was actually in, so a relaunch can
// re-enter it instead of falling back to the launch-time default.
//
// Why this is needed: the mode is only ever a launch flag here (`--permission-mode auto`
// from the global autonomous-mode setting, or `--permission-mode plan` from the card), and
// nothing in the runtime observes the user cycling it with shift+tab mid-session. Claude
// Code does not restore it either — its own warning says so verbatim: "--resume does not
// restore permissionMode — pass --permission-mode <mode> to match". So every replay of a
// start request (crash auto-restart, login-expired same-seat recovery, cross-seat failover,
// a manual restart/resume) used to re-impose the configured default, silently moving a
// session the user had put in plan (or manual) mode back into auto.
//
// The source of truth is Claude Code's own session transcript: it appends a dedicated
// `{"type":"permission-mode","permissionMode":"..."}` record on every mode change, and
// stamps `permissionMode` on each user message. That is read here rather than scraped from
// the PTY, where the mode only exists as a redrawn status line ("auto mode on") that ANSI
// wrapping can split.
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ClaudeLaunchPermissionSetting } from "../config/agent-launch-options";

/**
 * Claude Code's permission modes, as its CLI validates them (2.1.231:
 * `["acceptEdits","auto","bypassPermissions","default","dontAsk","plan"]`). "default" is
 * accepted by `--permission-mode` alongside its display alias "manual".
 */
export const CLAUDE_PERMISSION_MODES = [
	"default",
	"acceptEdits",
	"plan",
	"auto",
	"bypassPermissions",
	"dontAsk",
] as const;

export type ClaudePermissionMode = (typeof CLAUDE_PERMISSION_MODES)[number];

/** Only the tail of a transcript is read: every user turn re-stamps the mode. */
const TRANSCRIPT_TAIL_BYTES = 512 * 1024;

export function parseClaudePermissionMode(value: unknown): ClaudePermissionMode | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	// "manual" is the CLI/UI label for "default"; the transcript uses the internal name.
	const normalized = trimmed === "manual" ? "default" : trimmed;
	return (CLAUDE_PERMISSION_MODES as readonly string[]).includes(normalized)
		? (normalized as ClaudePermissionMode)
		: null;
}

/**
 * CLI flags that re-enter `mode`. Bypass is expressed as `--dangerously-skip-permissions`
 * (what Claude Code's own launcher emits for it) because `--permission-mode
 * bypassPermissions` is additionally gated on the bypass dialog having been accepted.
 */
export function claudePermissionModeArgs(mode: ClaudePermissionMode): string[] {
	return mode === "bypassPermissions" ? ["--dangerously-skip-permissions"] : ["--permission-mode", mode];
}

/**
 * Claude Code names a transcript directory after the cwd, flattening both `/` and `.` to
 * `-` (`/home/u/.agent/x` → `-home-u--agent-x`). The mapping is lossy in the decode
 * direction only, which does not matter here — this always encodes.
 */
export function encodeClaudeProjectDirName(cwd: string): string {
	return cwd.replaceAll("/", "-").replaceAll(".", "-");
}

async function readFileTail(path: string, maxBytes: number): Promise<string | null> {
	let handle: Awaited<ReturnType<typeof open>> | null = null;
	try {
		handle = await open(path, "r");
		const { size } = await handle.stat();
		if (size === 0) {
			return null;
		}
		const length = Math.min(size, maxBytes);
		const buffer = Buffer.allocUnsafe(length);
		const { bytesRead } = await handle.read(buffer, 0, length, size - length);
		const text = buffer.subarray(0, bytesRead).toString("utf8");
		// A tail read almost always starts mid-line; that fragment is not parseable JSON.
		return length < size ? text.slice(text.indexOf("\n") + 1) : text;
	} catch {
		return null;
	} finally {
		await handle?.close().catch(() => undefined);
	}
}

async function findNewestTranscript(projectDir: string): Promise<string | null> {
	let entries: string[];
	try {
		entries = await readdir(projectDir);
	} catch {
		return null;
	}
	let newestPath: string | null = null;
	let newestMtimeMs = Number.NEGATIVE_INFINITY;
	for (const entry of entries) {
		if (!entry.endsWith(".jsonl")) {
			continue;
		}
		const path = join(projectDir, entry);
		try {
			const stats = await stat(path);
			if (stats.isFile() && stats.mtimeMs > newestMtimeMs) {
				newestMtimeMs = stats.mtimeMs;
				newestPath = path;
			}
		} catch {
			// Transcript rotated away between readdir and stat; nothing to consider.
		}
	}
	return newestPath;
}

function readModeFromTranscriptTail(tail: string): ClaudePermissionMode | null {
	const lines = tail.split("\n");
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index]?.trim();
		if (!line) {
			continue;
		}
		let record: unknown;
		try {
			record = JSON.parse(line);
		} catch {
			continue;
		}
		if (typeof record !== "object" || record === null) {
			continue;
		}
		const entry = record as { type?: unknown; isSidechain?: unknown; permissionMode?: unknown };
		// Subagent turns are recorded in the same file and carry the parent's mode at best,
		// so they are never treated as evidence of what the main session is in.
		if (entry.isSidechain === true) {
			continue;
		}
		if (entry.type !== "permission-mode" && entry.type !== "user") {
			continue;
		}
		const mode = parseClaudePermissionMode(entry.permissionMode);
		if (mode !== null) {
			return mode;
		}
	}
	return null;
}

export interface LastClaudePermissionModeOptions {
	/** The session's working directory — what Claude Code derives the transcript dir from. */
	cwd: string;
	/** The session's `CLAUDE_CONFIG_DIR`, when it is pinned to a seat or task-scoped dir. */
	claudeConfigDir?: string | null;
	/** Overridable for tests; defaults to `~/.claude`. */
	defaultClaudeHomeDir?: string;
}

/**
 * The mode of the most recent conversation in `cwd`, or null when there is no transcript to
 * read (a first start, a purged worktree, a transcript whose tail predates any mode record).
 *
 * The newest transcript in the directory is the one `--continue` will resume, which is why
 * this picks by mtime rather than trying to correlate session ids.
 */
export async function readLastClaudePermissionMode(
	options: LastClaudePermissionModeOptions,
): Promise<ClaudePermissionMode | null> {
	const cwd = options.cwd?.trim();
	if (!cwd) {
		return null;
	}
	const claudeHomeDir = options.claudeConfigDir?.trim() || options.defaultClaudeHomeDir || join(homedir(), ".claude");
	const projectDir = join(claudeHomeDir, "projects", encodeClaudeProjectDirName(cwd));
	const transcript = await findNewestTranscript(projectDir);
	if (transcript === null) {
		return null;
	}
	const tail = await readFileTail(transcript, TRANSCRIPT_TAIL_BYTES);
	return tail === null ? null : readModeFromTranscriptTail(tail);
}

export interface ClaudeLaunchPermissionModeInput {
	/** What the session was last in, per its transcript. Null when unknown. */
	recordedMode: ClaudePermissionMode | null;
	startInPlanMode: boolean;
	autonomousModeEnabled: boolean;
	/** Global Settings value for Claude Code; applied when no recorded mode exists. */
	configuredPermissionMode?: ClaudeLaunchPermissionSetting;
	/** True when the caller's args already name a mode (`--permission-mode` / bypass). */
	hasExplicitModeArg: boolean;
}

/**
 * Which mode a launch should enter, or null to leave the args untouched.
 *
 * A recorded mode wins over both card and global defaults, because it is the mode the user
 * last chose for this very conversation. Plan mode still beats an explicit bypass flag,
 * which is pre-existing behaviour: "start in plan mode" is a hard constraint on the card.
 */
export function resolveClaudeLaunchPermissionMode(input: ClaudeLaunchPermissionModeInput): ClaudePermissionMode | null {
	if (input.recordedMode !== null) {
		return input.recordedMode;
	}
	if (input.startInPlanMode) {
		return "plan";
	}
	if (input.configuredPermissionMode === "off") {
		return null;
	}
	if (input.configuredPermissionMode !== undefined) {
		if (input.configuredPermissionMode === "auto") {
			return "auto";
		}
		if (input.configuredPermissionMode === "plan") {
			return "plan";
		}
		if (input.configuredPermissionMode === "acceptEdits") {
			return "acceptEdits";
		}
	}
	if (input.autonomousModeEnabled && !input.hasExplicitModeArg) {
		return "auto";
	}
	return null;
}
