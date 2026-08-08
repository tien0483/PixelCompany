import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();
const isBinaryAvailableOnPath = vi.fn(() => true);
const resolveManagerAccountPin = vi.fn();

vi.mock("node:child_process", () => ({
	spawn: (...args: unknown[]) => spawnMock(...args),
}));

vi.mock("../../../src/terminal/command-discovery.js", () => ({
	isBinaryAvailableOnPath: (...args: unknown[]) => isBinaryAvailableOnPath(...args),
}));

vi.mock("../../../src/manager/manager-account-pin.js", () => ({
	resolveManagerAccountPin: (...args: unknown[]) => resolveManagerAccountPin(...args),
	CLAUDE_CONFIG_DIR_ENV: "CLAUDE_CONFIG_DIR",
}));

vi.mock("../../../src/core/windows-cmd-launch.js", () => ({
	shouldUseWindowsCmdLaunch: () => false,
	resolveWindowsComSpec: () => "cmd.exe",
	buildWindowsCmdArgsArray: (binary: string, args: string[]) => [binary, ...args],
}));

import { runAgentOneShot } from "../../../src/terminal/agent-oneshot.js";

function createFakeChild() {
	const child = new EventEmitter() as EventEmitter & {
		stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
		stdout: Readable;
		stderr: Readable;
		kill: ReturnType<typeof vi.fn>;
	};
	child.stdin = { write: vi.fn(), end: vi.fn() };
	child.stdout = Readable.from([]);
	child.stderr = Readable.from([]);
	child.kill = vi.fn();
	return child;
}

describe("runAgentOneShot", () => {
	afterEach(() => {
		spawnMock.mockReset();
		isBinaryAvailableOnPath.mockReset().mockReturnValue(true);
		resolveManagerAccountPin.mockReset();
	});

	it("spawns claude with auto permission mode, stdin prompt, and pin env", async () => {
		const child = createFakeChild();
		spawnMock.mockReturnValue(child);
		resolveManagerAccountPin.mockResolvedValue({
			env: { CLAUDE_CONFIG_DIR: "/tmp/claude-seat" },
			accountId: 7,
			warning: null,
		});

		const events: Array<{ type: string }> = [];
		const running = runAgentOneShot({
			agentId: "claude",
			prompt: "make html",
			cwd: "/tmp/work",
			model: "sonnet",
			onEvent: (event) => events.push(event),
			pinInput: {
				managerAccountId: 7,
				getAccountLaunchDir: async () => ({ configDir: "/tmp/claude-seat" }),
			},
		});

		await vi.waitFor(() => {
			expect(spawnMock).toHaveBeenCalled();
		});

		const [binary, argv, opts] = spawnMock.mock.calls[0] as [
			string,
			string[],
			{ cwd?: string; env?: NodeJS.ProcessEnv },
		];
		expect(binary).toBe("claude");
		expect(argv).toEqual([
			"-p",
			"--output-format",
			"stream-json",
			"--verbose",
			"--include-partial-messages",
			"--permission-mode",
			"auto",
			"--model",
			"sonnet",
		]);
		expect(opts.cwd).toBe("/tmp/work");
		expect(opts.env?.CLAUDE_CONFIG_DIR).toBe("/tmp/claude-seat");
		expect(child.stdin.write).toHaveBeenCalledWith("make html");
		expect(child.stdin.end).toHaveBeenCalled();

		child.emit("close", 0);
		const result = await running;
		expect(result.code).toBe(0);
		expect(events.some((event) => event.type === "start")).toBe(true);
		expect(events.some((event) => event.type === "done")).toBe(true);
	});

	it("passes an explicit --allowedTools list when one is supplied", async () => {
		const child = createFakeChild();
		spawnMock.mockReturnValue(child);
		resolveManagerAccountPin.mockResolvedValue({ env: {}, accountId: null, warning: null });

		const running = runAgentOneShot({
			agentId: "claude",
			prompt: "read the mockup",
			cwd: "/tmp/plans",
			allowedTools: ["Read", "Glob"],
			onEvent: () => {},
			pinInput: { getAccountLaunchDir: async () => null },
		});

		await vi.waitFor(() => {
			expect(spawnMock).toHaveBeenCalled();
		});

		const [, argv] = spawnMock.mock.calls[0] as [string, string[]];
		// A one-shot -p run cannot answer a permission prompt, so the allowlist is
		// explicit rather than left to --permission-mode auto.
		expect(argv).toContain("--allowedTools");
		expect(argv[argv.indexOf("--allowedTools") + 1]).toBe("Read,Glob");

		child.emit("close", 0);
		await running;
	});

	it("fails loudly when the pinned seat is blocked", async () => {
		resolveManagerAccountPin.mockResolvedValue({
			env: {},
			accountId: 3,
			warning: "over cap",
			blocked: true,
		});
		const events: Array<{ type: string; message?: string }> = [];
		const result = await runAgentOneShot({
			agentId: "claude",
			prompt: "x",
			onEvent: (event) => events.push(event),
			pinInput: {
				managerAccountId: 3,
				getAccountLaunchDir: async () => null,
			},
		});
		expect(result.code).toBe(1);
		expect(spawnMock).not.toHaveBeenCalled();
		expect(events.some((event) => event.type === "error" && event.message === "over cap")).toBe(true);
	});
});
