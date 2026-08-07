import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import type { UsePersistentTerminalSessionResult } from "@/terminal/use-persistent-terminal-session";

const mockUsePersistentTerminalSession = vi.hoisted(() => vi.fn());

vi.mock("@/terminal/use-persistent-terminal-session", () => ({
	usePersistentTerminalSession: (...args: unknown[]) => mockUsePersistentTerminalSession(...args),
}));

function createSessionControls(
	overrides?: Partial<UsePersistentTerminalSessionResult>,
): UsePersistentTerminalSessionResult {
	return {
		containerRef: createRef<HTMLDivElement>(),
		lastError: null,
		isStopping: false,
		restoreWasEmpty: false,
		staleRestore: false,
		clearTerminal: vi.fn(),
		stopTerminal: vi.fn(async () => {}),
		...overrides,
	};
}

function createSummary(
	overrides?: Partial<RuntimeTaskSessionSummary>,
): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "idle",
		agentId: "claude",
		workspacePath: "/tmp/worktree",
		pid: null,
		startedAt: 1,
		activeRunMs: 0,
		runningSince: null,
		pausedAt: null,
		pauseReason: null,
		updatedAt: 1,
		lastOutputAt: 1,
		reviewReason: null,
		exitCode: null,
		lastHookAt: 1,
		latestHookActivity: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
		...overrides,
	};
}

describe("AgentTerminalPanel", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		mockUsePersistentTerminalSession.mockReset();
		mockUsePersistentTerminalSession.mockReturnValue(createSessionControls());
		previousActEnvironment = (
			globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT;
		(
			globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (
				globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
			).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(
				globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
			).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
		}
	});

	it("does not show the ended-session bar or empty state for a live, non-paused session", async () => {
		await act(async () => {
			root.render(
				<AgentTerminalPanel
					taskId="task-1"
					workspaceId="workspace-1"
					summary={createSummary({ state: "running" })}
				/>,
			);
		});

		expect(container.querySelector('[data-testid="ended-session-bar"]')).toBeNull();
		expect(container.querySelector('[data-testid="ended-session-empty-state"]')).toBeNull();
	});

	it("shows the paused-offline bar with a Resume agent button when a snapshot exists", async () => {
		mockUsePersistentTerminalSession.mockReturnValue(
			createSessionControls({ restoreWasEmpty: false }),
		);
		const onResumeEndedSession = vi.fn();

		await act(async () => {
			root.render(
				<AgentTerminalPanel
					taskId="task-1"
					workspaceId="workspace-1"
					summary={createSummary({ pausedAt: 100, pid: null })}
					onResumeEndedSession={onResumeEndedSession}
				/>,
			);
		});

		const bar = container.querySelector('[data-testid="ended-session-bar"]');
		expect(bar).not.toBeNull();
		expect(bar?.textContent).toContain("Session ended — showing the last output");
		expect(container.querySelector('[data-testid="ended-session-empty-state"]')).toBeNull();

		const resumeButton = Array.from(bar?.querySelectorAll("button") ?? []).find((button) =>
			button.textContent?.includes("Resume agent"),
		);
		expect(resumeButton).toBeDefined();

		await act(async () => {
			resumeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(onResumeEndedSession).toHaveBeenCalledWith("task-1");
	});

	it("replaces the terminal box with a centered empty state when there is no snapshot at all", async () => {
		mockUsePersistentTerminalSession.mockReturnValue(
			createSessionControls({ restoreWasEmpty: true }),
		);
		const onResumeEndedSession = vi.fn();

		await act(async () => {
			root.render(
				<AgentTerminalPanel
					taskId="task-1"
					workspaceId="workspace-1"
					summary={createSummary({ pausedAt: 100, pid: null })}
					onResumeEndedSession={onResumeEndedSession}
				/>,
			);
		});

		expect(container.querySelector('[data-testid="ended-session-bar"]')).toBeNull();
		const emptyState = container.querySelector('[data-testid="ended-session-empty-state"]');
		expect(emptyState).not.toBeNull();
		expect(emptyState?.textContent).toContain("Session ended — showing the last output");

		const resumeButton = Array.from(emptyState?.querySelectorAll("button") ?? []).find((button) =>
			button.textContent?.includes("Resume agent"),
		);
		expect(resumeButton).toBeDefined();

		await act(async () => {
			resumeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(onResumeEndedSession).toHaveBeenCalledWith("task-1");
	});

	it("does not show the bar or empty state for a live-paused session (pid still set)", async () => {
		mockUsePersistentTerminalSession.mockReturnValue(
			createSessionControls({ restoreWasEmpty: false }),
		);

		await act(async () => {
			root.render(
				<AgentTerminalPanel
					taskId="task-1"
					workspaceId="workspace-1"
					summary={createSummary({ pausedAt: 100, pid: 4242 })}
				/>,
			);
		});

		expect(container.querySelector('[data-testid="ended-session-bar"]')).toBeNull();
		expect(container.querySelector('[data-testid="ended-session-empty-state"]')).toBeNull();
	});
});
