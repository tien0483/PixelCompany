import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();
const isBinaryAvailableOnPath = vi.fn((_binary: string) => true);
const resolveManagerAccountPin = vi.fn();

vi.mock("node:child_process", () => ({
	spawn: (...args: unknown[]) => spawnMock(...args),
}));

vi.mock("../../../src/terminal/command-discovery.js", () => ({
	isBinaryAvailableOnPath: (...args: [string]) => isBinaryAvailableOnPath(...args),
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

	it("emits an error before done when the child exits non-zero", async () => {
		const child = createFakeChild();
		spawnMock.mockReturnValue(child);
		resolveManagerAccountPin.mockResolvedValue({ env: {}, accountId: null, warning: null });

		const events: Array<{ type: string; message?: string }> = [];
		const running = runAgentOneShot({
			agentId: "claude",
			prompt: "make html",
			onEvent: (event) => events.push(event),
			pinInput: { getAccountLaunchDir: async () => null },
		});

		await vi.waitFor(() => {
			expect(spawnMock).toHaveBeenCalled();
		});

		child.emit("close", 7);
		const result = await running;

		expect(result.code).toBe(7);
		const errorIndex = events.findIndex((event) => event.type === "error");
		const doneIndex = events.findIndex((event) => event.type === "done");
		expect(errorIndex).toBeGreaterThanOrEqual(0);
		expect(doneIndex).toBeGreaterThan(errorIndex);
		expect(events[errorIndex]?.message).toBe("Claude exited with code 7");
	});

	it("does not emit a second error for the exit code once the watchdog already emitted one", async () => {
		vi.useFakeTimers();
		try {
			const child = createFakeChild();
			spawnMock.mockReturnValue(child);
			resolveManagerAccountPin.mockResolvedValue({ env: {}, accountId: null, warning: null });

			const events: Array<{ type: string; message?: string }> = [];
			const running = runAgentOneShot({
				agentId: "claude",
				prompt: "make html",
				idleTimeoutMs: 5000,
				onEvent: (event) => events.push(event),
				pinInput: { getAccountLaunchDir: async () => null },
			});

			await vi.waitFor(() => {
				expect(spawnMock).toHaveBeenCalled();
			});

			await vi.advanceTimersByTimeAsync(5000);

			expect(child.kill).toHaveBeenCalled();
			expect(events.some((event) => event.type === "error")).toBe(true);

			child.emit("close", 1);
			const result = await running;

			expect(result.code).toBe(1);
			const errorEvents = events.filter((event) => event.type === "error");
			expect(errorEvents).toHaveLength(1);
			expect(errorEvents[0]?.message).toBe("Agent produced no output for 5s — cancelled.");
		} finally {
			vi.useRealTimers();
		}
	});

	it("cancels and kills the child when no output arrives before the idle timeout", async () => {
		vi.useFakeTimers();
		try {
			const child = createFakeChild();
			spawnMock.mockReturnValue(child);
			resolveManagerAccountPin.mockResolvedValue({ env: {}, accountId: null, warning: null });

			const events: Array<{ type: string; message?: string }> = [];
			const running = runAgentOneShot({
				agentId: "claude",
				prompt: "make html",
				idleTimeoutMs: 120_000,
				onEvent: (event) => events.push(event),
				pinInput: { getAccountLaunchDir: async () => null },
			});

			await vi.waitFor(() => {
				expect(spawnMock).toHaveBeenCalled();
			});

			await vi.advanceTimersByTimeAsync(120_000);

			expect(child.kill).toHaveBeenCalledTimes(1);
			expect(
				events.some(
					(event) =>
						event.type === "error" && event.message === "Agent produced no output for 120s — cancelled.",
				),
			).toBe(true);

			child.emit("close", null);
			const result = await running;
			expect(result.code).toBeNull();
			expect(events.at(-1)).toEqual({ type: "done", code: null });
		} finally {
			vi.useRealTimers();
		}
	});

	it("resets the idle timer on output, surviving the original deadline, then cancels once truly idle", async () => {
		vi.useFakeTimers();
		try {
			const child = createFakeChild();
			const stdout = new PassThrough();
			child.stdout = stdout as unknown as Readable;
			spawnMock.mockReturnValue(child);
			resolveManagerAccountPin.mockResolvedValue({ env: {}, accountId: null, warning: null });

			const events: Array<{ type: string; message?: string }> = [];
			const running = runAgentOneShot({
				agentId: "claude",
				prompt: "make html",
				idleTimeoutMs: 5000,
				onEvent: (event) => events.push(event),
				pinInput: { getAccountLaunchDir: async () => null },
			});

			await vi.waitFor(() => {
				expect(spawnMock).toHaveBeenCalled();
			});

			// A line arrives just before the original 5s deadline would fire.
			await vi.advanceTimersByTimeAsync(4000);
			stdout.write("still working\n");
			await vi.waitFor(() => {
				expect(events.some((event) => event.type === "raw")).toBe(true);
			});

			// Push past what would have been the original deadline (4000 + 1200 = 5200ms
			// elapsed) — the run must survive, since the line above reset the timer.
			await vi.advanceTimersByTimeAsync(1200);
			expect(child.kill).not.toHaveBeenCalled();
			expect(events.some((event) => event.type === "error")).toBe(false);

			// Now go quiet for a full idle window measured from the last line (reached at
			// 4000 + 5000 = 9000ms elapsed; we're already at 5200ms, so 3800ms more).
			await vi.advanceTimersByTimeAsync(3800);
			expect(child.kill).toHaveBeenCalledTimes(1);
			expect(
				events.some(
					(event) =>
						event.type === "error" && event.message === "Agent produced no output for 5s — cancelled.",
				),
			).toBe(true);

			stdout.end();
			child.emit("close", null);
			await running;
		} finally {
			vi.useRealTimers();
		}
	});

	it("cancels via the hard timeout even while output keeps arriving (idle timer never fires)", async () => {
		vi.useFakeTimers();
		try {
			const child = createFakeChild();
			const stdout = new PassThrough();
			child.stdout = stdout as unknown as Readable;
			spawnMock.mockReturnValue(child);
			resolveManagerAccountPin.mockResolvedValue({ env: {}, accountId: null, warning: null });

			const events: Array<{ type: string; message?: string }> = [];
			const running = runAgentOneShot({
				agentId: "claude",
				prompt: "make html",
				idleTimeoutMs: 100_000,
				timeoutMs: 10_000,
				onEvent: (event) => events.push(event),
				pinInput: { getAccountLaunchDir: async () => null },
			});

			await vi.waitFor(() => {
				expect(spawnMock).toHaveBeenCalled();
			});

			// Output arrives well within the (generous) idle window, proving the idle
			// timer is not what eventually cancels this run.
			await vi.advanceTimersByTimeAsync(5000);
			stdout.write("still working\n");
			await vi.waitFor(() => {
				expect(events.some((event) => event.type === "raw")).toBe(true);
			});
			expect(child.kill).not.toHaveBeenCalled();

			// The hard ceiling elapses regardless of the recent output.
			await vi.advanceTimersByTimeAsync(5000);
			expect(child.kill).toHaveBeenCalledTimes(1);
			expect(
				events.some(
					(event) =>
						event.type === "error" &&
						event.message === "Agent ran for 10s without finishing — cancelled.",
				),
			).toBe(true);

			stdout.end();
			child.emit("close", null);
			await running;
		} finally {
			vi.useRealTimers();
		}
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
		// The SSE consumer only learns a run is over from `done`. Without one, a refused
		// pin reaches the browser as a stream that simply stops — which is why this
		// failure used to render as an empty answer area rather than the reason above.
		expect(events.filter((event) => event.type === "error")).toHaveLength(1);
		expect(events.filter((event) => event.type === "done")).toHaveLength(1);
		expect(events.findIndex((event) => event.type === "done")).toBeGreaterThan(
			events.findIndex((event) => event.type === "error"),
		);
	});

	it("emits an error and a done when the claude binary is missing", async () => {
		isBinaryAvailableOnPath.mockReturnValueOnce(false);
		const events: Array<{ type: string; message?: string }> = [];
		const result = await runAgentOneShot({
			agentId: "claude",
			prompt: "x",
			onEvent: (event) => events.push(event),
		});
		expect(result.code).toBe(1);
		expect(spawnMock).not.toHaveBeenCalled();
		expect(events.filter((event) => event.type === "error")).toHaveLength(1);
		expect(events.filter((event) => event.type === "done")).toHaveLength(1);
		expect(events.findIndex((event) => event.type === "done")).toBeGreaterThan(
			events.findIndex((event) => event.type === "error"),
		);
	});
});
