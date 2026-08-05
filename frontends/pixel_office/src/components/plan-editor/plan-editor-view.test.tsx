import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlanEditorView } from "@/components/plan-editor/plan-editor-view";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { RuntimeSavedPlan } from "@/runtime/types";

const mockReadQuery = vi.fn();
const mockWriteMutate = vi.fn();
const mockWriteAssetMutate = vi.fn();

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		plans: {
			read: { query: mockReadQuery },
			write: { mutate: mockWriteMutate },
			writeAsset: { mutate: mockWriteAssetMutate },
		},
	}),
}));

const PLAN: RuntimeSavedPlan = {
	id: "plan-1",
	name: "roadmap",
	path: "/tmp/roadmap.md",
	addedAt: 0,
};

function flush(): Promise<void> {
	return act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

function getTextarea(container: HTMLDivElement): HTMLTextAreaElement {
	const textarea = container.querySelector('[data-testid="plan-editor-textarea"]');
	if (!(textarea instanceof HTMLTextAreaElement)) {
		throw new Error("plan editor textarea not found");
	}
	return textarea;
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
	const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
	setter?.call(textarea, value);
	textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("PlanEditorView", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		mockReadQuery.mockReset().mockResolvedValue({ ok: true, plan: PLAN, content: "# Roadmap\n" });
		mockWriteMutate.mockReset().mockResolvedValue({ ok: true, plan: PLAN });
		mockWriteAssetMutate.mockReset();
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it("loads plan content into the source pane and switches to preview-only mode", async () => {
		await act(async () => {
			root.render(
				<TooltipProvider>
					<PlanEditorView plan={PLAN} workspaceId="workspace-1" onClose={() => {}} />
				</TooltipProvider>,
			);
		});
		await flush();

		expect(getTextarea(container).value).toBe("# Roadmap\n");

		const previewTab = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Preview",
		);
		expect(previewTab).toBeDefined();
		await act(async () => {
			previewTab?.click();
		});

		expect(container.querySelector('[data-testid="plan-editor-textarea"]')).toBeNull();
		expect(container.textContent).toContain("Roadmap");
	});

	it("autosaves edits after the debounce window", async () => {
		await act(async () => {
			root.render(
				<TooltipProvider>
					<PlanEditorView plan={PLAN} workspaceId="workspace-1" onClose={() => {}} />
				</TooltipProvider>,
			);
		});
		await flush();

		const textarea = getTextarea(container);
		await act(async () => {
			setTextareaValue(textarea, "# Roadmap\n\nUpdated");
		});

		expect(mockWriteMutate).not.toHaveBeenCalled();

		await act(async () => {
			await new Promise((resolveWait) => setTimeout(resolveWait, 600));
		});

		expect(mockWriteMutate).toHaveBeenCalledWith({ planId: "plan-1", content: "# Roadmap\n\nUpdated" });
	});

	it("wraps the selection in bold markers via the toolbar", async () => {
		await act(async () => {
			root.render(
				<TooltipProvider>
					<PlanEditorView plan={PLAN} workspaceId="workspace-1" onClose={() => {}} />
				</TooltipProvider>,
			);
		});
		await flush();

		const textarea = getTextarea(container);
		textarea.focus();
		textarea.setSelectionRange(2, 9);

		const boldButton = container.querySelector('[aria-label="Bold"]');
		expect(boldButton).toBeInstanceOf(HTMLButtonElement);
		await act(async () => {
			(boldButton as HTMLButtonElement).click();
		});

		expect(getTextarea(container).value).toBe("# **Roadmap**\n");
	});
});
