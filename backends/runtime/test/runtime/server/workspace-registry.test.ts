import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeConfigState } from "../../../src/config/runtime-config";
import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";

const persisterMocks = vi.hoisted(() => ({
	createSessionSummaryPersister: vi.fn(),
}));

const terminalMocks = vi.hoisted(() => ({
	createTerminalSnapshotStore: vi.fn(),
}));

const workspaceStateMocks = vi.hoisted(() => ({
	listWorkspaceIndexEntries: vi.fn(),
	loadWorkspaceBoardById: vi.fn(),
	loadWorkspaceContext: vi.fn(),
	loadWorkspaceState: vi.fn(),
	removeWorkspaceIndexEntry: vi.fn(),
	removeWorkspaceStateFiles: vi.fn(),
	saveWorkspaceSessionSummaries: vi.fn(),
}));

vi.mock("../../../src/state/session-summary-persister.js", () => ({
	createSessionSummaryPersister: persisterMocks.createSessionSummaryPersister,
}));

vi.mock("../../../src/state/workspace-state.js", () => ({
	listWorkspaceIndexEntries: workspaceStateMocks.listWorkspaceIndexEntries,
	loadWorkspaceBoardById: workspaceStateMocks.loadWorkspaceBoardById,
	loadWorkspaceContext: workspaceStateMocks.loadWorkspaceContext,
	loadWorkspaceState: workspaceStateMocks.loadWorkspaceState,
	removeWorkspaceIndexEntry: workspaceStateMocks.removeWorkspaceIndexEntry,
	removeWorkspaceStateFiles: workspaceStateMocks.removeWorkspaceStateFiles,
	saveWorkspaceSessionSummaries: workspaceStateMocks.saveWorkspaceSessionSummaries,
}));

vi.mock("../../../src/terminal/terminal-snapshot-store.js", () => ({
	createTerminalSnapshotStore: terminalMocks.createTerminalSnapshotStore,
}));

import { createWorkspaceRegistry } from "../../../src/server/workspace-registry";

