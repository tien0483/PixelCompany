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

import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import { TerminalSessionManager } from "../../../src/terminal/session-manager";
import type { TerminalSnapshotRecord, TerminalSnapshotStore } from "../../../src/terminal/terminal-snapshot-store";

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

function createSummary(overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "idle",
		agentId: "claude",
		workspacePath: "/tmp/worktree",
		pid: null,
		startedAt: null,
		activeRunMs: 0,
		runningSince: null,
		pausedAt: null,
		pauseReason: null,
		updatedAt: Date.now(),
		lastOutputAt: null,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		...overrides,
	};
}

function createFakeSnapshotStore(
	seed: Record<string, TerminalSnapshotRecord> = {},
): TerminalSnapshotStore & { records: Map<string, TerminalSnapshotRecord> } {
	const records = new Map<string, TerminalSnapshotRecord>(Object.entries(seed));
	return {
		records,
		load: vi.fn(async (taskId: string) => records.get(taskId) ?? null),
		save: vi.fn(async (record: TerminalSnapshotRecord) => {
			records.set(record.taskId, record);
		}),
		delete: vi.fn(async (taskId: string) => {
			records.delete(taskId);
		}),
	};
}

describe("TerminalSessionManager.getRestoreSnapshot", () => {
	beforeEach(() => {
		prepareAgentLaunchMock.mockReset();
		ptySessionSpawnMock.mockReset();
		prepareAgentLaunchMock.mockImplementation(async (input: { args: string[]; binary?: string }) => ({
			binary: input.binary,
			args: [...input.args],
			env: {},
		}));
	});

	it("prefers the live in-RAM mirror over any disk snapshot, reporting stale:false", async () => {
		const spawnedSessions: Array<ReturnType<typeof createMockPtySession>> = [];
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
			const session = createMockPtySession(111, request);
			spawnedSessions.push(session);
			return session;
		});
		const store = createFakeSnapshotStore();
		const manager = new TerminalSessionManager({ snapshotStore: store });

		await manager.startTaskSession({
			taskId: "task-1",
			agentId: "claude",
			binary: "claude",
			args: [],
			cwd: "/tmp/task-1",
			prompt: "Fix the bug",
		});
		spawnedSessions[0]?.triggerData("hello from the live pty\r\n");

		const restored = await manager.getRestoreSnapshot("task-1");

		expect(restored).not.toBeNull();
		expect(restored?.stale).toBe(false);
		expect(restored?.capturedAt).toBeNull();
		expect(restored?.snapshot).toContain("hello from the live pty");
		// The live mirror answers directly; the disk store is never consulted.
		expect(store.load).not.toHaveBeenCalled();
	});

	it("falls back to a memoized disk snapshot with stale:true when there is no live mirror", async () => {
		const record: TerminalSnapshotRecord = {
			version: 1,
			taskId: "task-1",
			capturedAt: 1_700_000_000_000,
			cols: 80,
			rows: 24,
			snapshot: "replayed output from before the restart",
			truncated: false,
		};
		const store = createFakeSnapshotStore({ "task-1": record });
		const manager = new TerminalSessionManager({ snapshotStore: store });
		// hydrateFromRecord mirrors a cold boot: summaries restored, mirrors null.
		manager.hydrateFromRecord({ "task-1": createSummary() });

		const first = await manager.getRestoreSnapshot("task-1");
		expect(first).toEqual({
			snapshot: record.snapshot,
			cols: record.cols,
			rows: record.rows,
			stale: true,
			capturedAt: record.capturedAt,
		});

		const second = await manager.getRestoreSnapshot("task-1");
		expect(second).toEqual(first);
		// Memoized: the store is only ever read from disk once per mirror lifetime.
		expect(store.load).toHaveBeenCalledTimes(1);
	});

	it("returns null when there is neither a live mirror nor a disk snapshot", async () => {
		const store = createFakeSnapshotStore();
		const manager = new TerminalSessionManager({ snapshotStore: store });
		manager.hydrateFromRecord({ "task-1": createSummary() });

		const restored = await manager.getRestoreSnapshot("task-1");

		expect(restored).toBeNull();
		expect(store.load).toHaveBeenCalledTimes(1);
	});

	it("falls back to the disk snapshot when the live mirror was disposed mid-serialize", async () => {
		const record: TerminalSnapshotRecord = {
			version: 1,
			taskId: "task-1",
			capturedAt: 1_700_000_000_000,
			cols: 80,
			rows: 24,
			snapshot: "replayed output from before the restart",
			truncated: false,
		};
		const store = createFakeSnapshotStore({ "task-1": record });
		const manager = new TerminalSessionManager({ snapshotStore: store });
		manager.hydrateFromRecord({ "task-1": createSummary() });
		// A mirror disposed while `getSnapshot` awaited its write queue reports null rather
		// than serializing a dead terminal, so the entry still points at it but it can no
		// longer answer.
		const entries = (manager as unknown as { entries: Map<string, { terminalStateMirror: unknown }> }).entries;
		const entry = entries.get("task-1");
		if (!entry) {
			throw new Error("Expected a hydrated entry.");
		}
		entry.terminalStateMirror = { getSnapshot: vi.fn(async () => null) };

		const restored = await manager.getRestoreSnapshot("task-1");

		expect(restored).toEqual({
			snapshot: record.snapshot,
			cols: record.cols,
			rows: record.rows,
			stale: true,
			capturedAt: record.capturedAt,
		});
	});

	it("returns null when no snapshot store was configured and there is no live mirror", async () => {
		const manager = new TerminalSessionManager();
		manager.hydrateFromRecord({ "task-1": createSummary() });

		const restored = await manager.getRestoreSnapshot("task-1");

		expect(restored).toBeNull();
	});

	it("startTaskSession drops any previously memoized restored snapshot", async () => {
		const record: TerminalSnapshotRecord = {
			version: 1,
			taskId: "task-1",
			capturedAt: 1_700_000_000_000,
			cols: 80,
			rows: 24,
			snapshot: "stale content from a previous run",
			truncated: false,
		};
		const store = createFakeSnapshotStore({ "task-1": record });
		const manager = new TerminalSessionManager({ snapshotStore: store });
		manager.hydrateFromRecord({ "task-1": createSummary() });

		const stale = await manager.getRestoreSnapshot("task-1");
		expect(stale?.stale).toBe(true);
		expect(stale?.snapshot).toBe(record.snapshot);

		const spawnedSessions: Array<ReturnType<typeof createMockPtySession>> = [];
		ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
			const session = createMockPtySession(222, request);
			spawnedSessions.push(session);
			return session;
		});

		await manager.startTaskSession({
			taskId: "task-1",
			agentId: "claude",
			binary: "claude",
			args: [],
			cwd: "/tmp/task-1",
			prompt: "Fix the bug",
			resumeFromPersistence: true,
		});

		// A fresh PTY start must never show stale replayed content from a previous run:
		// the live (now-empty) mirror answers, not the old memoized disk record.
		const afterStart = await manager.getRestoreSnapshot("task-1");
		expect(afterStart?.stale).toBe(false);
		expect(afterStart?.snapshot).not.toContain("stale content from a previous run");
	});
});
