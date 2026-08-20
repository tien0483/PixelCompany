import { describe, expect, it, vi } from "vitest";

import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import { buildShellCommandLine } from "../../../src/core/shell";
import { TerminalSessionManager } from "../../../src/terminal/session-manager";

function createSummary(overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "running",
		agentId: "claude",
		workspacePath: "/tmp/worktree",
		pid: 1234,
		startedAt: Date.now(),
		activeRunMs: 0,
		runningSince: null,
		pausedAt: null,
		pauseReason: null,
		updatedAt: Date.now(),
		lastOutputAt: Date.now(),
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		...overrides,
	};
}

describe("TerminalSessionManager", () => {
	it("clears trust prompt state when transitioning to review", () => {
		const manager = new TerminalSessionManager();
		const entry = {
			summary: createSummary({ state: "running", reviewReason: null }),
			active: {
				workspaceTrustBuffer: "trust this folder",
				awaitingCodexPromptAfterEnter: true,
			},
			listenerIdCounter: 1,
			listeners: new Map(),
		};
		const applySessionEvent = (
			manager as unknown as {
				applySessionEvent: (sessionEntry: unknown, event: { type: "hook.to_review" }) => RuntimeTaskSessionSummary;
			}
		).applySessionEvent;
		const nextSummary = applySessionEvent(entry, { type: "hook.to_review" });
		expect(nextSummary.state).toBe("awaiting_review");
		expect(entry.active.workspaceTrustBuffer).toBe("");
	});

	it("builds shell kickoff command lines with quoted arguments", () => {
		const commandLine = buildShellCommandLine("cline", ["--auto-approve-all", "hello world"]);
		expect(commandLine).toContain("cline");
		expect(commandLine).toContain("--auto-approve-all");
		expect(commandLine).toContain("hello world");
	});

	it("stores hook activity metadata on sessions", () => {
		const manager = new TerminalSessionManager();
		manager.hydrateFromRecord({
			"task-1": createSummary({ state: "running" }),
		});

		const updated = manager.applyHookActivity("task-1", {
			source: "claude",
			activityText: "Using Read",
			toolName: "Read",
		});

		expect(updated?.latestHookActivity?.source).toBe("claude");
		expect(updated?.latestHookActivity?.activityText).toBe("Using Read");
		expect(updated?.latestHookActivity?.toolName).toBe("Read");
		expect(typeof updated?.lastHookAt).toBe("number");
	});

	it("preserves planText across a later to_review activity patch", () => {
		const manager = new TerminalSessionManager();
		manager.hydrateFromRecord({
			"task-1": createSummary({ state: "running" }),
		});

		manager.applyHookActivity("task-1", {
			source: "claude",
			activityText: "Using ExitPlanMode",
			toolName: "ExitPlanMode",
			planText: "# Plan\n\nShip it.",
		});

		const afterReviewHook = manager.applyHookActivity("task-1", {
			source: "claude",
			activityText: "Waiting for approval",
			hookEventName: "PermissionRequest",
			notificationType: "permission_prompt",
		});

		expect(afterReviewHook?.latestHookActivity?.toolName).toBe("ExitPlanMode");
		expect(afterReviewHook?.latestHookActivity?.planText).toBe("# Plan\n\nShip it.");
		expect(afterReviewHook?.latestHookActivity?.activityText).toBe("Waiting for approval");
	});

	it("resets stale sessions without active processes", () => {
		const manager = new TerminalSessionManager();
		// Use "awaiting_review" rather than "running" here: hydrateFromRecord now runs
		// reconcileHydratedSessionSummary (Task 4 wiring), which already reclassifies a
		// hydrated "running" (unpaused) summary as "interrupted" — a state
		// recoverStaleSession intentionally leaves alone since it's no longer "active".
		// "awaiting_review" stays active through reconcile, so this still exercises
		// recoverStaleSession's own stale-session reset independently of hydrate's reconcile.
		manager.hydrateFromRecord({
			"task-1": createSummary({ state: "awaiting_review" }),
		});

		const recovered = manager.recoverStaleSession("task-1");

		expect(recovered?.state).toBe("idle");
		expect(recovered?.pid).toBeNull();
		expect(recovered?.agentId).toBe("claude");
		expect(recovered?.workspacePath).toBeNull();
		expect(recovered?.reviewReason).toBeNull();
	});

	it("reconciles a hydrated running+pausedAt summary into idle+paused on hydrateFromRecord", () => {
		const manager = new TerminalSessionManager();
		manager.hydrateFromRecord({
			"task-1": createSummary({
				state: "running",
				pausedAt: 1_000,
				pauseReason: "manual",
				pid: 4321,
				runningSince: 500,
			}),
		});

		const summary = manager.getSummary("task-1");

		// Matches terminal/session-hydration.ts's reconcile: pausedAt != null always wins
		// and comes back parked (idle, no process), regardless of the run state it was
		// hydrated with.
		expect(summary?.state).toBe("idle");
		expect(summary?.pausedAt).toBe(1_000);
		expect(summary?.pauseReason).toBe("manual");
		expect(summary?.pid).toBeNull();
		expect(summary?.runningSince).toBeNull();
	});

	it("carries pausedAt/pauseReason through recoverStaleSession's patch when a stale session was also paused", () => {
		// recoverStaleSession only applies its reset patch to entries in an "active" state
		// (running/awaiting_review) with no live process — hydrateFromRecord's own reconcile
		// would already have parked a pausedAt summary, so to exercise recoverStaleSession's
		// own carry-through we set up the entry directly, bypassing hydrate's reconcile.
		const manager = new TerminalSessionManager();
		const entry = {
			summary: createSummary({
				state: "awaiting_review",
				pausedAt: 2_000,
				pauseReason: "max_runtime",
			}),
			active: null,
			terminalStateMirror: null,
			listenerIdCounter: 1,
			listeners: new Map(),
			restartRequest: null,
			suppressAutoRestartOnExit: false,
			autoRestartTimestamps: [],
			pendingAutoRestart: null,
		};
		(
			manager as unknown as {
				entries: Map<string, typeof entry>;
			}
		).entries.set("task-1", entry);

		const recovered = manager.recoverStaleSession("task-1");

		expect(recovered?.state).toBe("idle");
		expect(recovered?.pausedAt).toBe(2_000);
		expect(recovered?.pauseReason).toBe("max_runtime");
	});

	it("tracks only the latest two turn checkpoints", () => {
		const manager = new TerminalSessionManager();
		manager.hydrateFromRecord({
			"task-1": createSummary({ state: "running" }),
		});

		manager.applyTurnCheckpoint("task-1", {
			turn: 1,
			ref: "refs/kanban/checkpoints/task-1/turn/1",
			commit: "1111111",
			createdAt: 1,
		});
		manager.applyTurnCheckpoint("task-1", {
			turn: 2,
			ref: "refs/kanban/checkpoints/task-1/turn/2",
			commit: "2222222",
			createdAt: 2,
		});

		const summary = manager.getSummary("task-1");
		expect(summary?.latestTurnCheckpoint?.turn).toBe(2);
		expect(summary?.previousTurnCheckpoint?.turn).toBe(1);
	});

	it("does not replay raw PTY history when attaching an output listener", () => {
		const manager = new TerminalSessionManager();
		const onOutput = vi.fn();
		const entry = {
			summary: createSummary({ taskId: "task-probe", state: "running" }),
			active: {
				session: {},
				terminalProtocolFilter: {
					pendingChunk: null,
					interceptOscColorQueries: true,
					suppressDeviceAttributeQueries: false,
				},
			},
			terminalStateMirror: null,
			listenerIdCounter: 1,
			listeners: new Map(),
		};
		(
			manager as unknown as {
				entries: Map<string, typeof entry>;
			}
		).entries.set("task-probe", entry);

		manager.attach("task-probe", {
			onOutput,
		});

		expect(onOutput).not.toHaveBeenCalled();
		expect(entry.active.terminalProtocolFilter.interceptOscColorQueries).toBe(false);
	});

	it("keeps the startup probe filter enabled when only a non-output listener attaches", () => {
		const manager = new TerminalSessionManager();
		const entry = {
			summary: createSummary({ taskId: "task-control-first", state: "running" }),
			active: {
				session: {
					write: vi.fn(),
				},
				terminalProtocolFilter: {
					pendingChunk: null,
					interceptOscColorQueries: true,
					suppressDeviceAttributeQueries: false,
				},
			},
			terminalStateMirror: null,
			listenerIdCounter: 1,
			listeners: new Map(),
		};
		(
			manager as unknown as {
				entries: Map<string, typeof entry>;
			}
		).entries.set("task-control-first", entry);

		manager.attach("task-control-first", {
			onState: vi.fn(),
			onExit: vi.fn(),
		});

		expect(entry.active.terminalProtocolFilter.interceptOscColorQueries).toBe(true);
		expect(entry.active.terminalProtocolFilter.pendingChunk).toBeNull();
	});

	it("forwards pixel dimensions through resize when provided", () => {
		const manager = new TerminalSessionManager();
		const resizeSpy = vi.fn();
		const resizeMirrorSpy = vi.fn();
		const entry = {
			summary: createSummary({ taskId: "task-resize", state: "running" }),
			active: {
				session: {
					resize: resizeSpy,
				},
				cols: 80,
				rows: 24,
			},
			terminalStateMirror: {
				resize: resizeMirrorSpy,
			},
			listenerIdCounter: 1,
			listeners: new Map(),
		};
		(
			manager as unknown as {
				entries: Map<string, typeof entry>;
			}
		).entries.set("task-resize", entry);

		const resized = manager.resize("task-resize", 100, 30, 1200, 720);
		expect(resized).toBe(true);
		expect(resizeSpy).toHaveBeenCalledWith(100, 30, 1200, 720);
		expect(resizeMirrorSpy).toHaveBeenCalledWith(100, 30);
	});

	it("returns the latest terminal restore snapshot when available", async () => {
		const manager = new TerminalSessionManager();
		const getSnapshotSpy = vi.fn(async () => ({
			snapshot: "serialized terminal",
			cols: 120,
			rows: 40,
		}));
		const entry = {
			summary: createSummary({ taskId: "task-restore", state: "running" }),
			active: null,
			terminalStateMirror: {
				getSnapshot: getSnapshotSpy,
			},
			listenerIdCounter: 1,
			listeners: new Map(),
		};
		(
			manager as unknown as {
				entries: Map<string, typeof entry>;
			}
		).entries.set("task-restore", entry);

		const snapshot = await manager.getRestoreSnapshot("task-restore");

		expect(snapshot).toEqual({
			snapshot: "serialized terminal",
			cols: 120,
			rows: 40,
			stale: false,
			capturedAt: null,
		});
		expect(getSnapshotSpy).toHaveBeenCalledTimes(1);
	});

	describe("markAuthFailoverOutcome", () => {
		it("is a no-op for an unknown taskId", () => {
			const manager = new TerminalSessionManager();
			expect(manager.markAuthFailoverOutcome("does-not-exist", "no_healthy_seat")).toBeNull();
		});

		it("patches the outcome without touching state, reviewReason, or warningMessage", () => {
			const manager = new TerminalSessionManager();
			manager.hydrateFromRecord({
				"task-1": createSummary({
					state: "awaiting_review",
					reviewReason: "error",
					warningMessage: "Claude Code needs login. Open the task terminal and run /login.",
				}),
			});

			const updated = manager.markAuthFailoverOutcome("task-1", "no_healthy_seat");

			expect(updated?.authFailoverOutcome).toBe("no_healthy_seat");
			expect(updated?.authFailoverOutcomeDetail).toBeNull();
			expect(updated?.state).toBe("awaiting_review");
			expect(updated?.reviewReason).toBe("error");
			expect(updated?.warningMessage).toBe("Claude Code needs login. Open the task terminal and run /login.");
		});

		it("stores detail only for restart_failed", () => {
			const manager = new TerminalSessionManager();
			manager.hydrateFromRecord({
				"task-1": createSummary({ state: "awaiting_review", reviewReason: "error" }),
			});

			const withDetail = manager.markAuthFailoverOutcome("task-1", "restart_failed", "spawn ENOENT");
			expect(withDetail?.authFailoverOutcome).toBe("restart_failed");
			expect(withDetail?.authFailoverOutcomeDetail).toBe("spawn ENOENT");

			const withoutDetail = manager.markAuthFailoverOutcome("task-1", "cap_reached", "ignored detail");
			expect(withoutDetail?.authFailoverOutcome).toBe("cap_reached");
			expect(withoutDetail?.authFailoverOutcomeDetail).toBeNull();
		});
	});
});
