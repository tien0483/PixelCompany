import { act } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskLaunchSettingsPicker } from "@/components/task-launch-settings";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { RuntimeTaskLaunchSettings } from "@/runtime/types";

const listSkillInventoryQuery = vi.hoisted(() => vi.fn());
const listMcpInventoryQuery = vi.hoisted(() => vi.fn());
const listAgentModelsQuery = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		runtime: {
			listSkillInventory: { query: listSkillInventoryQuery },
			listMcpInventory: { query: listMcpInventoryQuery },
			listAgentModels: { query: listAgentModelsQuery },
		},
	}),
}));

let container: HTMLDivElement;
let root: Root;

function renderUi(element: ReactElement): void {
	root.render(<TooltipProvider>{element}</TooltipProvider>);
}

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	listSkillInventoryQuery.mockResolvedValue({
		skills: [
			{ id: "review", displayName: "review", description: "Review pull requests carefully.", source: "disk" },
			{ id: "plan", displayName: "plan", description: "Plan before coding.", source: "disk" },
		],
		agents: [{ id: "code-reviewer", displayName: "code-reviewer", description: "Reviews PRs.", source: "disk" }],
		commands: [{ id: "pr", displayName: "pr", description: "Open a pull request.", source: "disk" }],
	});
	listMcpInventoryQuery.mockResolvedValue({
		servers: [
			{
				id: "filesystem",
				displayName: "filesystem",
				description: "npx -y @modelcontextprotocol/server-filesystem",
				provider: "claude",
			},
		],
	});
	listAgentModelsQuery.mockResolvedValue({
		agentId: "claude",
		models: [
			{ id: "sonnet", label: "Sonnet (latest alias)" },
			{ id: "opus", label: "Opus (latest alias)" },
		],
		source: "catalog",
	});
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
	vi.clearAllMocks();
});

