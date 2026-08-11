import type { ReactElement, ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlanEditorApp } from "@/plan-editor-app/plan-editor-app";
import type { RuntimeSavedPlan } from "@/runtime/types";

/*
 * Covers the URL round trip: opening a plan has to be reflected in the address bar, and a
 * reload of that address has to reopen the same plan instead of dropping back to the list.
 */

const PLAN: RuntimeSavedPlan = { id: "plan-abc", name: "Rollout", path: "/plans/rollout.md", addedAt: 1 };

const mockPlansListQuery = vi.fn(async () => ({ ok: true, plans: [PLAN] }));
vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		plans: { list: { query: mockPlansListQuery } },
	}),
}));

const mockShowAppToast = vi.fn();
vi.mock("@/components/app-toaster", () => ({
	showAppToast: (...args: unknown[]) => mockShowAppToast(...args),
}));

/** The real view drags in the whole rich editor; only its identity matters here. */
vi.mock("@/components/plan-editor/plan-editor-view", () => ({
	PlanEditorView: ({ plan, onClose }: { plan: RuntimeSavedPlan; onClose: () => void }) => (
		<div data-testid="plan-editor-view">
			<span data-testid="open-plan-id">{plan.id}</span>
			<button type="button" data-testid="close-plan" onClick={onClose}>
				Close
			</button>
		</div>
	),
}));

/** Stands in for the plans list, whose own data loading is not what this covers. */
vi.mock("@/plan-editor-app/plan-list-screen", () => ({
	PlanListScreen: ({ onOpenPlan }: { onOpenPlan: (plan: RuntimeSavedPlan) => void }) => (
		<button type="button" data-testid="open-plan" onClick={() => onOpenPlan(PLAN)}>
			Rollout
		</button>
	),
}));

vi.mock("@/components/theme-select", () => ({
	ThemeSelect: (): ReactElement => <div data-testid="theme-select" />,
}));

function element(testId: string): HTMLElement | null {
	const found = document.querySelector(`[data-testid="${testId}"]`);
	return found instanceof HTMLElement ? found : null;
}

async function flush(): Promise<void> {
	await act(async () => {
		await Promise.resolve();
	});
}

describe("PlanEditorApp plan routing", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		window.history.replaceState(null, "", window.location.pathname);
		mockPlansListQuery.mockClear();
		mockShowAppToast.mockClear();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		window.history.replaceState(null, "", window.location.pathname);
	});

	function render(node: ReactNode): Promise<void> {
		return act(async () => {
			root.render(node);
		});
	}

	it("puts the opened plan in the URL and takes it back out on close", async () => {
		await render(<PlanEditorApp />);
		expect(element("open-plan")).not.toBeNull();

		await act(async () => {
			element("open-plan")?.click();
		});
		expect(element("open-plan-id")?.textContent).toBe(PLAN.id);
		expect(window.location.hash).toBe(`#plan=${PLAN.id}`);

		await act(async () => {
			element("close-plan")?.click();
		});
		expect(element("plan-editor-view")).toBeNull();
		expect(window.location.hash).toBe("");
	});

	it("reopens the plan named by the URL on load", async () => {
		window.history.replaceState(null, "", `${window.location.pathname}#plan=${PLAN.id}`);

		await render(<PlanEditorApp />);
		// The list must not flash before the id resolves.
		expect(element("open-plan")).toBeNull();
		await flush();

		expect(element("open-plan-id")?.textContent).toBe(PLAN.id);
		expect(mockPlansListQuery).toHaveBeenCalledTimes(1);
	});

	it("returns to the list when the browser navigates back", async () => {
		await render(<PlanEditorApp />);
		await act(async () => {
			element("open-plan")?.click();
		});
		expect(element("plan-editor-view")).not.toBeNull();

		await act(async () => {
			window.history.replaceState(null, "", window.location.pathname);
			window.dispatchEvent(new PopStateEvent("popstate"));
		});

		expect(element("plan-editor-view")).toBeNull();
		expect(element("open-plan")).not.toBeNull();
	});

	it("falls back to the list and clears the URL when the id is unknown", async () => {
		mockPlansListQuery.mockResolvedValueOnce({ ok: true, plans: [] });
		window.history.replaceState(null, "", `${window.location.pathname}#plan=gone`);

		await render(<PlanEditorApp />);
		await flush();

		expect(element("plan-editor-view")).toBeNull();
		expect(element("open-plan")).not.toBeNull();
		expect(window.location.hash).toBe("");
		expect(mockShowAppToast).toHaveBeenCalledWith(expect.objectContaining({ intent: "danger" }));
	});
});