function createSummary(overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "idle",
		agentId: null,
		workspacePath: null,
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

interface FakePersister {
	handleSummary: ReturnType<typeof vi.fn>;
	flush: ReturnType<typeof vi.fn>;
	dispose: ReturnType<typeof vi.fn>;
}

function createFakePersister(): FakePersister {
	return {
		handleSummary: vi.fn(),
		flush: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn(),
	};
}

function createDeps() {
	return {
		cwd: "/tmp/does-not-matter",
		loadGlobalRuntimeConfig: vi.fn(async () => ({}) as RuntimeConfigState),
		loadRuntimeConfig: vi.fn(async () => ({}) as RuntimeConfigState),
		hasGitRepository: vi.fn(() => false),
		pathIsDirectory: vi.fn(async () => true),
	};
}

describe("createWorkspaceRegistry session persistence wiring", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		workspaceStateMocks.listWorkspaceIndexEntries.mockResolvedValue([]);
		workspaceStateMocks.loadWorkspaceState.mockResolvedValue({
			repoPath: "/tmp/ws",
			statePath: "/tmp/ws/state",
			git: { isGitRepository: true },
			board: { columns: [] },
			sessions: {},
			revision: 0,
		});
		workspaceStateMocks.saveWorkspaceSessionSummaries.mockResolvedValue(undefined);
		persisterMocks.createSessionSummaryPersister.mockImplementation(() => createFakePersister());
		terminalMocks.createTerminalSnapshotStore.mockImplementation(() => ({}));
	});

	it("creates and subscribes a persister when the terminal manager is hydrated", async () => {
		const registry = await createWorkspaceRegistry(createDeps());

		const manager = await registry.ensureTerminalManagerForWorkspace("ws-1", "/tmp/ws");

		expect(persisterMocks.createSessionSummaryPersister).toHaveBeenCalledWith({ workspaceId: "ws-1" });
		const fakePersister = persisterMocks.createSessionSummaryPersister.mock.results[0]?.value as FakePersister;

		// A summary change on the manager should reach the persister via onSummary.
		const summary = createSummary({ taskId: "task-1", state: "running" });
		(manager as unknown as { emitSummary: (summary: RuntimeTaskSessionSummary) => void }).emitSummary(summary);
		expect(fakePersister.handleSummary).toHaveBeenCalledWith(summary);
	});

	it("writes the reconciled hydration state to disk immediately via saveWorkspaceSessionSummaries", async () => {
		workspaceStateMocks.loadWorkspaceState.mockResolvedValue({
			repoPath: "/tmp/ws",
			statePath: "/tmp/ws/state",
			git: { isGitRepository: true },
			board: { columns: [] },
			sessions: {
				"task-1": createSummary({ taskId: "task-1", state: "running", pausedAt: 111, pauseReason: "manual" }),
			},
			revision: 0,
		});

		const registry = await createWorkspaceRegistry(createDeps());
		await registry.ensureTerminalManagerForWorkspace("ws-1", "/tmp/ws");

		expect(workspaceStateMocks.saveWorkspaceSessionSummaries).toHaveBeenCalledTimes(1);
		const [workspaceId, summaries] = workspaceStateMocks.saveWorkspaceSessionSummaries.mock.calls[0]!;
		expect(workspaceId).toBe("ws-1");
		// hydrateFromRecord reconciles the pausedAt summary into the parked shape before
		// this write happens, so the immediately-persisted state should already reflect it.
		expect(summaries).toHaveLength(1);
		expect(summaries[0].taskId).toBe("task-1");
		expect(summaries[0].state).toBe("idle");
		expect(summaries[0].pausedAt).toBe(111);
	});

	it("disposeWorkspace flushes then disposes the workspace's persister and removes it from tracking", async () => {
		const registry = await createWorkspaceRegistry(createDeps());
		await registry.ensureTerminalManagerForWorkspace("ws-1", "/tmp/ws");
		const fakePersister = persisterMocks.createSessionSummaryPersister.mock.results[0]?.value as FakePersister;

		registry.disposeWorkspace("ws-1");
		// flush()/dispose() run in a fire-and-forget chain off disposeWorkspace's
		// synchronous return, so give the microtask queue a turn.
		await Promise.resolve();
		await Promise.resolve();

		expect(fakePersister.flush).toHaveBeenCalledTimes(1);
		expect(fakePersister.dispose).toHaveBeenCalledTimes(1);
		const flushOrder = fakePersister.flush.mock.invocationCallOrder[0]!;
		const disposeOrder = fakePersister.dispose.mock.invocationCallOrder[0]!;
		expect(flushOrder).toBeLessThan(disposeOrder);

		// Re-establishing the manager for the same workspaceId should create a fresh persister.
		await registry.ensureTerminalManagerForWorkspace("ws-1", "/tmp/ws");
		expect(persisterMocks.createSessionSummaryPersister).toHaveBeenCalledTimes(2);
	});

	it("disposeWorkspace with flushSessionSummaries: false discards the persister instead of flushing it", async () => {
		const registry = await createWorkspaceRegistry(createDeps());
		await registry.ensureTerminalManagerForWorkspace("ws-1", "/tmp/ws");
		const fakePersister = persisterMocks.createSessionSummaryPersister.mock.results[0]?.value as FakePersister;

		registry.disposeWorkspace("ws-1", { flushSessionSummaries: false });
		await Promise.resolve();
		await Promise.resolve();

		// A caller that already deleted (or is about to delete) the workspace directory
		// passes this so a racing write gets discarded, not written back after the fact.
		expect(fakePersister.flush).not.toHaveBeenCalled();
		expect(fakePersister.dispose).toHaveBeenCalledTimes(1);
	});

	it("flushWorkspaceSessionPersistence flushes only the requested workspace's persister", async () => {
		const registry = await createWorkspaceRegistry(createDeps());
		await registry.ensureTerminalManagerForWorkspace("ws-1", "/tmp/ws-1");
		await registry.ensureTerminalManagerForWorkspace("ws-2", "/tmp/ws-2");
		const persisterOne = persisterMocks.createSessionSummaryPersister.mock.results[0]?.value as FakePersister;
		const persisterTwo = persisterMocks.createSessionSummaryPersister.mock.results[1]?.value as FakePersister;

		await registry.flushWorkspaceSessionPersistence("ws-1");

		expect(persisterOne.flush).toHaveBeenCalledTimes(1);
		expect(persisterTwo.flush).not.toHaveBeenCalled();
	});

	it("flushWorkspaceSessionPersistence is a no-op for a workspace with no tracked persister", async () => {
		const registry = await createWorkspaceRegistry(createDeps());
		await expect(registry.flushWorkspaceSessionPersistence("unknown-ws")).resolves.toBeUndefined();
	});

	it("resolveWorkspaceForStream flushes a removed project's pending write before deleting its directory, then discards any race on dispose", async () => {
		const deps = createDeps();
		const registry = await createWorkspaceRegistry(deps);
		await registry.ensureTerminalManagerForWorkspace("ws-1", "/tmp/ws-1");
		const fakePersister = persisterMocks.createSessionSummaryPersister.mock.results[0]?.value as FakePersister;

		// This project is missing on disk (default `pathIsDirectory` mock isn't overridden,
		// but `hasGitRepository` already defaults to false, which alone triggers removal).
		workspaceStateMocks.listWorkspaceIndexEntries.mockResolvedValue([{ workspaceId: "ws-1", repoPath: "/tmp/ws-1" }]);
		workspaceStateMocks.removeWorkspaceIndexEntry.mockResolvedValue(true);

		const callOrder: string[] = [];
		fakePersister.flush.mockImplementation(async () => {
			callOrder.push("flush");
		});
		workspaceStateMocks.removeWorkspaceStateFiles.mockImplementation(async () => {
			callOrder.push("removeWorkspaceStateFiles");
		});

		await registry.resolveWorkspaceForStream(null);

		// The explicit pre-delete flush must land before the directory is removed...
		expect(callOrder).toEqual(["flush", "removeWorkspaceStateFiles"]);
		// ...and disposeWorkspace afterward must not flush a second time (that would be
		// exactly the resurrection bug: a write racing in during the delete's async I/O
		// getting written back out after the directory is gone).
		expect(fakePersister.flush).toHaveBeenCalledTimes(1);
		expect(fakePersister.dispose).toHaveBeenCalledTimes(1);
	});

	it("flushSessionPersistence awaits every tracked persister", async () => {
		const registry = await createWorkspaceRegistry(createDeps());
		await registry.ensureTerminalManagerForWorkspace("ws-1", "/tmp/ws-1");
		await registry.ensureTerminalManagerForWorkspace("ws-2", "/tmp/ws-2");

		const persisterOne = persisterMocks.createSessionSummaryPersister.mock.results[0]?.value as FakePersister;
		const persisterTwo = persisterMocks.createSessionSummaryPersister.mock.results[1]?.value as FakePersister;

		await registry.flushSessionPersistence();

		expect(persisterOne.flush).toHaveBeenCalledTimes(1);
		expect(persisterTwo.flush).toHaveBeenCalledTimes(1);
	});

	it("creates and wires a snapshot store when the terminal manager is hydrated", async () => {
		const registry = await createWorkspaceRegistry(createDeps());

		const manager = await registry.ensureTerminalManagerForWorkspace("ws-1", "/tmp/ws");

		expect(terminalMocks.createTerminalSnapshotStore).toHaveBeenCalledWith("ws-1");
		const mockStore = terminalMocks.createTerminalSnapshotStore.mock.results[0]?.value;
		expect(manager.getSnapshotStore()).toBe(mockStore);
	});
});
