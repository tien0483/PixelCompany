import { KANBAN_TASK_WORKTREES_DISPLAY_ROOT } from "@runtime-task-worktree-path";
import type { ReactNode } from "react";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardCard } from "@/components/board-card";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import type { ReviewTaskWorkspaceSnapshot } from "@/types";

let mockWorkspaceSnapshot: ReviewTaskWorkspaceSnapshot | undefined;
let mockMeasureWidths = [240, 240, 240];
let mockMeasureCallCount = 0;

vi.mock("@hello-pangea/dnd", () => ({
	Draggable: ({
		children,
	}: {
		children: (
			provided: {
				innerRef: (element: HTMLDivElement | null) => void;
				draggableProps: object;
				dragHandleProps: object;
			},
			snapshot: { isDragging: boolean },
		) => ReactNode;
	}): React.ReactElement => (
		<>
			{children(
				{ innerRef: () => {}, draggableProps: {}, dragHandleProps: {} },
				{ isDragging: false },
			)}
		</>
	),
}));

vi.mock("@/stores/workspace-metadata-store", () => ({
	useTaskWorkspaceSnapshotValue: () => mockWorkspaceSnapshot,
	useTaskWorkspaceInfoValue: () => null,
}));

vi.mock("@/utils/react-use", () => ({
	useMedia: () => false,
	useInterval: () => {},
	useMeasure: () => {
		mockMeasureCallCount += 1;
		const width =
			mockMeasureWidths[
				(mockMeasureCallCount - 1) % mockMeasureWidths.length
			] ?? 240;
		return [
			() => {},
			{
				width,
				height: 0,
				top: 0,
				left: 0,
				bottom: 0,
				right: 0,
				x: 0,
				y: 0,
				toJSON: () => ({}),
			},
		];
	},
}));

vi.mock("@/utils/text-measure", () => ({
	DEFAULT_TEXT_MEASURE_FONT: "400 14px sans-serif",
	measureTextWidth: (value: string) => value.length * 8,
	readElementFontShorthand: () => "400 14px sans-serif",
}));

vi.mock("@/utils/task-prompt", async () => {
	const actual = await vi.importActual<typeof import("@/utils/task-prompt")>(
		"@/utils/task-prompt",
	);
	return {
		...actual,
		truncateTaskPromptLabel: (prompt: string) =>
			prompt.split("||")[0]?.trim() ?? "",
		normalizePromptForDisplay: (value: string) =>
			value.split("||")[0]?.trim() ?? value.trim(),
		getTaskPromptDescription: (prompt: string, title: string) => {
			const normalized = prompt.trim();
			if (!normalized.startsWith(title)) {
				return normalized;
			}
			return normalized.slice(title.length).replace(/^\|\|/, "").trim();
		},
	};
});

