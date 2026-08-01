import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskLaunchSettingsPicker } from "@/components/task-launch-settings";
import type { RuntimeTaskLaunchSettings } from "@/runtime/types";

const listSkillInventoryQuery = vi.hoisted(() => vi.fn());
const listMcpInventoryQuery = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		runtime: {
			listSkillInventory: { query: listSkillInventoryQuery },
			listMcpInventory: { query: listMcpInventoryQuery },
		},
	}),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	listSkillInventoryQuery.mockResolvedValue({
		skills: [
			{ id: "review", displayName: "review", source: "disk" },
			{ id: "plan", displayName: "plan", source: "disk" },
		],
	});
	listMcpInventoryQuery.mockResolvedValue({
		servers: [{ id: "filesystem", displayName: "filesystem", provider: "claude" }],
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
			root.render(
				<TaskLaunchSettingsPicker active agentId="codex" value={undefined} onChange={() => undefined} />,
			);
		});
		expect(container.querySelector('[data-testid="task-launch-settings"]')).toBeNull();
	});

	it("attaches and detaches skill chips", async () => {
		const onChange = vi.fn();
		await act(async () => {
			root.render(
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
			root.render(
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

	it("sets model and effort for Claude", async () => {
		const onChange = vi.fn();
		await act(async () => {
			root.render(
				<TaskLaunchSettingsPicker active agentId="claude" value={undefined} onChange={onChange} />,
			);
		});
		await act(async () => {
			await Promise.resolve();
		});

		const selects = Array.from(container.querySelectorAll("select"));
		const modelSelect = selects.find((select) =>
			Array.from(select.options).some((option) => option.textContent === "Sonnet"),
		);
		const effortSelect = selects.find((select) =>
			Array.from(select.options).some((option) => option.textContent === "High"),
		);
		expect(modelSelect).toBeTruthy();
		expect(effortSelect).toBeTruthy();

		await act(async () => {
			modelSelect!.value = "sonnet";
			modelSelect!.dispatchEvent(new Event("change", { bubbles: true }));
		});
		expect(onChange).toHaveBeenCalledWith({ modelId: "sonnet" });

		onChange.mockClear();
		await act(async () => {
			root.render(
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
		await act(async () => {
			effort!.value = "high";
			effort!.dispatchEvent(new Event("change", { bubbles: true }));
		});
		expect(onChange).toHaveBeenCalledWith({ modelId: "sonnet", effort: "high" });
	});

	it("attaches and detaches MCP chips", async () => {
		const onChange = vi.fn();
		await act(async () => {
			root.render(
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
			root.render(
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

	it("clears all launch tags from the clear action", async () => {
		const onChange = vi.fn();
		await act(async () => {
			root.render(
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
