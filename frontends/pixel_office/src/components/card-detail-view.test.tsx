import { act, forwardRef, type ReactNode, useImperativeHandle } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CardDetailView } from "@/components/card-detail-view";
import type {
	RuntimeManagerAccount,
	RuntimeTaskSessionSummary,
} from "@/runtime/types";
import { LocalStorageKey } from "@/storage/local-storage-store";
import { TERMINAL_THEME_COLORS } from "@/terminal/theme-colors";
import type { BoardCard, BoardColumn, CardSelection } from "@/types";

const mockUseRuntimeWorkspaceChanges = vi.fn();
const {
	mockAgentTerminalPanel,
	mockClineAgentChatPanel,
	mockDiffViewerPanel,
	mockClineAppendToDraft,
	mockClineSendText,
} = vi.hoisted(() => ({
	mockAgentTerminalPanel: vi.fn(
		(_props: {
			panelBackgroundColor?: string;
			terminalBackgroundColor?: string;
		}) => null,
	),
	mockClineAgentChatPanel: vi.fn((..._args: unknown[]) => null),
	mockDiffViewerPanel: vi.fn((..._args: unknown[]) => null),
	mockClineAppendToDraft: vi.fn(),
	mockClineSendText: vi.fn(async () => {}),
}));

vi.mock("react-hotkeys-hook", () => ({
	useHotkeys: () => {},
}));

vi.mock("@/hooks/use-is-mobile", () => ({
	useIsMobile: () => false,
}));

vi.mock("@/components/detail-panels/agent-terminal-panel", () => ({
	AgentTerminalPanel: mockAgentTerminalPanel,
}));

vi.mock("@/components/detail-panels/cline-agent-chat-panel", () => ({
	ClineAgentChatPanel: forwardRef((props: unknown, ref) => {
		mockClineAgentChatPanel(props);
		useImperativeHandle(ref, () => ({
			appendToDraft: mockClineAppendToDraft,
			sendText: mockClineSendText,
		}));
		return <div data-testid="cline-agent-chat-panel" />;
	}),
}));

vi.mock("@/components/detail-panels/column-context-panel", () => ({
	ColumnContextPanel: () => <div data-testid="column-context-panel" />,
}));

vi.mock("@/components/detail-panels/diff-viewer-panel", () => ({
	DiffViewerPanel: (props: unknown) => {
		mockDiffViewerPanel(props);
		return <div data-testid="diff-viewer-panel" />;
	},
}));

vi.mock("@/components/detail-panels/file-tree-panel", () => ({
	FileTreePanel: () => <div data-testid="file-tree-panel" />,
}));

vi.mock("@/resize/resizable-bottom-pane", () => ({
	ResizableBottomPane: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
}));

vi.mock("@/runtime/use-runtime-workspace-changes", () => ({
	useRuntimeWorkspaceChanges: (...args: unknown[]) =>
		mockUseRuntimeWorkspaceChanges(...args),
}));

vi.mock("@/stores/workspace-metadata-store", () => ({
	useTaskWorkspaceStateVersionValue: () => 0,
}));

vi.mock("@/resize/layout-customizations", () => ({
	useLayoutResetEffect: () => {},
}));

const { mockSavePlan, mockShowAppToast, mockTrackPlanSaved } = vi.hoisted(
	() => ({
		mockSavePlan: vi.fn(),
		mockShowAppToast: vi.fn(),
		mockTrackPlanSaved: vi.fn(),
	}),
);

vi.mock("@/hooks/use-save-plan-from-session", () => ({
	useSavePlanFromSession: () => ({
		savePlan: mockSavePlan,
		isSaving: false,
	}),
}));

vi.mock("@/components/app-toaster", () => ({
	showAppToast: mockShowAppToast,
	notifyError: vi.fn(),
}));

// The DevTools tab is driven by the agent-stack switchboard, which is not running
// in tests; mockDevtoolsUrl stands in for its resolved dashboard URL.
const { mockDevtoolsUrl } = vi.hoisted(() => ({
	mockDevtoolsUrl: { current: null as string | null },
}));

