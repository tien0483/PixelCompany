import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	claudePermissionModeArgs,
	encodeClaudeProjectDirName,
	parseClaudePermissionMode,
	readLastClaudePermissionMode,
	resolveClaudeLaunchPermissionMode,
} from "./claude-permission-mode";

describe("parseClaudePermissionMode", () => {
	it("accepts every mode the CLI validates", () => {
		expect(parseClaudePermissionMode("auto")).toBe("auto");
		expect(parseClaudePermissionMode("plan")).toBe("plan");
		expect(parseClaudePermissionMode("acceptEdits")).toBe("acceptEdits");
		expect(parseClaudePermissionMode("bypassPermissions")).toBe("bypassPermissions");
		expect(parseClaudePermissionMode("dontAsk")).toBe("dontAsk");
	});

	it("normalizes the CLI's display alias for default", () => {
		expect(parseClaudePermissionMode("manual")).toBe("default");
		expect(parseClaudePermissionMode("default")).toBe("default");
	});

	it("rejects anything else", () => {
		expect(parseClaudePermissionMode("Auto")).toBeNull();
		expect(parseClaudePermissionMode("")).toBeNull();
		expect(parseClaudePermissionMode(undefined)).toBeNull();
		expect(parseClaudePermissionMode(3)).toBeNull();
	});
});

describe("claudePermissionModeArgs", () => {
	it("uses the bypass flag rather than the mode name for bypassPermissions", () => {
		expect(claudePermissionModeArgs("bypassPermissions")).toEqual(["--dangerously-skip-permissions"]);
	});

	it("passes every other mode through --permission-mode", () => {
		expect(claudePermissionModeArgs("plan")).toEqual(["--permission-mode", "plan"]);
		expect(claudePermissionModeArgs("default")).toEqual(["--permission-mode", "default"]);
	});
});

describe("encodeClaudeProjectDirName", () => {
	it("flattens both slashes and dots, matching Claude Code's naming", () => {
		expect(encodeClaudeProjectDirName("/home/u/.agent/worktrees/7d5e3/Repo")).toBe(
			"-home-u--agent-worktrees-7d5e3-Repo",
		);
	});
});

describe("resolveClaudeLaunchPermissionMode", () => {
	it("prefers the recorded mode over the card and global defaults", () => {
		expect(
			resolveClaudeLaunchPermissionMode({
				recordedMode: "plan",
				startInPlanMode: false,
				autonomousModeEnabled: true,
				hasExplicitModeArg: false,
			}),
		).toBe("plan");
	});

	it("keeps a recorded manual/default session out of auto", () => {
		expect(
			resolveClaudeLaunchPermissionMode({
				recordedMode: "default",
				startInPlanMode: true,
				autonomousModeEnabled: true,
				hasExplicitModeArg: false,
			}),
		).toBe("default");
	});

	it("falls back to plan mode for a card that starts in it", () => {
		expect(
			resolveClaudeLaunchPermissionMode({
				recordedMode: null,
				startInPlanMode: true,
				autonomousModeEnabled: true,
				hasExplicitModeArg: true,
			}),
		).toBe("plan");
	});

	it("falls back to auto only when nothing else names a mode", () => {
		expect(
			resolveClaudeLaunchPermissionMode({
				recordedMode: null,
				startInPlanMode: false,
				autonomousModeEnabled: true,
				hasExplicitModeArg: false,
			}),
		).toBe("auto");
	});

	it("leaves explicit args alone", () => {
		expect(
			resolveClaudeLaunchPermissionMode({
				recordedMode: null,
				startInPlanMode: false,
				autonomousModeEnabled: true,
				hasExplicitModeArg: true,
			}),
		).toBeNull();
		expect(
			resolveClaudeLaunchPermissionMode({
				recordedMode: null,
				startInPlanMode: false,
				autonomousModeEnabled: false,
				hasExplicitModeArg: false,
			}),
		).toBeNull();
	});
});

