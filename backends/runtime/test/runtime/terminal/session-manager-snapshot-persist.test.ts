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
import {
	MAX_SNAPSHOT_BYTES,
	type TerminalSnapshotRecord,
	type TerminalSnapshotStore,
} from "../../../src/terminal/terminal-snapshot-store";

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

function createFakeSnapshotStore(): TerminalSnapshotStore & { records: Map<string, TerminalSnapshotRecord> } {
	const records = new Map<string, TerminalSnapshotRecord>();
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

async function startSpawnedTask(
	manager: TerminalSessionManager,
	taskId: string,
	overrides: { cols?: number; rows?: number } = {},
): Promise<ReturnType<typeof createMockPtySession>> {
	const spawned: Array<ReturnType<typeof createMockPtySession>> = [];
	ptySessionSpawnMock.mockImplementation((request: MockSpawnRequest) => {
		const session = createMockPtySession(111, request);
		spawned.push(session);
		return session;
	});
	await manager.startTaskSession({
		taskId,
		agentId: "claude",
		binary: "claude",
		args: [],
		cwd: `/tmp/${taskId}`,
		prompt: "Fix the bug",
		cols: overrides.cols,
		rows: overrides.rows,
	});
	const session = spawned[0];
	if (!session) {
		throw new Error("Expected a spawned PTY session.");
	}
	return session;
}

describe("TerminalSessionManager scrollback snapshot persistence", () => {
	beforeEach(() => {
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

	it("debounces the write for a trailing 5s quiet period after PTY output", async () => {
		vi.useFakeTimers();
		const store = createFakeSnapshotStore();
		const manager = new TerminalSessionManager({ snapshotStore: store });
		const session = await startSpawnedTask(manager, "task-1");

		session.triggerData("hello\r\n");

		await vi.advanceTimersByTimeAsync(4_999);
		expect(store.save).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		expect(store.save).toHaveBeenCalledTimes(1);
		expect(store.records.get("task-1")?.snapshot).toContain("hello");
	});

	it("force-writes on a 30s max latency even if output keeps resetting the trailing debounce", async () => {
		vi.useFakeTimers();
		const store = createFakeSnapshotStore();
		const manager = new TerminalSessionManager({ snapshotStore: store });
		const session = await startSpawnedTask(manager, "task-1");

		session.triggerData("chunk-0\r\n");
		// Keep re-triggering output every 4s (under the 5s trailing debounce) so the
		// debounce alone would never fire — the periodic re-arm always outruns it.
		for (let elapsed = 0; elapsed < 28_000; elapsed += 4_000) {
			await vi.advanceTimersByTimeAsync(4_000);
			expect(store.save).not.toHaveBeenCalled();
			session.triggerData("chunk\r\n");
		}
		// The max-latency timer was armed once, at t=0, and is not reset by later output —
		// it must still fire at the 30s mark regardless of the continuous chatter above.
		await vi.advanceTimersByTimeAsync(2_000);
		expect(store.save).toHaveBeenCalledTimes(1);
	});

	it("retries serialization at 500 scrollback lines when the 2000-line window is over MAX_SNAPSHOT_BYTES", async () => {
		const store = createFakeSnapshotStore();
		const manager = new TerminalSessionManager({ snapshotStore: store });
		// Wide terminal so long lines never wrap into extra rows, keeping "lines written"
		// and "rows in the scrollback buffer" 1:1 for predictable byte-size math.
		const session = await startSpawnedTask(manager, "task-1", { cols: 5000, rows: 10 });

		// ~600 bytes/line: 2000 lines (~1.2MB) is comfortably over the 512,000-byte cap,
		// but 500 lines (~300,000 bytes) is comfortably under it, so the first retry
		// should succeed without needing the empty/truncated fallback.
		const line = `${"x".repeat(600)}\r\n`;
		session.triggerData(line.repeat(2_500));

		const stopPromise = manager.stopTaskSession("task-1");
		session.triggerExit(0);
		await stopPromise;

		const saved = store.records.get("task-1");
		expect(saved).toBeDefined();
		expect(saved?.truncated).toBe(false);
		expect(saved?.snapshot.length).toBeGreaterThan(0);
		expect(Buffer.byteLength(saved?.snapshot ?? "", "utf8")).toBeLessThanOrEqual(MAX_SNAPSHOT_BYTES);
	});

	it("persists an empty truncated marker when even the 500-line retry is over MAX_SNAPSHOT_BYTES", async () => {
		const store = createFakeSnapshotStore();
		const manager = new TerminalSessionManager({ snapshotStore: store });
		const session = await startSpawnedTask(manager, "task-1", { cols: 5000, rows: 10 });

		// ~1200 bytes/line: even 500 lines (~600,000 bytes) is over the 512,000-byte cap,
		// so the caller must give up and persist the empty/truncated marker rather than
		// relying solely on the store's own hard-cap backstop.
		const line = `${"x".repeat(1_200)}\r\n`;
		session.triggerData(line.repeat(2_500));

		const stopPromise = manager.stopTaskSession("task-1");
		session.triggerExit(0);
		await stopPromise;

		const saved = store.records.get("task-1");
		expect(saved).toEqual(
			expect.objectContaining({
				taskId: "task-1",
				snapshot: "",
				truncated: true,
			}),
		);
	});

	it("writes a final snapshot when the process exits on its own (not via stopTaskSession)", async () => {
		const store = createFakeSnapshotStore();
		const manager = new TerminalSessionManager({ snapshotStore: store });
		const session = await startSpawnedTask(manager, "task-1");

		session.triggerData("last words before crashing\r\n");
		session.triggerExit(1);

		await vi.waitFor(() => {
			expect(store.save).toHaveBeenCalled();
		});
		expect(store.records.get("task-1")?.snapshot).toContain("last words before crashing");
	});

	it("is a no-op when no snapshot store is configured", async () => {
		vi.useFakeTimers();
		const manager = new TerminalSessionManager();
		const session = await startSpawnedTask(manager, "task-1");

		session.triggerData("hello\r\n");
		await vi.advanceTimersByTimeAsync(30_000);

		// No store means nothing to assert on directly; the important thing is that
		// scheduling/persisting never throws and the manager keeps working normally.
		expect(manager.getSummary("task-1")?.state).toBe("running");
	});
});
