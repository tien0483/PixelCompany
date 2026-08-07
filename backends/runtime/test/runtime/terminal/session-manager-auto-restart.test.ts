import { beforeEach, describe, expect, it, vi } from "vitest";

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

function createMockPtySession(pid: number, request: MockSpawnRequest) {
	return {
		pid,
		write: vi.fn(),
		resize: vi.fn(),
		pause: vi.fn(),
		resume: vi.fn(),
		stop: vi.fn(),
		wasInterrupted: vi.fn(() => false),
		triggerData: (chunk: string | Buffer) => {
			request.onData?.(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8"));
		},
		triggerExit: (exitCode: number | null) => {
			request.onExit?.({ exitCode });
		},
	};
}

describe("TerminalSessionManager auto-restart", () => {
	beforeEach(() => {
		prepareAgentLaunchMock.mockReset();
		ptySessionSpawnMock.mockReset();
		prepareAgentLaunchMock.mockImplementation(async (input: { args: string[]; binary?: string }) => ({
			binary: input.binary,
			args: [...input.args],
			env: {},
		}));
	});

	it("restarts an attached agent session after it exits", async () => {
		const spawnedSessions: Array<ReturnType<typeof createMockPtySession>> = [];
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
			const session = createMockPtySession(spawnedSessions.length === 0 ? 111 : 222, request);
			spawnedSessions.push(session);
			return session;
		});

		const manager = new TerminalSessionManager();
		manager.attach("task-1", {
			onState: vi.fn(),
			onOutput: vi.fn(),
			onExit: vi.fn(),
		});

		await manager.startTaskSession({
			taskId: "task-1",
			agentId: "codex",
			binary: "codex",
			args: [],
			cwd: "/tmp/task-1",
			prompt: "Fix the bug",
		});

		expect(ptySessionSpawnMock).toHaveBeenCalledTimes(1);
		spawnedSessions[0]?.triggerExit(130);

		await vi.waitFor(() => {
			expect(ptySessionSpawnMock).toHaveBeenCalledTimes(2);
		});
		expect(manager.getSummary("task-1")?.state).toBe("running");
		expect(manager.getSummary("task-1")?.pid).toBe(222);
	});

	it("does not restart an attached agent session after an explicit stop", async () => {
		const spawnedSessions: Array<ReturnType<typeof createMockPtySession>> = [];
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
			const session = createMockPtySession(111, request);
			spawnedSessions.push(session);
			return session;
		});

		const manager = new TerminalSessionManager();
		manager.attach("task-1", {
			onState: vi.fn(),
			onOutput: vi.fn(),
			onExit: vi.fn(),
		});

		await manager.startTaskSession({
			taskId: "task-1",
			agentId: "codex",
			binary: "codex",
			args: [],
			cwd: "/tmp/task-1",
			prompt: "Fix the bug",
		});

		const stopPromise = manager.stopTaskSession("task-1");
		spawnedSessions[0]?.triggerExit(0);
		await stopPromise;

		expect(ptySessionSpawnMock).toHaveBeenCalledTimes(1);
		expect(manager.getSummary("task-1")?.state).toBe("awaiting_review");
		expect(manager.getSummary("task-1")?.pid).toBeNull();
	});

	it("stopTaskSession waits for the real process exit before resolving, so a following startTaskSession is not swallowed by the still-active guard", async () => {
		const spawnedSessions: Array<ReturnType<typeof createMockPtySession>> = [];
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
			const session = createMockPtySession(spawnedSessions.length === 0 ? 111 : 222, request);
			spawnedSessions.push(session);
			return session;
		});

		const manager = new TerminalSessionManager();
		manager.attach("task-1", {
			onState: vi.fn(),
			onOutput: vi.fn(),
			onExit: vi.fn(),
		});

		await manager.startTaskSession({
			taskId: "task-1",
			agentId: "claude",
			binary: "claude",
			args: [],
			cwd: "/tmp/task-1",
			prompt: "Fix the bug",
			env: { MOCK_ACCOUNT: "account-a" },
		});

		// Simulate the 401 flow: the auth failure keeps the PTY "active" in awaiting_review.
		spawnedSessions[0]?.triggerData("Unauthorized: please re-authenticate with Anthropic.\n");
		expect(manager.getSummary("task-1")?.state).toBe("awaiting_review");

		let stopResolved = false;
		const stopPromise = manager.stopTaskSession("task-1").then(() => {
			stopResolved = true;
		});

		// The kill signal was sent, but the mock PTY has not reported exit yet -
		// stopTaskSession must not resolve until it does.
		await Promise.resolve();
		await Promise.resolve();
		expect(stopResolved).toBe(false);

		spawnedSessions[0]?.triggerExit(1);
		await stopPromise;
		expect(stopResolved).toBe(true);

		// Restarting with a different account's env after stopTaskSession has resolved
		// must actually spawn a new process, not be swallowed by the "still active" guard.
		await manager.startTaskSession({
			taskId: "task-1",
			agentId: "claude",
			binary: "claude",
			args: [],
			cwd: "/tmp/task-1",
			prompt: "Fix the bug",
			resumeFromPersistence: true,
			env: { MOCK_ACCOUNT: "account-b" },
		});

		expect(ptySessionSpawnMock).toHaveBeenCalledTimes(2);
		expect(ptySessionSpawnMock.mock.calls[1]?.[0]).toMatchObject({
			env: expect.objectContaining({ MOCK_ACCOUNT: "account-b" }),
		});
		expect(manager.getSummary("task-1")?.pid).toBe(222);
	});

	it("does not restart Cursor sessions that exit after an invalid API key", async () => {
		const spawnedSessions: Array<ReturnType<typeof createMockPtySession>> = [];
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
			const session = createMockPtySession(111, request);
			spawnedSessions.push(session);
			return session;
		});

		const manager = new TerminalSessionManager();
		manager.attach("task-cursor", {
			onState: vi.fn(),
			onOutput: vi.fn(),
			onExit: vi.fn(),
		});

		await manager.startTaskSession({
			taskId: "task-cursor",
			agentId: "cursor",
			binary: "agent",
			args: [],
			cwd: "/tmp/task-cursor",
			prompt: "Fix the bug",
		});

		spawnedSessions[0]?.triggerData(
			"Error: The provided API key is invalid.\nAPI key was loaded from the CURSOR_API_KEY environment variable.\n",
		);
		expect(manager.getSummary("task-cursor")?.state).toBe("awaiting_review");
		expect(manager.getSummary("task-cursor")?.warningMessage).toMatch(/Cursor authentication failed/i);

		spawnedSessions[0]?.triggerExit(1);
		await Promise.resolve();
		await Promise.resolve();

		expect(ptySessionSpawnMock).toHaveBeenCalledTimes(1);
		expect(manager.getSummary("task-cursor")?.state).toBe("awaiting_review");
		expect(manager.getSummary("task-cursor")?.reviewReason).toBe("error");
		expect(manager.getSummary("task-cursor")?.warningMessage).toMatch(/Cursor authentication failed/i);
	});

	it("moves Claude /login prompts to review and does not restart on exit", async () => {
		const spawnedSessions: Array<ReturnType<typeof createMockPtySession>> = [];
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
			const session = createMockPtySession(111, request);
			spawnedSessions.push(session);
			return session;
		});

		const manager = new TerminalSessionManager();
		manager.attach("task-claude", {
			onState: vi.fn(),
			onOutput: vi.fn(),
			onExit: vi.fn(),
		});

		await manager.startTaskSession({
			taskId: "task-claude",
			agentId: "claude",
			binary: "claude",
			args: [],
			cwd: "/tmp/task-claude",
			prompt: "Fix the bug",
		});

		spawnedSessions[0]?.triggerData("Not logged in. Please run /login to continue.\n");
		expect(manager.getSummary("task-claude")?.state).toBe("awaiting_review");
		expect(manager.getSummary("task-claude")?.pid).toBe(111);
		expect(manager.getSummary("task-claude")?.warningMessage).toMatch(/Claude Code needs login/i);

		spawnedSessions[0]?.triggerExit(1);
		await Promise.resolve();
		await Promise.resolve();

		expect(ptySessionSpawnMock).toHaveBeenCalledTimes(1);
		expect(manager.getSummary("task-claude")?.warningMessage).toMatch(/Claude Code needs login/i);
	});

	it("sends deferred Codex startup input when the prompt marker appears", async () => {
		const deferredStartupInput = "\u001b[200~/plan Validate rollout\u001b[201~\r";
		prepareAgentLaunchMock.mockResolvedValue({
			binary: "codex",
			args: [],
			env: {},
			deferredStartupInput,
		});

		const spawnedSessions: Array<ReturnType<typeof createMockPtySession>> = [];
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
			const session = createMockPtySession(111, request);
			spawnedSessions.push(session);
			return session;
		});

		const manager = new TerminalSessionManager();
		await manager.startTaskSession({
			taskId: "task-1",
			agentId: "codex",
			binary: "codex",
			args: [],
			cwd: "/tmp/task-1",
			prompt: "Fix the bug",
			startInPlanMode: true,
		});

		const session = spawnedSessions[0];
		expect(session).toBeDefined();
		if (!session) {
			return;
		}

		session.triggerData("Booting Codex\n");
		expect(session.write).not.toHaveBeenCalledWith(deferredStartupInput);

		session.triggerData("› ");
		expect(session.write).toHaveBeenCalledWith(deferredStartupInput);
		expect(session.write).toHaveBeenCalledTimes(1);
	});

	it("reports an agent auth failure once when detected mid-stream, and not again on exit", async () => {
		const spawnedSessions: Array<ReturnType<typeof createMockPtySession>> = [];
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
			const session = createMockPtySession(111, request);
			spawnedSessions.push(session);
			return session;
		});

		const manager = new TerminalSessionManager();
		const reporter = vi.fn();
		manager.setAgentAuthFailureReporter(reporter);

		await manager.startTaskSession({
			taskId: "task-claude",
			agentId: "claude",
			binary: "claude",
			args: [],
			cwd: "/tmp/task-claude",
			prompt: "Fix the bug",
			managerAccountId: 7,
		});

		spawnedSessions[0]?.triggerData("Not logged in. Please run /login to continue.\n");
		spawnedSessions[0]?.triggerData("Not logged in. Please run /login to continue.\n");
		spawnedSessions[0]?.triggerExit(1);
		await Promise.resolve();
		await Promise.resolve();

		expect(reporter).toHaveBeenCalledTimes(1);
		expect(reporter).toHaveBeenCalledWith({
			taskId: "task-claude",
			agentId: "claude",
			managerAccountId: 7,
			message: expect.stringMatching(/Claude Code needs login/i),
		});
	});

	it("reports an agent auth failure detected only at process exit", async () => {
		const spawnedSessions: Array<ReturnType<typeof createMockPtySession>> = [];
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
			const session = createMockPtySession(111, request);
			spawnedSessions.push(session);
			return session;
		});

		const manager = new TerminalSessionManager();
		const reporter = vi.fn();
		manager.setAgentAuthFailureReporter(reporter);

		await manager.startTaskSession({
			taskId: "task-cursor",
			agentId: "cursor",
			binary: "agent",
			args: [],
			cwd: "/tmp/task-cursor",
			prompt: "Fix the bug",
			managerAccountId: 9,
		});

		// Auth text arrives in the same chunk the process exits with — the mock
		// fires onExit without a prior onData call, so detection only happens
		// via the onExit fallback's own recentOutputText read.
		const active = (
			manager as unknown as {
				entries: Map<string, { active: { recentOutputText: string } | null }>;
			}
		).entries.get("task-cursor")?.active;
		if (active) {
			active.recentOutputText = "Error: The provided API key is invalid.\n";
		}
		spawnedSessions[0]?.triggerExit(1);
		await Promise.resolve();
		await Promise.resolve();

		expect(reporter).toHaveBeenCalledTimes(1);
		expect(reporter).toHaveBeenCalledWith({
			taskId: "task-cursor",
			agentId: "cursor",
			managerAccountId: 9,
			message: expect.stringMatching(/Cursor authentication failed/i),
		});
	});

	it("never throws when the reporter itself rejects", async () => {
		const spawnedSessions: Array<ReturnType<typeof createMockPtySession>> = [];
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
			const session = createMockPtySession(111, request);
			spawnedSessions.push(session);
			return session;
		});

		const manager = new TerminalSessionManager();
		manager.setAgentAuthFailureReporter(() => {
			throw new Error("network down");
		});

		await manager.startTaskSession({
			taskId: "task-claude-2",
			agentId: "claude",
			binary: "claude",
			args: [],
			cwd: "/tmp/task-claude-2",
			prompt: "Fix the bug",
		});

		expect(() => {
			spawnedSessions[0]?.triggerData("Not logged in. Please run /login to continue.\n");
		}).not.toThrow();
	});

	it("sends deferred Codex startup input when the startup UI header appears", async () => {
		const deferredStartupInput = "\u001b[200~/plan Validate startup UI detect\u001b[201~\r";
		prepareAgentLaunchMock.mockResolvedValue({
			binary: "codex",
			args: [],
			env: {},
			deferredStartupInput,
		});

		const spawnedSessions: Array<ReturnType<typeof createMockPtySession>> = [];
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
			const session = createMockPtySession(111, request);
			spawnedSessions.push(session);
			return session;
		});

		const manager = new TerminalSessionManager();
		await manager.startTaskSession({
			taskId: "task-1",
			agentId: "codex",
			binary: "codex",
			args: [],
			cwd: "/tmp/task-1",
			prompt: "Fix the bug",
			startInPlanMode: true,
		});

		const session = spawnedSessions[0];
		expect(session).toBeDefined();
		if (!session) {
			return;
		}

		session.triggerData(">_ OpenAI Codex (v0.117.0)\n");
		expect(session.write).toHaveBeenCalledWith(deferredStartupInput);
		expect(session.write).toHaveBeenCalledTimes(1);
	});
});
