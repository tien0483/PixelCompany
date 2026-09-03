import type { ReactElement, ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskCreateDialog } from "@/components/task-create-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@runtime-agent-catalog", () => ({
	getRuntimeLaunchSupportedAgentCatalog: vi.fn(() => [
		{ id: "gemini", label: "Antigravity CLI", binary: "agy" },
		{ id: "claude", label: "Claude Code", binary: "claude" },
		{ id: "cursor", label: "Cursor Agent", binary: "agent" },
	]),
}));

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		runtime: {
			listAgentModels: {
				query: vi.fn().mockResolvedValue({ models: [] }),
			},
			listSkillInventory: {
				query: vi.fn().mockResolvedValue({ skills: [], agents: [], commands: [], workflows: [] }),
			},
			listMcpInventory: {
				query: vi.fn().mockResolvedValue({ servers: [] }),
			},
			claudeOrgMcpPolicy: {
				query: vi.fn().mockResolvedValue(null),
			},
			listClineApiSeats: {
				query: vi.fn().mockResolvedValue({ seats: [] }),
			},
		},
	}),
}));

let container: HTMLDivElement;
let root: Root;

function renderUi(element: ReactElement | ReactNode): void {
	root.render(<TooltipProvider>{element}</TooltipProvider>);
}

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
	container.remove();
	document.body.innerHTML = "";
	vi.clearAllMocks();
});

describe("TaskCreateDialog Teamwork preview", () => {
	it("renders Teamwork preview checkbox for Gemini / Antigravity agent", async () => {
		const onLaunchSettingsChange = vi.fn();
		await act(async () => {
			renderUi(
				<TaskCreateDialog
					open
					onOpenChange={vi.fn()}
					prompt="Sample task"
					onPromptChange={vi.fn()}
					images={[]}
					onImagesChange={vi.fn()}
					onCreate={vi.fn()}
					onCreateMultiple={vi.fn()}
					startInPlanMode={false}
					onStartInPlanModeChange={vi.fn()}
					autoRunDelayMinutes={0}
					onAutoRunDelayMinutesChange={vi.fn()}
					workspaceId="proj-1"
					branchRef="main"
					branchOptions={[{ value: "main", label: "main" }]}
					onBranchRefChange={vi.fn()}
					agentId="gemini"
					taskLaunchSettings={undefined}
					onTaskLaunchSettingsChange={onLaunchSettingsChange}
				/>,
			);
		});
		await act(async () => {
			await Promise.resolve();
		});

		const teamworkCheckbox = document.querySelector('[data-testid="task-launch-teamwork-preview"]');
		expect(teamworkCheckbox).toBeTruthy();
		expect(teamworkCheckbox?.textContent).toContain("Teamwork preview");

		const checkboxInput = teamworkCheckbox?.querySelector("button, input");
		expect(checkboxInput).toBeTruthy();

		await act(async () => {
			checkboxInput!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(onLaunchSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ teamworkPreview: true }));
	});

	it("hides Teamwork preview checkbox when agent is Claude", async () => {
		const onLaunchSettingsChange = vi.fn();
		await act(async () => {
			renderUi(
				<TaskCreateDialog
					open
					onOpenChange={vi.fn()}
					prompt="Sample task"
					onPromptChange={vi.fn()}
					images={[]}
					onImagesChange={vi.fn()}
					onCreate={vi.fn()}
					onCreateMultiple={vi.fn()}
					startInPlanMode={false}
					onStartInPlanModeChange={vi.fn()}
					autoRunDelayMinutes={0}
					onAutoRunDelayMinutesChange={vi.fn()}
					workspaceId="proj-1"
					branchRef="main"
					branchOptions={[{ value: "main", label: "main" }]}
					onBranchRefChange={vi.fn()}
					agentId="claude"
					taskLaunchSettings={undefined}
					onTaskLaunchSettingsChange={onLaunchSettingsChange}
				/>,
			);
		});
		await act(async () => {
			await Promise.resolve();
		});

		const teamworkCheckbox = document.querySelector('[data-testid="task-launch-teamwork-preview"]');
		expect(teamworkCheckbox).toBeNull();
	});
});
