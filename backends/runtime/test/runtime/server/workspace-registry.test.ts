import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeConfigState } from "../../../src/config/runtime-config";
import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";

const persisterMocks = vi.hoisted(() => ({
	createSessionSummaryPersister: vi.fn(),
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
});
