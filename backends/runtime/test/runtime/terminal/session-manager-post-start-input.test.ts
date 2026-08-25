import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prepareAgentLaunchMock = vi.hoisted(() => vi.fn());
const ptySessionSpawnMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/terminal/agent-session-adapters.js", () => ({
	prepareAgentLaunch: prepareAgentLaunchMock,
}));

vi.mock("../../../src/terminal/pty-session.js", () => ({
	PtySession: {
		spawn: ptySessionSpawnMock,
	},
}));

import { TerminalSessionManager } from "../../../src/terminal/session-manager";

interface MockSpawnRequest {
	onData?: (chunk: Buffer) => void;
	onExit?: (event: { exitCode: number | null; signal?: number }) => void;
}

function createMockPtySession(request: MockSpawnRequest) {
	return {
		pid: 4242,
		write: vi.fn(),
		resize: vi.fn(),
		pause: vi.fn(),
		resume: vi.fn(),
		stop: vi.fn(),
		wasInterrupted: vi.fn(() => false),
		triggerData: (chunk: string) => {
			request.onData?.(Buffer.from(chunk, "utf8"));
		},
		triggerExit: (exitCode: number | null) => {
			request.onExit?.({ exitCode });
		},
	};
}

/** Writes that are the queued post-start input, ignoring OSC replies and trust confirms. */
function postStartWrites(session: { write: ReturnType<typeof vi.fn> }): string[] {
	return session.write.mock.calls.map((call) => String(call[0])).filter((data) => data.includes("continue"));
}

async function startRecoveredSession(postStartInput = "continue\r") {
	const session = (() => {
		let created: ReturnType<typeof createMockPtySession> | null = null;
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
			created = createMockPtySession(request);
			return created;
		});
		return () => created;
	})();

	const manager = new TerminalSessionManager();
	await manager.startTaskSession({
		taskId: "task-1",
		agentId: "claude",
		binary: "claude",
		args: [],
		cwd: "/tmp/task-1",
		prompt: "",
		resumeFromPersistence: true,
		postStartInput,
	});
	const pty = session();
	if (!pty) {
		throw new Error("PTY was not spawned");
	}
	return { manager, pty };
}

describe("TerminalSessionManager post-start input", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		prepareAgentLaunchMock.mockReset();
		ptySessionSpawnMock.mockReset();
		prepareAgentLaunchMock.mockImplementation(async (input: { args: string[]; binary?: string }) => ({
			binary: input.binary,
			args: [...input.args],
			env: {},
		}));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("types the queued input once the PTY goes quiet", async () => {
		const { pty } = await startRecoveredSession();

		pty.triggerData("Claude Code v2.1.231\n");
		await vi.advanceTimersByTimeAsync(1_000);
		expect(postStartWrites(pty)).toEqual([]);

		await vi.advanceTimersByTimeAsync(600);
		expect(postStartWrites(pty)).toEqual(["continue\r"]);
	});

	it("re-arms on every chunk so it never types into a still-drawing TUI", async () => {
		const { pty } = await startRecoveredSession();

		for (let index = 0; index < 5; index += 1) {
			pty.triggerData(`rendering ${String(index)}\n`);
			await vi.advanceTimersByTimeAsync(1_000);
			expect(postStartWrites(pty)).toEqual([]);
		}

		await vi.advanceTimersByTimeAsync(1_500);
		expect(postStartWrites(pty)).toEqual(["continue\r"]);
	});

	it("types it exactly once", async () => {
		const { pty } = await startRecoveredSession();

		pty.triggerData("ready\n");
		await vi.advanceTimersByTimeAsync(2_000);
		pty.triggerData("more output\n");
		await vi.advanceTimersByTimeAsync(5_000);

		expect(postStartWrites(pty)).toEqual(["continue\r"]);
	});

	it("still types it when the session renders nothing at all", async () => {
		const { pty } = await startRecoveredSession();

		// No output ever arrives, so only the max-wait timer can release the input.
		await vi.advanceTimersByTimeAsync(14_000);
		expect(postStartWrites(pty)).toEqual([]);

		await vi.advanceTimersByTimeAsync(2_000);
		expect(postStartWrites(pty)).toEqual(["continue\r"]);
	});

	it("lets the trust auto-confirm answer the prompt first", async () => {
		const { pty } = await startRecoveredSession();

		pty.triggerData("Do you trust the files in this folder?\n");
		// Auto-confirm replies with a bare Enter ~100ms in and clears the trust buffer, so the
		// settle window is free by the time it elapses.
		await vi.advanceTimersByTimeAsync(200);
		expect(pty.write.mock.calls.map((call) => String(call[0]))).toContain("\r");
		expect(postStartWrites(pty)).toEqual([]);

		await vi.advanceTimersByTimeAsync(1_500);
		expect(postStartWrites(pty)).toEqual(["continue\r"]);
	});

	it("holds the input back while an unanswered trust prompt is on screen, then gives up", async () => {
		const { pty } = await startRecoveredSession();

		// First prompt is auto-confirmed; a redraw afterwards is not, since auto-confirm only
		// ever fires once per session.
		pty.triggerData("Do you trust the files in this folder?\n");
		await vi.advanceTimersByTimeAsync(200);
		pty.triggerData("Do you trust the files in this folder?\n");

		await vi.advanceTimersByTimeAsync(5_000);
		expect(postStartWrites(pty)).toEqual([]);

		// Past the max-wait deadline the input is sent anyway rather than withheld forever.
		await vi.advanceTimersByTimeAsync(12_000);
		expect(postStartWrites(pty)).toEqual(["continue\r"]);
	});

	it("never types into a session that already exited", async () => {
		const { pty } = await startRecoveredSession();

		pty.triggerData("starting\n");
		pty.triggerExit(1);
		await vi.advanceTimersByTimeAsync(30_000);

		expect(postStartWrites(pty)).toEqual([]);
	});

	it("leaves ordinary starts alone", async () => {
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => createMockPtySession(request));
		const manager = new TerminalSessionManager();
		await manager.startTaskSession({
			taskId: "task-2",
			agentId: "claude",
			binary: "claude",
			args: [],
			cwd: "/tmp/task-2",
			prompt: "Fix the bug",
		});

		const spawned = ptySessionSpawnMock.mock.results[0]?.value as { write: ReturnType<typeof vi.fn> };
		await vi.advanceTimersByTimeAsync(30_000);
		expect(postStartWrites(spawned)).toEqual([]);
	});
});
