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

vi.mock("@/components/app-toaster", () => ({
	showAppToast: vi.fn(),
}));

vi.mock("@/components/plan-editor/plan-rich-editor", () => ({
	default: function MockPlanRichEditor() {
		return <div data-testid="plan-rich-editor">rich editor</div>;
	},
}));

vi.mock("@/components/plan-editor/plan-rich-preview", () => ({
	default: ({ content }: { content: string }) => (
		<pre data-testid="plan-rich-preview">{content}</pre>
	),
}));

vi.mock("@/html/html-generate-dialog", () => ({
	HtmlGenerateDialog: () => null,
}));

const PLAN: RuntimeSavedPlan = {
	id: "plan-1",
	name: "roadmap",
	path: "/tmp/roadmap.md",
	addedAt: 0,
};

const HTML_PLAN: RuntimeSavedPlan = {
	id: "plan-html",
	name: "roadmap",
	path: "/tmp/roadmap.html",
	addedAt: 0,
};

function flush(): Promise<void> {
	return act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

async function waitForSaved(container: HTMLDivElement): Promise<void> {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		if (container.textContent?.includes("Saved")) {
			return;
		}
		await act(async () => {
			await new Promise((resolveWait) => setTimeout(resolveWait, 25));
		});
	}
	throw new Error("plan editor never reached Saved status");
}

async function waitForRichEditor(container: HTMLDivElement): Promise<void> {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		if (container.querySelector('[data-testid="plan-rich-editor"]')) {
			return;
		}
		await act(async () => {
			await new Promise((resolveWait) => setTimeout(resolveWait, 25));
		});
	}
	throw new Error("plan rich editor never mounted");
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

	it("defaults to the rich editor without source/preview mode tabs", async () => {
		await act(async () => {
			root.render(
				<TooltipProvider>
					<PlanEditorView plan={PLAN} workspaceId="workspace-1" onClose={() => {}} />
				</TooltipProvider>,
			);
		});
		await flush();
		await waitForRichEditor(container);

		expect(container.querySelector('[data-testid="plan-rich-editor"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="plan-editor-textarea"]')).toBeNull();
		expect(container.querySelector('[aria-label="Split"]')).toBeNull();
		expect(container.querySelector('[data-testid="plan-editor-switch-to-plain"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="plan-editor-generate-html"]')).not.toBeNull();
	});

	it("opens html plans in sandboxed preview and never mounts TipTap", async () => {
		mockReadQuery.mockResolvedValue({
			ok: true,
			plan: HTML_PLAN,
			content: "<html><body><h1>Hi</h1></body></html>",
		});
		await act(async () => {
			root.render(
				<TooltipProvider>
					<PlanEditorView plan={HTML_PLAN} workspaceId="workspace-1" onClose={() => {}} />
				</TooltipProvider>,
			);
		});
		await flush();

		expect(container.querySelector('[data-testid="plan-editor-html-preview"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="plan-rich-editor"]')).toBeNull();
		expect(container.querySelector('[data-testid="plan-editor-generate-html"]')).toBeNull();
		expect(container.textContent).toContain("HTML");
	});

	it("switches to plain text editing and autosaves textarea edits", async () => {
		await act(async () => {
			root.render(
				<TooltipProvider>
					<PlanEditorView plan={PLAN} workspaceId="workspace-1" onClose={() => {}} />
				</TooltipProvider>,
			);
		});
		await flush();
		await waitForSaved(container);

		const switchToPlain = container.querySelector('[data-testid="plan-editor-switch-to-plain"]');
		expect(switchToPlain).toBeInstanceOf(HTMLButtonElement);
		await act(async () => {
			(switchToPlain as HTMLButtonElement).click();
		});

		expect(container.querySelector('[data-testid="plan-editor-textarea"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="plan-rich-editor"]')).toBeNull();
		expect(getTextarea(container).value).toBe("# Roadmap\n");

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

	it("wraps the selection in bold markers via the plain-mode toolbar", async () => {
		await act(async () => {
			root.render(
				<TooltipProvider>
					<PlanEditorView plan={PLAN} workspaceId="workspace-1" onClose={() => {}} />
				</TooltipProvider>,
			);
		});
		await flush();
		await waitForSaved(container);

		const switchToPlain = container.querySelector('[data-testid="plan-editor-switch-to-plain"]');
		await act(async () => {
			(switchToPlain as HTMLButtonElement).click();
		});

		const textarea = getTextarea(container);
		expect(textarea.value).toBe("# Roadmap\n");
		textarea.focus();
		textarea.setSelectionRange(2, 9);

		const boldButton = container.querySelector('[aria-label="Bold"]');
		expect(boldButton).toBeInstanceOf(HTMLButtonElement);
		await act(async () => {
			(boldButton as HTMLButtonElement).click();
		});

		expect(getTextarea(container).value).toBe("# **Roadmap**\n");
	});

	it("switches to the rich preview and mounts it with the current content", async () => {
		await act(async () => {
			root.render(
				<TooltipProvider>
					<PlanEditorView plan={PLAN} workspaceId="workspace-1" onClose={() => {}} />
				</TooltipProvider>,
			);
		});
		await flush();
		await waitForSaved(container);

		const switchToPreview = container.querySelector('[data-testid="plan-editor-switch-to-preview"]');
		expect(switchToPreview).toBeInstanceOf(HTMLButtonElement);
		await act(async () => {
			(switchToPreview as HTMLButtonElement).click();
		});
		await flush();

		const preview = container.querySelector('[data-testid="plan-rich-preview"]');
		expect(preview).not.toBeNull();
		expect(preview?.textContent).toBe("# Roadmap\n");
		expect(container.querySelector('[data-testid="plan-rich-editor"]')).toBeNull();
	});
});