describe("readLastClaudePermissionMode", () => {
	const cwd = "/repo/worktrees/task-1";
	const createdDirs: string[] = [];

	afterEach(() => {
		createdDirs.length = 0;
	});

	async function createClaudeHome(): Promise<{ claudeHomeDir: string; projectDir: string }> {
		const claudeHomeDir = await mkdtemp(join(tmpdir(), "claude-permission-mode-"));
		createdDirs.push(claudeHomeDir);
		const projectDir = join(claudeHomeDir, "projects", encodeClaudeProjectDirName(cwd));
		await mkdir(projectDir, { recursive: true });
		return { claudeHomeDir, projectDir };
	}

	it("returns the last mode-change record", async () => {
		const { claudeHomeDir, projectDir } = await createClaudeHome();
		await writeFile(
			join(projectDir, "session-a.jsonl"),
			[
				JSON.stringify({ type: "permission-mode", permissionMode: "auto" }),
				JSON.stringify({ type: "user", permissionMode: "auto", message: { role: "user" } }),
				JSON.stringify({ type: "permission-mode", permissionMode: "plan" }),
				JSON.stringify({ type: "assistant", message: { role: "assistant" } }),
				"",
			].join("\n"),
			"utf8",
		);

		await expect(readLastClaudePermissionMode({ cwd, claudeConfigDir: claudeHomeDir })).resolves.toBe("plan");
	});

	it("falls back to the mode stamped on the last user turn", async () => {
		const { claudeHomeDir, projectDir } = await createClaudeHome();
		await writeFile(
			join(projectDir, "session-a.jsonl"),
			`${JSON.stringify({ type: "user", permissionMode: "acceptEdits", message: { role: "user" } })}\n`,
			"utf8",
		);

		await expect(readLastClaudePermissionMode({ cwd, claudeConfigDir: claudeHomeDir })).resolves.toBe("acceptEdits");
	});

	it("ignores subagent turns, which do not carry the main session's mode", async () => {
		const { claudeHomeDir, projectDir } = await createClaudeHome();
		await writeFile(
			join(projectDir, "session-a.jsonl"),
			[
				JSON.stringify({ type: "permission-mode", permissionMode: "plan" }),
				JSON.stringify({ type: "user", permissionMode: "auto", isSidechain: true, message: { role: "user" } }),
				"",
			].join("\n"),
			"utf8",
		);

		await expect(readLastClaudePermissionMode({ cwd, claudeConfigDir: claudeHomeDir })).resolves.toBe("plan");
	});

	it("reads the newest transcript, which is the one --continue resumes", async () => {
		const { claudeHomeDir, projectDir } = await createClaudeHome();
		const older = join(projectDir, "older.jsonl");
		const newer = join(projectDir, "newer.jsonl");
		await writeFile(older, `${JSON.stringify({ type: "permission-mode", permissionMode: "auto" })}\n`, "utf8");
		await writeFile(newer, `${JSON.stringify({ type: "permission-mode", permissionMode: "plan" })}\n`, "utf8");
		const past = new Date(Date.now() - 60_000);
		await utimes(older, past, past);

		await expect(readLastClaudePermissionMode({ cwd, claudeConfigDir: claudeHomeDir })).resolves.toBe("plan");
	});

	it("skips a truncated leading line when only the tail is read", async () => {
		const { claudeHomeDir, projectDir } = await createClaudeHome();
		const padding = JSON.stringify({ type: "assistant", filler: "x".repeat(600 * 1024) });
		await writeFile(
			join(projectDir, "session-a.jsonl"),
			`${padding}\n${JSON.stringify({ type: "permission-mode", permissionMode: "default" })}\n`,
			"utf8",
		);

		await expect(readLastClaudePermissionMode({ cwd, claudeConfigDir: claudeHomeDir })).resolves.toBe("default");
	});

	it("returns null when there is no transcript, or none records a mode", async () => {
		const { claudeHomeDir, projectDir } = await createClaudeHome();
		await expect(readLastClaudePermissionMode({ cwd, claudeConfigDir: claudeHomeDir })).resolves.toBeNull();

		await writeFile(
			join(projectDir, "session-a.jsonl"),
			`${JSON.stringify({ type: "assistant", message: { role: "assistant" } })}\nnot json\n`,
			"utf8",
		);
		await expect(readLastClaudePermissionMode({ cwd, claudeConfigDir: claudeHomeDir })).resolves.toBeNull();
		await expect(readLastClaudePermissionMode({ cwd: "", claudeConfigDir: claudeHomeDir })).resolves.toBeNull();
	});
});
