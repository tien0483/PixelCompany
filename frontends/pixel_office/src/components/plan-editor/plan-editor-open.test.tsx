import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlanEditorView } from "@/components/plan-editor/plan-editor-view";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { RuntimeSavedPlan } from "@/runtime/types";

const mockReadQuery = vi.fn();
const mockWriteMutate = vi.fn();
const mockListQuery = vi.fn();

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		plans: {
			read: { query: mockReadQuery },
			write: { mutate: mockWriteMutate },
			writeAsset: { mutate: vi.fn() },
			writeSibling: { mutate: vi.fn() },
			list: { query: mockListQuery },
		},
		html: {
			status: { query: vi.fn().mockResolvedValue({ online: false }) },
			templates: { query: vi.fn().mockResolvedValue([]) },
		},
	}),
}));

vi.mock("@/components/app-toaster", () => ({ showAppToast: vi.fn() }));

const PLAN_A: RuntimeSavedPlan = { id: "plan-a", name: "a", path: "/tmp/a.md", addedAt: 2 };
const PLAN_B: RuntimeSavedPlan = { id: "plan-b", name: "b", path: "/tmp/b.md", addedAt: 1 };

const CONTENT_A = "# Plan A\n\nFirst paragraph.\n\n- one\n- two\n";
const CONTENT_B = "# Plan B\n\nBody of B.\n";

async function wait(ms: number): Promise<void> {
	await act(async () => {
		await new Promise((resolveWait) => setTimeout(resolveWait, ms));
	});
}

/**
 * Guards against the class of bug where merely opening a plan autosaved an empty
 * document over the user's file. These run against the real TipTap rich editor
 * rather than the stub plan-editor-view.test.tsx installs, because the wipe came
 * from the editor's own mount-time events.
 */
describe("PlanEditorView opening a plan", () => {
	let container: HTMLDivElement;
	let root: Root;

	function render(plan: RuntimeSavedPlan): Promise<void> {
		return act(async () => {
			root.render(
				<TooltipProvider>
					<PlanEditorView plan={plan} workspaceId="workspace-1" onClose={() => {}} />
				</TooltipProvider>,
			);
		});
	}

	function proseText(): string {
		return (container.querySelector(".ProseMirror") as HTMLElement | null)?.textContent ?? "";
	}

	function textarea(): HTMLTextAreaElement | null {
		return container.querySelector('[data-testid="plan-editor-textarea"]');
	}

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		mockReadQuery.mockReset().mockImplementation(({ planId }: { planId: string }) =>
			Promise.resolve(
				planId === PLAN_A.id
					? { ok: true, plan: PLAN_A, content: CONTENT_A }
					: { ok: true, plan: PLAN_B, content: CONTENT_B },
			),
		);
		mockWriteMutate.mockReset().mockResolvedValue({ ok: true, plan: PLAN_A });
		mockListQuery.mockReset().mockResolvedValue({ ok: true, plans: [PLAN_A, PLAN_B] });
	});

	afterEach(async () => {
		await act(async () => {
			root.unmount();
		});
		container.remove();
	});

	it("never writes to the plan file just from being opened", async () => {
		await render(PLAN_A);
		await wait(1200);

		expect(mockWriteMutate).not.toHaveBeenCalled();
		expect(textarea()?.value).toBe(CONTENT_A);
	});

	it("shows the loaded markdown in the rich pane instead of an empty document", async () => {
		await render(PLAN_A);
		await wait(1200);

		expect(proseText()).toContain("First paragraph");
	});

	it("does not write when focus lands in the rich pane without an edit", async () => {
		await render(PLAN_A);
		await wait(1200);

		const prose = container.querySelector(".ProseMirror") as HTMLElement | null;
		await act(async () => {
			prose?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
			prose?.focus();
		});
		await wait(800);

		expect(mockWriteMutate).not.toHaveBeenCalled();
	});

	it("does not write when switching from one plan to another", async () => {
		await render(PLAN_A);
		await wait(1200);
		await render(PLAN_B);
		await wait(1200);

		expect(mockWriteMutate).not.toHaveBeenCalled();
		expect(textarea()?.value).toBe(CONTENT_B);
	});

	it("keeps a plan it could not read read-only so the file on disk survives", async () => {
		mockReadQuery.mockResolvedValue({ ok: false, plan: null, content: null, error: "boom" });
		await render(PLAN_A);
		await wait(1200);

		expect(textarea()?.disabled).toBe(true);
		expect(mockWriteMutate).not.toHaveBeenCalled();
	});
});