describe("TaskLaunchSettingsPicker", () => {
	it("hides for non Claude/Cursor agents", () => {
		act(() => {
			renderUi(
				<TaskLaunchSettingsPicker active agentId="codex" value={undefined} onChange={() => undefined} />,
			);
		});
		expect(container.querySelector('[data-testid="task-launch-settings"]')).toBeNull();
	});

	it("attaches and detaches skill chips", async () => {
		const onChange = vi.fn();
		await act(async () => {
			renderUi(
				<TaskLaunchSettingsPicker active agentId="claude" value={undefined} onChange={onChange} />,
			);
		});

		await act(async () => {
			await Promise.resolve();
		});
		expect(listSkillInventoryQuery).toHaveBeenCalled();

		const skillSelect = Array.from(container.querySelectorAll("select")).find((select) =>
			Array.from(select.options).some((option) => option.textContent === "Add skill…"),
		);
		expect(skillSelect).toBeTruthy();
		await act(async () => {
			skillSelect!.value = "review";
			skillSelect!.dispatchEvent(new Event("change", { bubbles: true }));
		});
		expect(onChange).toHaveBeenCalledWith({ skillIds: ["review"] });

		onChange.mockClear();
		await act(async () => {
			renderUi(
				<TaskLaunchSettingsPicker
					active
					agentId="claude"
					value={{ skillIds: ["review"] } satisfies RuntimeTaskLaunchSettings}
					onChange={onChange}
				/>,
			);
		});
		await act(async () => {
			await Promise.resolve();
		});

		const removeButton = container.querySelector('button[aria-label="Remove review"]');
		expect(removeButton).toBeTruthy();
		await act(async () => {
			removeButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(onChange).toHaveBeenCalledWith(undefined);
	});

	it("exposes skill description on attached chips for hover", async () => {
		const onChange = vi.fn();
		await act(async () => {
			renderUi(
				<TaskLaunchSettingsPicker
					active
					agentId="claude"
					value={{ skillIds: ["review"] }}
					onChange={onChange}
				/>,
			);
		});
		await act(async () => {
			await Promise.resolve();
		});

		const chip = container.querySelector('[title="Review pull requests carefully."]');
		expect(chip).toBeTruthy();
	});

	it("removes a skill chip while a description tooltip is present", async () => {
		const onChange = vi.fn();
		await act(async () => {
			renderUi(
				<TaskLaunchSettingsPicker
					active
					agentId="claude"
					value={{ skillIds: ["review", "plan"] }}
					onChange={onChange}
				/>,
			);
		});
		await act(async () => {
			await Promise.resolve();
		});

		const removeButton = container.querySelector('button[aria-label="Remove review"]');
		expect(removeButton).toBeTruthy();
		await act(async () => {
			removeButton!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
		});
		expect(onChange).toHaveBeenCalledWith({ skillIds: ["plan"] });
	});

	it("attaches agent and slash command tags from inventory", async () => {
		const onChange = vi.fn();
		await act(async () => {
			renderUi(
				<TaskLaunchSettingsPicker active agentId="claude" value={undefined} onChange={onChange} />,
			);
		});
		await act(async () => {
			await Promise.resolve();
		});

		const agentSelect = Array.from(container.querySelectorAll("select")).find((select) =>
			Array.from(select.options).some((option) => option.textContent === "Add agent…"),
		);
		const commandSelect = Array.from(container.querySelectorAll("select")).find((select) =>
			Array.from(select.options).some((option) => option.textContent === "Add command…"),
		);
		expect(agentSelect).toBeTruthy();
		expect(commandSelect).toBeTruthy();

		await act(async () => {
			agentSelect!.value = "code-reviewer";
			agentSelect!.dispatchEvent(new Event("change", { bubbles: true }));
		});
		expect(onChange).toHaveBeenCalledWith({ agentIds: ["code-reviewer"] });

		onChange.mockClear();
		await act(async () => {
			commandSelect!.value = "pr";
			commandSelect!.dispatchEvent(new Event("change", { bubbles: true }));
		});
		// Optimistic draft may already include agentIds from the previous add.
		expect(onChange).toHaveBeenCalled();
		const last = onChange.mock.calls.at(-1)?.[0] as RuntimeTaskLaunchSettings;
		expect(last.commandIds).toEqual(["pr"]);
	});

	it("renders launch settings picker and Gemini models for gemini agent", async () => {
		const onChange = vi.fn();
		await act(async () => {
			renderUi(
				<TaskLaunchSettingsPicker active agentId="gemini" value={undefined} onChange={onChange} />,
			);
		});
		await act(async () => {
			await Promise.resolve();
		});

		expect(container.textContent).toContain("Model");
		expect(container.textContent).toContain("Effort");
		expect(container.textContent).toContain("Skill");
	});

	it("accumulates multiple skill adds before parent value catches up", async () => {
		const onChange = vi.fn();
		await act(async () => {
			renderUi(
				<TaskLaunchSettingsPicker active agentId="claude" value={undefined} onChange={onChange} />,
			);
		});
		await act(async () => {
			await Promise.resolve();
		});

		const skillSelect = Array.from(container.querySelectorAll("select")).find((select) =>
			Array.from(select.options).some((option) => option.textContent === "Add skill…"),
		);
		expect(skillSelect).toBeTruthy();

		await act(async () => {
			skillSelect!.value = "review";
			skillSelect!.dispatchEvent(new Event("change", { bubbles: true }));
		});
		await act(async () => {
			skillSelect!.value = "plan";
			skillSelect!.dispatchEvent(new Event("change", { bubbles: true }));
		});

		expect(onChange).toHaveBeenLastCalledWith({ skillIds: ["review", "plan"] });
		expect(container.querySelector('button[aria-label="Remove review"]')).toBeTruthy();
		expect(container.querySelector('button[aria-label="Remove plan"]')).toBeTruthy();
	});

	it("loads live models and sets effort for Claude", async () => {
		const onChange = vi.fn();
		await act(async () => {
			renderUi(
				<TaskLaunchSettingsPicker active agentId="claude" value={undefined} onChange={onChange} />,
			);
		});
		await act(async () => {
			await Promise.resolve();
		});
		expect(listAgentModelsQuery).toHaveBeenCalledWith({ agentId: "claude" });

		await act(async () => {
			renderUi(
				<TaskLaunchSettingsPicker
					active
					agentId="claude"
					value={{ modelId: "sonnet" }}
					onChange={onChange}
				/>,
			);
		});
		const effort = Array.from(container.querySelectorAll("select")).find((select) =>
			Array.from(select.options).some((option) => option.textContent === "High"),
		);
		expect(effort).toBeTruthy();
		await act(async () => {
			effort!.value = "high";
			effort!.dispatchEvent(new Event("change", { bubbles: true }));
		});
		expect(onChange).toHaveBeenCalledWith({ modelId: "sonnet", effort: "high" });
	});

	it("attaches and detaches MCP chips", async () => {
		const onChange = vi.fn();
		await act(async () => {
			renderUi(
				<TaskLaunchSettingsPicker active agentId="cursor" value={undefined} onChange={onChange} />,
			);
		});
		await act(async () => {
			await Promise.resolve();
		});

		const mcpSelect = Array.from(container.querySelectorAll("select")).find((select) =>
			Array.from(select.options).some((option) => option.textContent === "Add MCP server…"),
		);
		expect(mcpSelect).toBeTruthy();
		await act(async () => {
			mcpSelect!.value = "filesystem";
			mcpSelect!.dispatchEvent(new Event("change", { bubbles: true }));
		});
		expect(onChange).toHaveBeenCalledWith({ mcpServerIds: ["filesystem"] });

		onChange.mockClear();
		await act(async () => {
			renderUi(
				<TaskLaunchSettingsPicker
					active
					agentId="cursor"
					value={{ mcpServerIds: ["filesystem"] }}
					onChange={onChange}
				/>,
			);
		});
		const removeButton = container.querySelector('button[aria-label="Remove filesystem"]');
		expect(removeButton).toBeTruthy();
		await act(async () => {
			removeButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(onChange).toHaveBeenCalledWith(undefined);
	});

	it("passes the active workspaceId to listSkillInventory", async () => {
		await act(async () => {
			renderUi(
				<TaskLaunchSettingsPicker
					active
					agentId="claude"
					workspaceId="ws-1"
					value={undefined}
					onChange={() => undefined}
				/>,
			);
		});
		await act(async () => {
			await Promise.resolve();
		});
		expect(listSkillInventoryQuery).toHaveBeenCalledWith({ workspaceId: "ws-1" });
	});

	it("badges project-local items and leaves global ones unbadged", async () => {
		listSkillInventoryQuery.mockResolvedValue({
			skills: [
				{ id: "review", displayName: "review", description: "Global review.", source: "disk", origin: "global" },
				{
					id: "local-skill",
					displayName: "local-skill",
					description: "Project skill.",
					source: "disk",
					origin: "project",
					root: "agent",
				},
			],
			agents: [],
			commands: [],
			workflows: [],
		});
		await act(async () => {
			renderUi(
				<TaskLaunchSettingsPicker
					active
					agentId="claude"
					value={{ skillIds: ["review", "local-skill"] }}
					onChange={() => undefined}
				/>,
			);
		});
		await act(async () => {
			await Promise.resolve();
		});

		const badges = container.querySelectorAll('[data-testid="task-launch-project-badge"]');
		expect(badges.length).toBe(1);
		const projectChip = container.querySelector('button[aria-label="Remove local-skill"]')?.parentElement;
		expect(projectChip?.querySelector('[data-testid="task-launch-project-badge"]')).toBeTruthy();
		const globalChip = container.querySelector('button[aria-label="Remove review"]')?.parentElement;
		expect(globalChip?.querySelector('[data-testid="task-launch-project-badge"]')).toBeNull();
	});

	it("renders a Workflows section from inventory workflows", async () => {
		listSkillInventoryQuery.mockResolvedValue({
			skills: [],
			agents: [],
			commands: [],
			workflows: [
				{
					id: "deploy",
					displayName: "deploy",
					description: "Deploy workflow.",
					source: "disk",
					origin: "project",
					root: "agent",
				},
			],
		});
		await act(async () => {
			renderUi(
				<TaskLaunchSettingsPicker active agentId="claude" value={undefined} onChange={() => undefined} />,
			);
		});
		await act(async () => {
			await Promise.resolve();
		});

		const workflowSelect = Array.from(container.querySelectorAll("select")).find((select) =>
			Array.from(select.options).some((option) => option.textContent === "Add workflow…"),
		);
		expect(workflowSelect).toBeTruthy();
		const deployOption = Array.from(workflowSelect!.options).find((option) => option.value === "deploy");
		expect(deployOption?.textContent).toContain("this project");
	});

	it("emits selected workflowIds through onChange", async () => {
		const onChange = vi.fn();
		listSkillInventoryQuery.mockResolvedValue({
			skills: [],
			agents: [],
			commands: [],
			workflows: [
				{
					id: "deploy",
					displayName: "deploy",
					description: "Deploy workflow.",
					source: "disk",
					origin: "project",
					root: "agent",
				},
			],
		});
		await act(async () => {
			renderUi(<TaskLaunchSettingsPicker active agentId="claude" value={undefined} onChange={onChange} />);
		});
		await act(async () => {
			await Promise.resolve();
		});

		const workflowSelect = Array.from(container.querySelectorAll("select")).find((select) =>
			Array.from(select.options).some((option) => option.textContent === "Add workflow…"),
		);
		expect(workflowSelect).toBeTruthy();
		await act(async () => {
			workflowSelect!.value = "deploy";
			workflowSelect!.dispatchEvent(new Event("change", { bubbles: true }));
		});
		expect(onChange).toHaveBeenCalledWith({ workflowIds: ["deploy"] });
	});

	it("omits the Workflows section when there are no workflows", async () => {
		await act(async () => {
			renderUi(
				<TaskLaunchSettingsPicker active agentId="claude" value={undefined} onChange={() => undefined} />,
			);
		});
		await act(async () => {
			await Promise.resolve();
		});

		const workflowSelect = Array.from(container.querySelectorAll("select")).find((select) =>
			Array.from(select.options).some((option) => option.textContent === "Add workflow…"),
		);
		expect(workflowSelect).toBeUndefined();
	});

	it("clears all launch tags from the clear action", async () => {
		const onChange = vi.fn();
		await act(async () => {
			renderUi(
				<TaskLaunchSettingsPicker
					active
					agentId="claude"
					value={{ modelId: "opus", skillIds: ["review"], mcpServerIds: ["filesystem"] }}
					onChange={onChange}
				/>,
			);
		});
		const clearButton = Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Clear launch tags"),
		);
		expect(clearButton).toBeTruthy();
		await act(async () => {
			clearButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(onChange).toHaveBeenCalledWith(undefined);
	});
});