vi.mock("@/hooks/use-stack-devtools", () => ({
	useStackDevtools: () => ({ devtoolsUrl: mockDevtoolsUrl.current }),
}));

vi.mock("@/telemetry/events", () => ({
	trackPlanSaved: mockTrackPlanSaved,
}));

vi.mock("@/components/plan-editor/plan-markdown-preview", () => ({
	PlanMarkdownPreview: ({ content }: { content: string }) => (
		<pre data-testid="plan-markdown-preview">{content}</pre>
	),
}));

function createCard(id: string): BoardCard {
	return {
		id,
		title: `Task ${id}`,
		prompt: `Task ${id}`,
		startInPlanMode: false,
		autoReviewEnabled: false,
		autoReviewMode: "commit",
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
	};
}

function createSessionSummary(
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

function createManagerAccount(
	id: number,
	provider: RuntimeManagerAccount["provider"] = "claude",
): RuntimeManagerAccount {
	return {
		id,
		provider,
		email: `user${id}@example.com`,
		displayName: null,
		organizationName: null,
		isActive: true,
		fiveHourPercent: 10,
		sevenDayPercent: 5,
		fiveHourResetsAt: null,
		sevenDayResetsAt: null,
		usageCachedAt: null,
		subscriptionType: null,
		donateLimitPercent: 100,
		donateLimitLocked: false,
		pressure: 0.1,
		nextRefreshAt: null,
		canAutoSwap: true,
		canTrackUsage: true,
		hasCcToken: true,
		ccNeedsAuth: false,
		isActiveForProvider: true,
		validationStatus: "valid",
		lastError: null,
	};
}

function createSelection(): CardSelection {
	const card = createCard("task-1");
	const columns: BoardColumn[] = [
		{
			id: "backlog",
			title: "Backlog",
			cards: [card],
		},
		{
			id: "in_progress",
			title: "In Progress",
			cards: [],
		},
		{
			id: "review",
			title: "Review",
			cards: [],
		},
		{
			id: "trash",
			title: "Done",
			cards: [],
		},
	];
	return {
		card,
		column: columns[0]!,
		allColumns: columns,
	};
}

type MockedDiffViewerProps = {
	onAddToTerminal?: (formatted: string) => void;
	onSendToTerminal?: (formatted: string) => void;
};

function getLastMockFirstArg<T>(mockFn: { mock: { calls: unknown[][] } }): T {
	const lastCall = mockFn.mock.calls.at(-1);
	expect(lastCall).toBeDefined();
	return lastCall?.[0] as T;
}

function requireResizeSeparator(container: HTMLElement): HTMLElement {
	const separator = container.querySelector(
		'[aria-label="Resize agent and diff panels"]',
	);
	if (!(separator instanceof HTMLElement)) {
		throw new Error("Expected a resize separator.");
	}
	return separator;
}

function requireAgentPanel(container: HTMLElement): HTMLElement {
	const separator = requireResizeSeparator(container);
	const panel = separator.previousElementSibling;
	if (!(panel instanceof HTMLElement)) {
		throw new Error("Expected an agent panel element.");
	}
	return panel;
}

function requireDetailDiffSeparator(container: HTMLElement): HTMLElement {
	const separator = container.querySelector(
		'[aria-label="Resize detail diff panels"]',
	);
	if (!(separator instanceof HTMLElement)) {
		throw new Error("Expected a detail diff resize separator.");
	}
	return separator;
}

function requireDetailDiffFileTreePanel(container: HTMLElement): HTMLElement {
	const separator = requireDetailDiffSeparator(container);
	const panel = separator.nextElementSibling;
	if (!(panel instanceof HTMLElement)) {
		throw new Error("Expected a detail diff file tree panel element.");
	}
	return panel;
}

describe("CardDetailView", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		window.localStorage.clear();
		previousActEnvironment = (
			globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT;
		(
			globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		mockAgentTerminalPanel.mockClear();
		mockClineAgentChatPanel.mockClear();
		mockDiffViewerPanel.mockClear();
		mockClineAppendToDraft.mockClear();
		mockClineSendText.mockClear();
		mockSavePlan.mockReset();
		mockShowAppToast.mockReset();
		mockTrackPlanSaved.mockReset();
		mockUseRuntimeWorkspaceChanges.mockReturnValue({
			changes: {
				files: [
					{
						path: "src/example.ts",
						status: "modified",
						additions: 1,
						deletions: 0,
						oldText: "before\n",
						newText: "after\n",
					},
				],
			},
			isRuntimeAvailable: true,
		});
		mockDevtoolsUrl.current = null;
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		mockUseRuntimeWorkspaceChanges.mockReset();
		mockAgentTerminalPanel.mockClear();
		mockClineAgentChatPanel.mockClear();
		mockDiffViewerPanel.mockClear();
		mockClineAppendToDraft.mockClear();
		mockClineSendText.mockClear();
		vi.restoreAllMocks();
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

	it("collapses the expanded diff on Escape without closing the detail view", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		const expandButton = container.querySelector(
			'button[aria-label="Expand split diff view"]',
		);
		expect(expandButton).toBeInstanceOf(HTMLButtonElement);
		if (!(expandButton instanceof HTMLButtonElement)) {
			throw new Error("Expected an expand diff button.");
		}

		await act(async () => {
			expandButton.dispatchEvent(
				new MouseEvent("mousedown", { bubbles: true }),
			);
			expandButton.click();
		});

		const toolbarButtons = Array.from(container.querySelectorAll("button"));
		expect(toolbarButtons[0]?.getAttribute("aria-label")).toBe(
			"Collapse expanded diff view",
		);
		expect(toolbarButtons[1]?.textContent?.trim()).toBe("All Changes");
		expect(toolbarButtons[2]?.textContent?.trim()).toBe("Last Turn");
		expect(
			container.querySelector('button[aria-label="Expand split diff view"]'),
		).toBeNull();

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
					cancelable: true,
				}),
			);
		});

		expect(
			container.querySelector(
				'button[aria-label="Collapse expanded diff view"]',
			),
		).toBeNull();
		expect(
			container.querySelector('button[aria-label="Expand split diff view"]'),
		).toBeInstanceOf(HTMLButtonElement);
	});

	it("clears stale diff content when switching from all changes to last turn", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		const lastTurnButton = Array.from(
			container.querySelectorAll("button"),
		).find((button) => button.textContent?.trim() === "Last Turn");
		expect(lastTurnButton).toBeInstanceOf(HTMLButtonElement);
		if (!(lastTurnButton instanceof HTMLButtonElement)) {
			throw new Error("Expected a Last Turn button.");
		}

		await act(async () => {
			lastTurnButton.dispatchEvent(
				new MouseEvent("mousedown", { bubbles: true }),
			);
			lastTurnButton.click();
		});

		const lastCall = mockUseRuntimeWorkspaceChanges.mock.calls.at(-1);
		expect(lastCall?.[3]).toBe("last_turn");
		expect(lastCall?.[7]).toBe(true);
	});

	it("keeps the active diff mode visually highlighted", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		const getDiffModeButton = (label: string): HTMLButtonElement => {
			const button = Array.from(container.querySelectorAll("button")).find(
				(candidate) => candidate.textContent?.trim() === label,
			);
			if (!(button instanceof HTMLButtonElement)) {
				throw new Error(`Expected a ${label} button.`);
			}
			return button;
		};

		const allChangesButton = getDiffModeButton("All Changes");
		const lastTurnButton = getDiffModeButton("Last Turn");

		expect(allChangesButton.getAttribute("aria-pressed")).toBe("true");
		expect(allChangesButton.getAttribute("style")).toContain(
			"background-color: color-mix(in srgb, var(--color-surface-3) 80%, var(--color-text-primary))",
		);
		expect(lastTurnButton.getAttribute("aria-pressed")).toBe("false");
		expect(lastTurnButton.style.backgroundColor).toBe("");

		await act(async () => {
			lastTurnButton.dispatchEvent(
				new MouseEvent("mousedown", { bubbles: true }),
			);
			lastTurnButton.click();
		});

		expect(getDiffModeButton("All Changes").getAttribute("aria-pressed")).toBe(
			"false",
		);
		expect(getDiffModeButton("All Changes").style.backgroundColor).toBe("");
		expect(getDiffModeButton("Last Turn").getAttribute("aria-pressed")).toBe(
			"true",
		);
		expect(getDiffModeButton("Last Turn").getAttribute("style")).toContain(
			"background-color: color-mix(in srgb, var(--color-surface-3) 80%, var(--color-text-primary))",
		);
	});

	it("closes git history before handling other Escape behavior", async () => {
		const onCloseGitHistory = vi.fn();

		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					gitHistoryPanel={
						<div data-testid="git-history-panel">Git history</div>
					}
					onCloseGitHistory={onCloseGitHistory}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		const input = document.createElement("input");
		container.appendChild(input);
		input.focus();

		await act(async () => {
			input.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
					cancelable: true,
				}),
			);
		});

		expect(onCloseGitHistory).toHaveBeenCalledTimes(1);
	});

	it("renders native chat panel for cline agent", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					selectedAgentId="cline"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		expect(
			container.querySelector('[data-testid="cline-agent-chat-panel"]'),
		).toBeInstanceOf(HTMLDivElement);
		expect(
			container.querySelector('[data-testid="agent-terminal-panel"]'),
		).toBeNull();
	});

	it("does not render native chat panel when the task explicitly uses a non-cline agent", async () => {
		const selection = createSelection();
		selection.card.agentId = "codex";

		await act(async () => {
			root.render(
				<CardDetailView
					selection={selection}
					currentProjectId="workspace-1"
					selectedAgentId="cline"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		expect(
			container.querySelector('[data-testid="cline-agent-chat-panel"]'),
		).toBeNull();
	});

	it("shows cline chat panel when task session agentId is cline even if global agent is claude", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					selectedAgentId="claude"
					sessionSummary={{
						taskId: "task-1",
						state: "running",
						agentId: "cline",
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
						warningMessage: null,
					}}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		expect(
			container.querySelector('[data-testid="cline-agent-chat-panel"]'),
		).toBeInstanceOf(HTMLDivElement);
	});

	it("shows terminal panel when task session agentId is claude even if global agent is cline", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					selectedAgentId="cline"
					sessionSummary={{
						taskId: "task-1",
						state: "running",
						agentId: "claude",
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
						warningMessage: null,
					}}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		expect(
			container.querySelector('[data-testid="cline-agent-chat-panel"]'),
		).toBeNull();
		expect(mockAgentTerminalPanel).toHaveBeenCalled();
	});

	it("uses surface-primary colors for the detail terminal panel", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					selectedAgentId="claude"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		const lastCall = mockAgentTerminalPanel.mock.calls.at(-1);
		expect(lastCall?.[0]).toMatchObject({
			panelBackgroundColor: "var(--color-surface-0)",
			terminalBackgroundColor: TERMINAL_THEME_COLORS.surfacePrimary,
		});
	});

	it("queues Add diff comments into the cline composer without sending them", async () => {
		const onAddReviewComments = vi.fn();

		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					selectedAgentId="cline"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					onAddReviewComments={onAddReviewComments}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		const diffProps =
			getLastMockFirstArg<MockedDiffViewerProps>(mockDiffViewerPanel);
		expect(diffProps.onAddToTerminal).toBeTypeOf("function");

		await act(async () => {
			diffProps.onAddToTerminal?.("src/example.ts:4 | value\n> Add tests");
		});

		expect(onAddReviewComments).not.toHaveBeenCalled();
		expect(mockClineAppendToDraft).toHaveBeenCalledWith(
			"src/example.ts:4 | value\n> Add tests",
		);
	});

	it("routes Send diff comments through the mounted cline panel", async () => {
		const onSendReviewComments = vi.fn();

		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					selectedAgentId="cline"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					onSendReviewComments={onSendReviewComments}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		const diffProps =
			getLastMockFirstArg<MockedDiffViewerProps>(mockDiffViewerPanel);
		expect(diffProps.onSendToTerminal).toBeTypeOf("function");

		await act(async () => {
			diffProps.onSendToTerminal?.("src/example.ts:8 | done\n> Ship this");
			await Promise.resolve();
		});

		expect(onSendReviewComments).not.toHaveBeenCalled();
		expect(mockClineSendText).toHaveBeenCalledWith(
			"src/example.ts:8 | done\n> Ship this",
		);
	});

	it("loads the saved agent-to-diff panel ratio from local storage", async () => {
		window.localStorage.setItem(LocalStorageKey.DetailAgentPanelRatio, "0.62");

		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		expect(requireAgentPanel(container).style.width).toBe("62%");
	});

	it("persists the resized agent-to-diff panel ratio globally", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		const separator = requireResizeSeparator(container);
		const dragHandle = separator.firstElementChild;
		expect(dragHandle).toBeInstanceOf(HTMLDivElement);
		if (!(dragHandle instanceof HTMLDivElement)) {
			throw new Error("Expected a draggable resize handle.");
		}

		await act(async () => {
			dragHandle.dispatchEvent(
				new MouseEvent("mousedown", { bubbles: true, clientX: 160 }),
			);
		});
		await act(async () => {
			window.dispatchEvent(new MouseEvent("mousemove", { clientX: 320 }));
			window.dispatchEvent(new MouseEvent("mouseup", { clientX: 320 }));
		});

		const savedRatioRaw = window.localStorage.getItem(
			LocalStorageKey.DetailAgentPanelRatio,
		);
		expect(savedRatioRaw).not.toBeNull();
		const savedRatio = Number(savedRatioRaw);
		expect(savedRatio).toBeGreaterThan(0.4);
		expect(savedRatio).toBeLessThanOrEqual(0.75);
		expect(requireAgentPanel(container).style.width).not.toBe("40%");
	});

	it("keeps the saved divider position after leaving and reopening task detail", async () => {
		const renderDetail = async (): Promise<void> => {
			await act(async () => {
				root.render(
					<CardDetailView
						selection={createSelection()}
						currentProjectId="workspace-1"
						sessionSummary={null}
						taskSessions={{}}
						onSessionSummary={() => {}}
						onCardSelect={() => {}}
						onTaskDragEnd={() => {}}
						onMoveToTrash={() => {}}
						bottomTerminalOpen={false}
						bottomTerminalTaskId={null}
						bottomTerminalSummary={null}
						onBottomTerminalClose={() => {}}
					/>,
				);
			});
		};

		await renderDetail();

		const separator = requireResizeSeparator(container);
		const dragHandle = separator.firstElementChild;
		expect(dragHandle).toBeInstanceOf(HTMLDivElement);
		if (!(dragHandle instanceof HTMLDivElement)) {
			throw new Error("Expected a draggable resize handle.");
		}

		await act(async () => {
			dragHandle.dispatchEvent(
				new MouseEvent("mousedown", { bubbles: true, clientX: 200 }),
			);
			window.dispatchEvent(new MouseEvent("mouseup", { clientX: 420 }));
		});

		const expectedRatio = window.localStorage.getItem(
			LocalStorageKey.DetailAgentPanelRatio,
		);
		expect(expectedRatio).not.toBeNull();

		await act(async () => {
			root.unmount();
			root = createRoot(container);
		});

		await renderDetail();

		const restoredWidth = requireAgentPanel(container).style.width;
		const restoredRatio = Number.parseFloat(restoredWidth) / 100;
		expect(restoredRatio).toBeCloseTo(Number(expectedRatio), 2);
	});

	it("uses separate file-tree ratios for collapsed and expanded diff layouts", async () => {
		window.localStorage.setItem(
			LocalStorageKey.DetailDiffFileTreePanelRatio,
			"0.42",
		);
		window.localStorage.setItem(
			LocalStorageKey.DetailExpandedDiffFileTreePanelRatio,
			"0.18",
		);

		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		expect(requireDetailDiffFileTreePanel(container).style.flex).toBe(
			"0 0 42%",
		);

		const expandButton = container.querySelector(
			'button[aria-label="Expand split diff view"]',
		);
		expect(expandButton).toBeInstanceOf(HTMLButtonElement);
		if (!(expandButton instanceof HTMLButtonElement)) {
			throw new Error("Expected an expand diff button.");
		}

		await act(async () => {
			expandButton.click();
		});

		expect(requireDetailDiffFileTreePanel(container).style.flex).toBe(
			"0 0 18%",
		);
	});

	it("shows Save Plan only when plan mode review has ExitPlanMode plan text", async () => {
		const selection = createSelection();
		selection.card.startInPlanMode = true;
		const onSavePlan = vi.fn();
		mockSavePlan.mockResolvedValue({
			id: "plan-1",
			name: "Task-task-1-1",
			path: "/tmp/plan.md",
			addedAt: 1,
			missing: false,
		});

		await act(async () => {
			root.render(
				<CardDetailView
					selection={selection}
					currentProjectId="workspace-1"
					sessionSummary={{
						taskId: "task-1",
						state: "awaiting_review",
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
						reviewReason: "hook",
						exitCode: null,
						lastHookAt: 1,
						latestHookActivity: {
							activityText: "Waiting for approval",
							toolName: "ExitPlanMode",
							toolInputSummary: null,
							finalMessage: null,
							hookEventName: "PermissionRequest",
							notificationType: "permission_prompt",
							source: "claude",
							planText: "# Captured\n\nDo the work.",
						},
						latestTurnCheckpoint: null,
						previousTurnCheckpoint: null,
					}}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					onSavePlan={onSavePlan}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		expect(
			container.querySelector('[data-testid="save-plan-panel"]'),
		).not.toBeNull();
		const saveButton = container.querySelector(
			'[data-testid="save-plan-button"]',
		);
		expect(saveButton).toBeInstanceOf(HTMLButtonElement);
		expect(saveButton?.textContent).toContain("Save Plan");
		expect(
			container.querySelector('[data-testid="plan-markdown-preview"]')
				?.textContent,
		).toContain("# Captured");

		await act(async () => {
			(saveButton as HTMLButtonElement).click();
		});

		expect(mockSavePlan).toHaveBeenCalledWith({
			name: "Task task-1",
			content: "# Captured\n\nDo the work.",
		});
		expect(onSavePlan).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "plan-1",
			}),
		);
		expect(mockTrackPlanSaved).toHaveBeenCalled();
		expect(mockShowAppToast).toHaveBeenCalledWith(
			expect.objectContaining({
				intent: "success",
			}),
		);
	});

	it("does not show Save Plan without plan mode ExitPlanMode text", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					sessionSummary={{
						taskId: "task-1",
						state: "awaiting_review",
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
						reviewReason: "hook",
						exitCode: null,
						lastHookAt: 1,
						latestHookActivity: {
							activityText: "Waiting for approval",
							toolName: "Bash",
							toolInputSummary: null,
							finalMessage: null,
							hookEventName: "PermissionRequest",
							notificationType: "permission_prompt",
							source: "claude",
							planText: null,
						},
						latestTurnCheckpoint: null,
						previousTurnCheckpoint: null,
					}}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		expect(
			container.querySelector('[data-testid="save-plan-panel"]'),
		).toBeNull();
	});

	it("shows the resume-ended-session strip only when the session is paused offline, and calls onRestartTaskSession with the card id", async () => {
		const onRestartTaskSession = vi.fn();

		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					sessionSummary={createSessionSummary({ pausedAt: 100, pid: null })}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
					onRestartTaskSession={onRestartTaskSession}
				/>,
			);
		});

		const strip = container.querySelector(
			'[data-testid="resume-ended-session-strip"]',
		);
		expect(strip).not.toBeNull();
		expect(strip?.textContent).toContain(
			"Paused — session ended when the app closed",
		);

		const resumeButton = container.querySelector(
			'[data-testid="resume-ended-session"]',
		);
		expect(resumeButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			resumeButton?.dispatchEvent(
				new MouseEvent("mousedown", { bubbles: true }),
			);
			(resumeButton as HTMLButtonElement).click();
		});

		expect(onRestartTaskSession).toHaveBeenCalledWith("task-1");
	});

	it("does not show the resume-ended-session strip for a live (non-paused-offline) session", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					sessionSummary={createSessionSummary({ state: "running" })}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		expect(
			container.querySelector('[data-testid="resume-ended-session-strip"]'),
		).toBeNull();
	});

	it("does not show the resume-ended-session strip for a paused-but-live session (pid still set)", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					sessionSummary={createSessionSummary({ pausedAt: 100, pid: 4242 })}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		expect(
			container.querySelector('[data-testid="resume-ended-session-strip"]'),
		).toBeNull();
	});

	it("still supports the existing account-mismatch restart button under its renamed onRestartTaskSession prop", async () => {
		const onRestartTaskSession = vi.fn();
		const selection = createSelection();
		selection.card.agentId = "claude";
		selection.card.managerAccountId = 1;

		await act(async () => {
			root.render(
				<CardDetailView
					selection={selection}
					currentProjectId="workspace-1"
					sessionSummary={createSessionSummary({
						state: "running",
						managerAccountId: 2,
					})}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
					managerAccounts={[createManagerAccount(1), createManagerAccount(2)]}
					onTaskManagerAccountChanged={() => {}}
					onRestartTaskSession={onRestartTaskSession}
					restartTaskLoadingById={{}}
				/>,
			);
		});

		// The "Task configuration" section auto-expands when an account-mismatch
		// restart is available, so the button is visible without manual expansion.
		const configToggle = container.querySelector(
			'[data-testid="task-config-toggle"]',
		);
		expect(configToggle?.getAttribute("aria-expanded")).toBe("true");

		const restartButton = container.querySelector(
			'[data-testid="restart-task-with-account"]',
		);
		expect(restartButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			(restartButton as HTMLButtonElement).click();
		});

		expect(onRestartTaskSession).toHaveBeenCalledWith("task-1");
	});

	it("opens Task configuration for a card that has not run yet", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					// App never passes null here: an unstarted card gets a placeholder idle
					// summary, which is what used to leave the section collapsed.
					sessionSummary={createSessionSummary({
						state: "idle",
						startedAt: null,
					})}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});

		expect(
			container
				.querySelector('[data-testid="task-config-toggle"]')
				?.getAttribute("aria-expanded"),
		).toBe("true");
	});

	it("offers a restart when the card's subagent seat drifted from the running session", async () => {
		const onRestartTaskSession = vi.fn();
		const selection = createSelection();
		selection.card.taskLaunchSettings = {
			subagentSeatProviderId: "openrouter",
		};

		await act(async () => {
			root.render(
				<CardDetailView
					selection={selection}
					currentProjectId="workspace-1"
					sessionSummary={createSessionSummary({
						state: "running",
						subagentSeatProviderId: null,
					})}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
					managerAccounts={[createManagerAccount(1)]}
					onTaskManagerAccountChanged={() => {}}
					onTaskLaunchSettingsChanged={() => {}}
					onRestartTaskSession={onRestartTaskSession}
					restartTaskLoadingById={{}}
				/>,
			);
		});

		const restartButton = container.querySelector(
			'[data-testid="restart-task-with-account"]',
		);
		expect(restartButton?.textContent).toBe(
			"Restart to apply the subagent seat",
		);

		await act(async () => {
			(restartButton as HTMLButtonElement).click();
		});
		expect(onRestartTaskSession).toHaveBeenCalledWith("task-1");
	});

	it("keeps a generic restart available when the running session already matches the card's subagent seat", async () => {
		const selection = createSelection();
		selection.card.taskLaunchSettings = {
			subagentSeatProviderId: "openrouter",
		};

		await act(async () => {
			root.render(
				<CardDetailView
					selection={selection}
					currentProjectId="workspace-1"
					sessionSummary={createSessionSummary({
						state: "running",
						subagentSeatProviderId: "openrouter",
					})}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
					managerAccounts={[createManagerAccount(1)]}
					onTaskManagerAccountChanged={() => {}}
					onTaskLaunchSettingsChanged={() => {}}
					onRestartTaskSession={() => {}}
					restartTaskLoadingById={{}}
				/>,
			);
		});

		// Nothing drifted, so the section stays collapsed until the user opens it.
		await act(async () => {
			(
				container.querySelector(
					'[data-testid="task-config-toggle"]',
				) as HTMLButtonElement
			).click();
		});

		expect(
			container.querySelector('[data-testid="restart-task-with-account"]')
				?.textContent,
		).toBe("Restart session");
	});

	it("hides the config restart control for a session that is not live", async () => {
		await act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					sessionSummary={createSessionSummary({
						state: "idle",
						startedAt: null,
					})}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
					managerAccounts={[createManagerAccount(1)]}
					onTaskManagerAccountChanged={() => {}}
					onTaskLaunchSettingsChanged={() => {}}
					onRestartTaskSession={() => {}}
					restartTaskLoadingById={{}}
				/>,
			);
		});

		expect(
			container.querySelector('[data-testid="task-config-restart-strip"]'),
		).toBeNull();
	});

	function renderDetail() {
		return act(async () => {
			root.render(
				<CardDetailView
					selection={createSelection()}
					currentProjectId="workspace-1"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});
	}

	function findTabByLabel(label: string): HTMLButtonElement | null {
		return (
			Array.from(container.querySelectorAll("button")).find(
				(button) => button.textContent?.trim() === label,
			) ?? null
		);
	}

	it("omits the DevTools tab when the stack dashboard is unavailable", async () => {
		mockDevtoolsUrl.current = null;
		await renderDetail();

		// All Changes / Last Turn must still be there — an absent sandbox should not
		// disturb the existing toolbar.
		expect(findTabByLabel("All Changes")).toBeInstanceOf(HTMLButtonElement);
		expect(findTabByLabel("Last Turn")).toBeInstanceOf(HTMLButtonElement);
		expect(findTabByLabel("DevTools")).toBeNull();
		expect(
			container.querySelector('[data-testid="detail-devtools-frame"]'),
		).toBeNull();
	});

	it("shows a DevTools tab beside All Changes / Last Turn that swaps in the dashboard", async () => {
		mockDevtoolsUrl.current = "http://127.0.0.1:3001/";
		await renderDetail();

		const devtoolsTab = findTabByLabel("DevTools");
		expect(devtoolsTab).toBeInstanceOf(HTMLButtonElement);
		// Not shown until selected: the diff stays the default view.
		expect(
			container.querySelector('[data-testid="detail-devtools-frame"]'),
		).toBeNull();

		await act(async () => {
			(devtoolsTab as HTMLButtonElement).click();
		});

		const frame = container.querySelector(
			'[data-testid="detail-devtools-frame"]',
		);
		expect(frame).toBeInstanceOf(HTMLIFrameElement);
		expect((frame as HTMLIFrameElement).getAttribute("src")).toBe(
			"http://127.0.0.1:3001/",
		);
	});

	it("falls back to the diff when the dashboard goes away while its tab is open", async () => {
		mockDevtoolsUrl.current = "http://127.0.0.1:3001/";
		await renderDetail();
		await act(async () => {
			(findTabByLabel("DevTools") as HTMLButtonElement).click();
		});
		expect(
			container.querySelector('[data-testid="detail-devtools-frame"]'),
		).toBeInstanceOf(HTMLIFrameElement);

		// Daemon stops: the tab disappears and the panel must not keep a dead iframe.
		mockDevtoolsUrl.current = null;
		await renderDetail();

		expect(findTabByLabel("DevTools")).toBeNull();
		expect(
			container.querySelector('[data-testid="detail-devtools-frame"]'),
		).toBeNull();
		expect(findTabByLabel("All Changes")).toBeInstanceOf(HTMLButtonElement);
	});
});
