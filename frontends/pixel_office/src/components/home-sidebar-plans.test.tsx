import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HomeSidebarPlansPanel } from "@/components/home-sidebar-plans";
import { TooltipProvider } from "@/components/ui/tooltip";

const mockListPlans = vi.fn();
const mockClearAllPlans = vi.fn();
const mockRemovePlan = vi.fn();
const { mockShowAppToast } = vi.hoisted(() => ({
	mockShowAppToast: vi.fn(),
}));

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		plans: {
			list: { query: mockListPlans },
			clearAll: { mutate: mockClearAllPlans },
			remove: { mutate: mockRemovePlan },
		},
	}),
}));

vi.mock("@/components/app-toaster", () => ({
	showAppToast: mockShowAppToast,
}));

function flush() {
	return act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

describe("HomeSidebarPlansPanel", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		mockListPlans.mockReset().mockResolvedValue({
			ok: true,
			plans: [
				{ id: "plan-1", name: "Roadmap", path: "/plans/roadmap.md", addedAt: 100 },
				{ id: "plan-2", name: "Architecture", path: "/plans/arch.md", addedAt: 200 },
			],
		});
		mockClearAllPlans.mockReset().mockResolvedValue({ ok: true, clearedCount: 2 });
		mockRemovePlan.mockReset().mockResolvedValue({ ok: true });
		mockShowAppToast.mockReset();
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		document.body.innerHTML = "";
		delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
	});

	it("renders registered plans and the clear all button", async () => {
		await act(async () => {
			root.render(
				<TooltipProvider>
					<HomeSidebarPlansPanel workspaceId={null} onOpenPlan={() => {}} />
				</TooltipProvider>,
			);
		});
		await flush();

		expect(container.querySelector('[data-testid="sidebar-plan-row-plan-1"]')).toBeTruthy();
		expect(container.querySelector('[data-testid="sidebar-plan-row-plan-2"]')).toBeTruthy();
		expect(container.querySelector('[data-testid="sidebar-plans-clear-all"]')).toBeTruthy();
	});

	it("does not render clear all button when no plans are registered", async () => {
		mockListPlans.mockResolvedValueOnce({ ok: true, plans: [] });

		await act(async () => {
			root.render(
				<TooltipProvider>
					<HomeSidebarPlansPanel workspaceId={null} onOpenPlan={() => {}} />
				</TooltipProvider>,
			);
		});
		await flush();

		expect(container.querySelector('[data-testid="sidebar-plans-clear-all"]')).toBeNull();
	});

	it("opens confirmation dialog and clears all plans on confirm", async () => {
		await act(async () => {
			root.render(
				<TooltipProvider>
					<HomeSidebarPlansPanel workspaceId={null} onOpenPlan={() => {}} />
				</TooltipProvider>,
			);
		});
		await flush();

		const clearAllButton = container.querySelector('[data-testid="sidebar-plans-clear-all"]') as HTMLButtonElement;
		await act(async () => {
			clearAllButton.click();
		});
		await flush();

		const confirmButton = document.body.querySelector('[data-testid="sidebar-plans-confirm-clear"]') as HTMLButtonElement;
		expect(confirmButton).toBeTruthy();

		mockListPlans.mockResolvedValueOnce({ ok: true, plans: [] });

		await act(async () => {
			confirmButton.click();
		});
		await flush();

		expect(mockClearAllPlans).toHaveBeenCalledTimes(1);
		expect(mockShowAppToast).toHaveBeenCalledWith(
			expect.objectContaining({
				intent: "success",
				message: expect.stringContaining("Cleared 2 registered plans"),
			}),
		);
	});
});
