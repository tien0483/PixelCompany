import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ptyMocks = vi.hoisted(() => ({
	spawn: vi.fn(),
}));

vi.mock("node-pty", () => ({
	spawn: ptyMocks.spawn,
}));

import { TerminalSessionManager } from "../../../src/terminal/session-manager";

const originalAnthropicBaseUrl = process.env.ANTHROPIC_BASE_URL;
const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;

function createMockPtyProcess() {
	return {
		pid: 4242,
		onData: vi.fn(),
		onExit: vi.fn(),
		kill: vi.fn(),
		write: vi.fn(),
		resize: vi.fn(),
		pause: vi.fn(),
		resume: vi.fn(),
	};
}

describe("TerminalSessionManager env isolation", () => {
	beforeEach(() => {
		ptyMocks.spawn.mockReset();
		ptyMocks.spawn.mockReturnValue(createMockPtyProcess());
	});

	afterEach(() => {
		if (originalAnthropicBaseUrl === undefined) {
			delete process.env.ANTHROPIC_BASE_URL;
		} else {
			process.env.ANTHROPIC_BASE_URL = originalAnthropicBaseUrl;
		}
		if (originalAnthropicApiKey === undefined) {
			delete process.env.ANTHROPIC_API_KEY;
		} else {
			process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey;
		}
	});

	it("never leaks an activate-stack.sh-inherited ANTHROPIC_BASE_URL/API_KEY into a spawned task's env", async () => {
		// Simulates a Kanban runtime launched from a shell that sourced activate-stack.sh:
		// the runtime's own process.env carries the switchboard URL and sandbox dummy key.
		process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:8000";
		process.env.ANTHROPIC_API_KEY = "sk-dummy-key-for-sandbox";

		const manager = new TerminalSessionManager();
		await manager.startShellSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			binary: "/usr/bin/env",
			args: [],
		});

		expect(ptyMocks.spawn).toHaveBeenCalledTimes(1);
		const [, , spawnOptions] = ptyMocks.spawn.mock.calls[0] as [string, string[], { env?: Record<string, unknown> }];
		expect(spawnOptions.env?.ANTHROPIC_BASE_URL).toBeUndefined();
		expect(spawnOptions.env?.ANTHROPIC_API_KEY).toBeUndefined();
	});
});