function createCard(
	overrides?: Partial<Parameters<typeof BoardCard>[0]["card"]>,
) {
	return {
		id: "task-1",
		title: "Review API changes",
		prompt: "Review API changes",
		startInPlanMode: false,
		autoReviewEnabled: false,
		autoReviewMode: "commit" as const,
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

function createSummary(
	state: RuntimeTaskSessionSummary["state"],
	overrides?: Partial<RuntimeTaskSessionSummary>,
): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state,
		agentId: "cline",
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

function Harness(): React.ReactElement {
	const [card, setCard] = useState(
		createCard({
			autoReviewEnabled: true,
			autoReviewMode: "pr",
		}),
	);

	return (
		<BoardCard
			card={card}
			index={0}
			columnId="backlog"
			onCancelAutomaticAction={() => {
				setCard((currentCard) => ({
					...currentCard,
					autoReviewEnabled: false,
				}));
			}}
		/>
	);
}

describe("BoardCard", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		mockWorkspaceSnapshot = undefined;
		mockMeasureWidths = [240, 240, 240];
		mockMeasureCallCount = 0;
		previousActEnvironment = (
			globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT;
		(
			globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
			() => ({
				x: 0,
				y: 0,
				left: 0,
				top: 0,
				width: 240,
				height: 32,
				right: 240,
				bottom: 32,
				toJSON: () => ({}),
			}),
		);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
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

	it("shows a mode-specific cancel button and hides it after canceling auto review", async () => {
		await act(async () => {
			root.render(<Harness />);
		});

		const cancelButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Cancel Auto-PR",
		);
		expect(cancelButton).toBeDefined();

		await act(async () => {
			cancelButton?.dispatchEvent(
				new MouseEvent("mousedown", { bubbles: true }),
			);
			cancelButton?.click();
		});

		const nextCancelButton = Array.from(
			container.querySelectorAll("button"),
		).find((button) => button.textContent?.includes("Cancel Auto-"));
		expect(nextCancelButton).toBeUndefined();
	});

	it("shows a loading state on the review done button while moving to done", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="review"
					isMoveToTrashLoading
				/>,
			);
		});

		const trashButton = container.querySelector(
			'button[aria-label="Move task to done"]',
		);
		expect(trashButton).toBeInstanceOf(HTMLButtonElement);
		expect((trashButton as HTMLButtonElement | null)?.disabled).toBe(true);
		expect(trashButton?.querySelector("svg.animate-spin")).toBeTruthy();
	});

	it("shows inline see more and less controls for long descriptions", async () => {
		const description =
			"Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau final hidden segment";

		await act(async () => {
			root.render(
				<BoardCard
					card={createCard({ prompt: `Task title||${description}` })}
					index={0}
					columnId="backlog"
				/>,
			);
		});

		const findButton = (label: string) =>
			Array.from(container.querySelectorAll("button")).find(
				(button) => button.textContent?.trim() === label,
			);

		const seeMoreButton = findButton("See more");
		expect(seeMoreButton).toBeDefined();
		expect(container.textContent).not.toContain("final hidden segment");

		await act(async () => {
			seeMoreButton?.dispatchEvent(
				new MouseEvent("mousedown", { bubbles: true }),
			);
			seeMoreButton?.click();
		});

		expect(findButton("See more")).toBeUndefined();
		expect(findButton("Less")).toBeDefined();
		expect(container.textContent).toContain(description);

		const lessButton = findButton("Less");
		await act(async () => {
			lessButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			lessButton?.click();
		});

		expect(findButton("See more")).toBeDefined();
		expect(container.textContent).not.toContain("final hidden segment");
	});

	it("reconstructs and shows trashed worktree path when workspace metadata is not tracked", async () => {
		await act(async () => {
			root.render(
				<TooltipProvider>
					<BoardCard
						card={createCard({ id: "trash-task-1" })}
						index={0}
						columnId="trash"
						workspacePath="/Users/alice/projects/kanban"
					/>
				</TooltipProvider>,
			);
		});

		// Derived from the shared constant so a future home-directory rename does not
		// need this assertion edited again.
		expect(container.textContent).toContain(
			`${KANBAN_TASK_WORKTREES_DISPLAY_ROOT}/trash-task-1/kanban`,
		);
	});

	it("shows formatted agent override details with model name and reasoning effort", async () => {
		mockWorkspaceSnapshot = {
			taskId: "task-1",
			path: "/tmp/worktrees/task-1",
			branch: "feature/override",
			isDetached: false,
			headCommit: "1234567890abcdef",
			changedFiles: 2,
			additions: 5,
			deletions: 1,
			aheadOfBaseCount: null,
		};

		await act(async () => {
			root.render(
				<BoardCard
					card={createCard({
						agentId: "cline",
						clineSettings: {
							modelId: "openai/gpt-5.5",
							reasoningEffort: "low",
						},
					})}
					index={0}
					columnId="review"
				/>,
			);
		});

		expect(container.textContent).toContain("Cline");
		expect(container.textContent).toContain("GPT-5.5 (Low)");
		expect(container.textContent).not.toContain("openai/gpt-5.5");
	});

	it("shows the task-level indicator for reasoning-only overrides", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard({
						clineSettings: {
							reasoningEffort: "low",
						},
					})}
					index={0}
					columnId="backlog"
					defaultClineModelId="openai/gpt-5.5"
				/>,
			);
		});

		expect(container.textContent).toContain("GPT-5.5 (Low)");
	});

	it("shows a fallback indicator for reasoning-only overrides without a resolved default model", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard({
						clineSettings: {
							reasoningEffort: "low",
						},
					})}
					index={0}
					columnId="backlog"
				/>,
			);
		});

		expect(container.textContent).toContain("Default model (Low)");
	});

	it("shows explicit default reasoning metadata for reasoning-only task overrides", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard({
						agentId: "cline",
						clineSettings: {},
					})}
					index={0}
					columnId="backlog"
					defaultClineModelId="openai/gpt-5.5"
				/>,
			);
		});

		expect(container.textContent).toContain("GPT-5.5 (Default)");
		expect(container.textContent).not.toContain("GPT-5.5 (High)");
	});

	it("does not mislabel provider-only overrides as the global default model", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard({
						clineSettings: {
							providerId: "groq",
						},
					})}
					index={0}
					columnId="backlog"
					defaultClineModelId="openai/gpt-5.5"
				/>,
			);
		});

		expect(container.textContent).toContain("Provider: groq");
		expect(container.textContent).not.toContain("GPT-5.5");
	});

	it("does not show inherited global reasoning for explicit model overrides using default effort", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard({
						agentId: "cline",
						clineSettings: {
							modelId: "openai/gpt-5.5",
						},
					})}
					index={0}
					columnId="backlog"
				/>,
			);
		});

		expect(container.textContent).toContain("GPT-5.5");
		expect(container.textContent).not.toContain("GPT-5.5 (High)");
	});

	it("shows tool input details in the session preview text", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={{
						taskId: "task-1",
						state: "running",
						agentId: "cline",
						workspacePath: "/tmp/worktree",
						pid: null,
						startedAt: Date.now(),
						activeRunMs: 0,
						runningSince: null,
						pausedAt: null,
						pauseReason: null,
						updatedAt: Date.now(),
						lastOutputAt: Date.now(),
						reviewReason: null,
						exitCode: null,
						lastHookAt: Date.now(),
						latestHookActivity: {
							activityText: "Using Read",
							toolName: "Read",
							toolInputSummary: "src/index.ts",
							finalMessage: null,
							hookEventName: "tool_call",
							notificationType: null,
							source: "cline-sdk",
							planText: null,
						},
						latestTurnCheckpoint: null,
						previousTurnCheckpoint: null,
					}}
				/>,
			);
		});

		expect(container.textContent).toContain("Read(src/index.ts)");
		expect(container.textContent).not.toContain("Using Read");
	});

	it("shows non-cline tool activity in the compact tool label format", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("running", {
						agentId: "claude",
						latestHookActivity: {
							activityText: "Completed Read: src/index.ts",
							toolName: "Read",
							toolInputSummary: null,
							finalMessage: null,
							hookEventName: "tool_result",
							notificationType: null,
							source: "claude",
							planText: null,
						},
					})}
				/>,
			);
		});

		expect(container.textContent).toContain("Read(src/index.ts)");
		expect(container.textContent).not.toContain("Completed Read");
	});

	it("keeps canonical tool names in the session preview label", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("running", {
						agentId: "kiro",
						latestHookActivity: {
							activityText: "Using fs_write: src/index.ts",
							toolName: "fs_write",
							toolInputSummary: null,
							finalMessage: null,
							hookEventName: "preToolUse",
							notificationType: null,
							source: "kiro",
							planText: null,
						},
					})}
				/>,
			);
		});

		expect(container.textContent).toContain("fs_write(src/index.ts)");
	});

	it("parses codex tool activity into the compact tool label format", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("running", {
						agentId: "codex",
						latestHookActivity: {
							activityText: "Calling Read: src/index.ts",
							toolName: null,
							toolInputSummary: null,
							finalMessage: null,
							hookEventName: "raw_response_item",
							notificationType: null,
							source: "codex",
							planText: null,
						},
					})}
				/>,
			);
		});

		expect(container.textContent).toContain("Read(src/index.ts)");
		expect(container.textContent).not.toContain("Calling Read");
	});

	it("does not show a stale bare tool name for non-tool review updates", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="review"
					sessionSummary={createSummary("awaiting_review", {
						agentId: "kiro",
						latestHookActivity: {
							activityText: "Waiting for review",
							toolName: "fs_write",
							toolInputSummary: null,
							finalMessage: null,
							hookEventName: "stop",
							notificationType: null,
							source: "kiro",
							planText: null,
						},
					})}
				/>,
			);
		});

		expect(container.textContent).toContain("Waiting for review");
		expect(container.textContent).not.toContain("fs_write");
	});

	it("keeps showing the last cline tool label during assistant streaming", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={{
						taskId: "task-1",
						state: "running",
						agentId: "cline",
						workspacePath: "/tmp/worktree",
						pid: null,
						startedAt: Date.now(),
						activeRunMs: 0,
						runningSince: null,
						pausedAt: null,
						pauseReason: null,
						updatedAt: Date.now(),
						lastOutputAt: Date.now(),
						reviewReason: null,
						exitCode: null,
						lastHookAt: Date.now(),
						latestHookActivity: {
							activityText: "Agent active",
							toolName: "Read",
							toolInputSummary: "src/index.ts",
							finalMessage: "Looking at the file now",
							hookEventName: "assistant_delta",
							notificationType: null,
							source: "cline-sdk",
							planText: null,
						},
						latestTurnCheckpoint: null,
						previousTurnCheckpoint: null,
					}}
				/>,
			);
		});

		expect(container.textContent).toContain("Read(src/index.ts)");
		expect(container.textContent).not.toContain("Thinking...");
	});

	it("renders a new card description before the async measure observer reports width", async () => {
		mockMeasureWidths = [0, 0, 0];

		await act(async () => {
			root.render(
				<BoardCard
					card={createCard({
						prompt: "Task title||Freshly created task description",
					})}
					index={0}
					columnId="backlog"
				/>,
			);
		});

		expect(container.textContent).toContain("Freshly created task description");
	});

	it("renders session activity as single-line truncated text on trash cards", async () => {
		const preview =
			"Reviewing the archived implementation details and collecting the final notes for the handoff before cleanup hidden tail";

		await act(async () => {
			root.render(
				<TooltipProvider>
					<BoardCard
						card={createCard()}
						index={0}
						columnId="trash"
						sessionSummary={createSummary("awaiting_review", {
							latestHookActivity: {
								activityText: null,
								toolName: null,
								toolInputSummary: null,
								finalMessage: preview,
								hookEventName: "assistant_delta",
								notificationType: null,
								source: "cline-sdk",
								planText: null,
							},
						})}
					/>
				</TooltipProvider>,
			);
		});

		const findButton = (label: string) =>
			Array.from(container.querySelectorAll("button")).find(
				(button) => button.textContent?.trim() === label,
			);

		// Session activity uses CSS truncation with no See more / Less buttons
		expect(findButton("See more")).toBeUndefined();
		expect(findButton("Less")).toBeUndefined();

		// The full text is in the DOM (CSS handles visual truncation)
		expect(container.textContent).toContain(preview);
	});

	it("renders session activity as single-line truncated text for running tasks", async () => {
		const preview =
			"Reviewing the archived implementation details and collecting the final notes for the handoff before cleanup hidden tail";

		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("running", {
						latestHookActivity: {
							activityText: null,
							toolName: null,
							toolInputSummary: null,
							finalMessage: preview,
							hookEventName: "assistant_delta",
							notificationType: null,
							source: "cline-sdk",
							planText: null,
						},
					})}
				/>,
			);
		});

		const findButton = (label: string) =>
			Array.from(container.querySelectorAll("button")).find(
				(button) => button.textContent?.trim() === label,
			);

		// Session activity uses CSS truncation with no See more / Less buttons
		expect(findButton("See more")).toBeUndefined();
		expect(findButton("Less")).toBeUndefined();

		// The full text is in the DOM (CSS handles visual truncation)
		expect(container.textContent).toContain(preview);
	});

	it("shows the latest assistant preview on active task cards", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("running", {
						latestHookActivity: {
							activityText: "Reviewing the final diff",
							toolName: null,
							toolInputSummary: null,
							finalMessage: "Reviewing the final diff",
							hookEventName: "assistant_delta",
							notificationType: null,
							source: "cline-sdk",
							planText: null,
						},
					})}
				/>,
			);
		});

		expect(container.textContent).toContain("Reviewing the final diff");
		expect(container.textContent).not.toContain("Thinking...");
	});

	it("shows a red failure indicator for a review card whose session ended in an error", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="review"
					sessionSummary={createSummary("awaiting_review", {
						reviewReason: "error",
						warningMessage: "Unknown agent error",
						latestHookActivity: {
							activityText: "Agent error: boom",
							toolName: null,
							toolInputSummary: null,
							finalMessage: "boom",
							hookEventName: "agent_error",
							notificationType: null,
							source: "cline-sdk",
							planText: null,
						},
					})}
				/>,
			);
		});

		const dot = container.querySelector(".rounded-full") as HTMLElement | null;
		expect(dot).not.toBeNull();
		expect(dot?.style.backgroundColor).toBe("var(--color-status-red)");
		expect(container.textContent).toContain("boom");
	});

	it("shows a red failure indicator when a failed session carries a final assistant message", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("failed", {
						latestHookActivity: {
							activityText: null,
							toolName: null,
							toolInputSummary: null,
							finalMessage: "Provider connection lost",
							hookEventName: "agent_end",
							notificationType: null,
							source: "cline-sdk",
							planText: null,
						},
					})}
				/>,
			);
		});

		const dot = container.querySelector(".rounded-full") as HTMLElement | null;
		expect(dot).not.toBeNull();
		expect(dot?.style.backgroundColor).toBe("var(--color-status-red)");
		expect(container.textContent).toContain("Provider connection lost");
	});

	it.each([
		["cap_reached", "Retry limit reached — switch seats manually"],
		["no_healthy_seat", "No other healthy seat available"],
		["seat_prep_failed", "Couldn't prepare the new seat's credentials"],
		["restart_failed", "Restart failed: spawn ENOENT"],
	] as const)("shows the auth-failover outcome label for %s", async (outcome, expectedText) => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="review"
					sessionSummary={createSummary("awaiting_review", {
						reviewReason: "error",
						warningMessage: "Claude Code needs login. Open the task terminal and run /login.",
						authFailoverOutcome: outcome,
						authFailoverOutcomeDetail: outcome === "restart_failed" ? "spawn ENOENT" : null,
					})}
				/>,
			);
		});

		const dot = container.querySelector(".rounded-full") as HTMLElement | null;
		expect(dot).not.toBeNull();
		expect(dot?.style.backgroundColor).toBe("var(--color-status-red)");
		expect(container.textContent).toContain(expectedText);
	});

	it("prefers the auth-failover outcome label over the warning message when both are set", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="review"
					sessionSummary={createSummary("awaiting_review", {
						reviewReason: "error",
						warningMessage: "Claude Code needs login. Open the task terminal and run /login.",
						authFailoverOutcome: "no_healthy_seat",
					})}
				/>,
			);
		});

		expect(container.textContent).toContain("No other healthy seat available");
		expect(container.textContent).not.toContain("Claude Code needs login");
	});

	it("falls back to the warning message when no auth-failover outcome is set", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="review"
					sessionSummary={createSummary("awaiting_review", {
						reviewReason: "error",
						warningMessage: "Claude Code needs login. Open the task terminal and run /login.",
					})}
				/>,
			);
		});

		expect(container.textContent).toContain("Claude Code needs login");
	});

	it("keeps the green success indicator for a clean review card", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="review"
					sessionSummary={createSummary("awaiting_review", {
						latestHookActivity: {
							activityText: null,
							toolName: null,
							toolInputSummary: null,
							finalMessage: "Ready for review",
							hookEventName: "assistant_delta",
							notificationType: null,
							source: "cline-sdk",
							planText: null,
						},
					})}
				/>,
			);
		});

		const dot = container.querySelector(".rounded-full") as HTMLElement | null;
		expect(dot).not.toBeNull();
		expect(dot?.style.backgroundColor).toBe("var(--color-status-green)");
		expect(container.textContent).toContain("Ready for review");
	});

	it("shows normal agent messages without the agent prefix", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("running", {
						agentId: "codex",
						latestHookActivity: {
							activityText: "Agent: checking the next file",
							toolName: null,
							toolInputSummary: null,
							finalMessage: null,
							hookEventName: "agent_message",
							notificationType: null,
							source: "codex",
							planText: null,
						},
					})}
				/>,
			);
		});

		expect(container.textContent).toContain("checking the next file");
		expect(container.textContent).not.toContain("Agent:");
	});

	it("shows Plan ready for review when ExitPlanMode plan text is present", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard({ startInPlanMode: true })}
					index={0}
					columnId="review"
					sessionSummary={createSummary("awaiting_review", {
						agentId: "claude",
						latestHookActivity: {
							activityText: "Waiting for approval",
							toolName: "ExitPlanMode",
							toolInputSummary: null,
							finalMessage: null,
							hookEventName: "PermissionRequest",
							notificationType: "permission_prompt",
							source: "claude",
							planText: "# Ready plan\n",
						},
					})}
				/>,
			);
		});

		expect(container.textContent).toContain("Plan ready for review");
		expect(container.textContent).not.toContain("Waiting for approval");
	});

	it("shows the offline-paused badge in the orange status color and routes the play button to onResumeEndedSession", async () => {
		const onResume = vi.fn();
		const onResumeEndedSession = vi.fn();
		const onPause = vi.fn();

		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("interrupted", { agentId: "codex", pausedAt: 100, pid: null })}
					onResume={onResume}
					onResumeEndedSession={onResumeEndedSession}
					onPause={onPause}
				/>,
			);
		});

		expect(container.textContent).toContain("Paused — session ended");
		const badge = Array.from(container.querySelectorAll("span")).find((span) =>
			span.textContent?.includes("Paused — session ended"),
		);
		expect(badge).toBeDefined();
		expect(badge?.className).toContain("text-status-orange");

		const playButton = container.querySelector('button[aria-label="Resume task"]');
		expect(playButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			playButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			(playButton as HTMLButtonElement).click();
		});

		expect(onResumeEndedSession).toHaveBeenCalledWith("task-1");
		expect(onResume).not.toHaveBeenCalled();
		expect(onPause).not.toHaveBeenCalled();
	});

	it("routes the play button to the existing onResumeTask behavior when the session is paused but still live", async () => {
		const onResume = vi.fn();
		const onResumeEndedSession = vi.fn();
		const onPause = vi.fn();

		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("interrupted", { pausedAt: 100, pid: 4242 })}
					onResume={onResume}
					onResumeEndedSession={onResumeEndedSession}
					onPause={onPause}
				/>,
			);
		});

		expect(container.textContent).not.toContain("session ended");

		const playButton = container.querySelector('button[aria-label="Resume task"]');
		expect(playButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			playButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			(playButton as HTMLButtonElement).click();
		});

		expect(onResume).toHaveBeenCalledWith("task-1");
		expect(onResumeEndedSession).not.toHaveBeenCalled();
		expect(onPause).not.toHaveBeenCalled();
	});

	it("still routes the play button to onPause when the session is not paused", async () => {
		const onResume = vi.fn();
		const onResumeEndedSession = vi.fn();
		const onPause = vi.fn();

		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("running")}
					onResume={onResume}
					onResumeEndedSession={onResumeEndedSession}
					onPause={onPause}
				/>,
			);
		});

		const playButton = container.querySelector('button[aria-label="Pause task"]');
		expect(playButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			playButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			(playButton as HTMLButtonElement).click();
		});

		expect(onPause).toHaveBeenCalledWith("task-1");
		expect(onResume).not.toHaveBeenCalled();
		expect(onResumeEndedSession).not.toHaveBeenCalled();
	});

	describe("commit counter and git actions", () => {
		function setSnapshot(
			overrides: Partial<ReviewTaskWorkspaceSnapshot>,
		): void {
			mockWorkspaceSnapshot = {
				taskId: "task-1",
				path: "/tmp/worktrees/task-1",
				branch: "kanban/task-1",
				isDetached: false,
				headCommit: "1234567890abcdef",
				changedFiles: 0,
				additions: 0,
				deletions: 0,
				aheadOfBaseCount: 0,
				...overrides,
			};
		}

		async function renderCard(columnId: "in_progress" | "review"): Promise<void> {
			await act(async () => {
				root.render(
					<TooltipProvider>
						<BoardCard
							card={createCard()}
							index={0}
							columnId={columnId}
							onCommit={() => {}}
							onMerge={() => {}}
						/>
					</TooltipProvider>,
				);
			});
		}

		const findButton = (label: string) =>
			Array.from(container.querySelectorAll("button")).find(
				(button) => button.textContent?.trim() === label,
			);

		it("offers only Merge and the counter once the work is committed", async () => {
			setSnapshot({ changedFiles: 0, aheadOfBaseCount: 3 });
			await renderCard("review");

			expect(container.textContent).toContain("3 commits");
			// The misleading "0 files +0 -0" must be gone, not merely accompanied.
			expect(container.textContent).not.toContain("0 files");
			expect(findButton("Commit")).toBeUndefined();
			expect(findButton("Merge to base")).toBeDefined();
		});

		it("still offers Commit while the worktree is dirty, and counts prior commits", async () => {
			setSnapshot({ changedFiles: 2, additions: 5, deletions: 1, aheadOfBaseCount: 1 });
			await renderCard("review");

			expect(container.textContent).toContain("2 files");
			expect(container.textContent).toContain("1 commit");
			expect(findButton("Commit")).toBeDefined();
			expect(findButton("Merge to base")).toBeDefined();
		});

		it("offers neither action when nothing has happened in the worktree", async () => {
			setSnapshot({ changedFiles: 0, aheadOfBaseCount: 0 });
			await renderCard("review");

			expect(container.textContent).not.toContain("commit");
			expect(findButton("Commit")).toBeUndefined();
			expect(findButton("Merge to base")).toBeUndefined();
		});

		it("counts commits on an in-progress card but does not offer Merge there", async () => {
			setSnapshot({ changedFiles: 0, aheadOfBaseCount: 2 });
			await renderCard("in_progress");

			expect(container.textContent).toContain("2 commits");
			expect(findButton("Merge to base")).toBeUndefined();
		});
	});
});
