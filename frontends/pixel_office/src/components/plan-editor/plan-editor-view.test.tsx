import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlanEditorView } from "@/components/plan-editor/plan-editor-view";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { RuntimeSavedPlan } from "@/runtime/types";

const mockReadQuery = vi.fn();
const mockWriteMutate = vi.fn();
const mockWriteAssetMutate = vi.fn();
const mockListQuery = vi.fn();
const mockWriteSiblingMutate = vi.fn();
const mockHtmlStatusQuery = vi.fn();
const mockHtmlTemplatesQuery = vi.fn();

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		plans: {
			read: { query: mockReadQuery },
			write: { mutate: mockWriteMutate },
			writeAsset: { mutate: mockWriteAssetMutate },
			writeSibling: { mutate: mockWriteSiblingMutate },
			list: { query: mockListQuery },
		},
		html: {
			status: { query: mockHtmlStatusQuery },
			templates: { query: mockHtmlTemplatesQuery },
		},
	}),
}));

vi.mock("@/components/app-toaster", () => ({
	showAppToast: vi.fn(),
}));

vi.mock("@/components/plan-editor/plan-rich-editor", () => ({
	default: function MockPlanRichEditor({ content }: { content: string }) {
		return <div data-testid="plan-rich-editor">{content}</div>;
	},
}));

const PLAN: RuntimeSavedPlan = {
	id: "plan-1",
	name: "roadmap",
	path: "/tmp/roadmap.md",
	addedAt: 0,
};

const HTML_SIBLING: RuntimeSavedPlan = {
	id: "plan-1-html",
	name: "roadmap",
	path: "/tmp/roadmap.html",
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

async function waitFor(check: () => boolean, description: string): Promise<void> {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		if (check()) {
			return;
		}
		await act(async () => {
			await new Promise((resolveWait) => setTimeout(resolveWait, 25));
		});
	}
	throw new Error(`timed out waiting for ${description}`);
}

function getTextarea(container: HTMLDivElement): HTMLTextAreaElement {
	const textarea = container.querySelector('[data-testid="plan-editor-textarea"]');
	if (!(textarea instanceof HTMLTextAreaElement)) {
		throw new Error("plan editor textarea not found");
	}
	return textarea;
}

function getHtmlSwitchButton(container: HTMLDivElement): HTMLButtonElement {
	const button = container
		.querySelector('[data-testid="plan-editor-raw-source-switch"]')
		?.querySelectorAll("button")[1];
	if (!(button instanceof HTMLButtonElement)) {
		throw new Error("HTML source switch not found");
	}
	return button;
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
	const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
	setter?.call(textarea, value);
	textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("PlanEditorView", () => {
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

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		mockReadQuery.mockReset().mockImplementation(({ planId }: { planId: string }) =>
			Promise.resolve(
				planId === HTML_SIBLING.id
					? { ok: true, plan: HTML_SIBLING, content: "<h1>Generated</h1>" }
					: { ok: true, plan: PLAN, content: "# Roadmap\n" },
			),
		);
		mockWriteMutate.mockReset().mockResolvedValue({ ok: true, plan: PLAN });
		mockWriteAssetMutate.mockReset();
		mockWriteSiblingMutate.mockReset().mockResolvedValue({ ok: true, plan: HTML_SIBLING, isNew: true });
		mockListQuery.mockReset().mockResolvedValue({ ok: true, plans: [PLAN] });
		mockHtmlStatusQuery.mockReset().mockResolvedValue({ online: false });
		mockHtmlTemplatesQuery.mockReset().mockResolvedValue([]);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it("shows raw markdown and the rendered editor side by side", async () => {
		await render(PLAN);
		await flush();
		await waitFor(
			() => container.querySelector('[data-testid="plan-rich-editor"]') !== null,
			"rich editor",
		);

		expect(container.querySelector('[data-testid="plan-editor-raw-pane"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="plan-editor-rendered-pane"]')).not.toBeNull();
		expect(getTextarea(container).value).toBe("# Roadmap\n");
		expect(container.querySelector('[data-testid="plan-html-generate-bar"]')).not.toBeNull();
	});

	it("greys out the HTML switch until a sibling exists", async () => {
		await render(PLAN);
		await flush();

		expect(getHtmlSwitchButton(container).disabled).toBe(true);
	});

	it("enables the HTML switch and shows the sibling document when one exists", async () => {
		mockListQuery.mockResolvedValue({ ok: true, plans: [PLAN, HTML_SIBLING] });
		await render(PLAN);
		await flush();
		await waitFor(() => !getHtmlSwitchButton(container).disabled, "enabled HTML switch");

		await act(async () => {
			getHtmlSwitchButton(container).click();
		});
		await waitFor(
			() => getTextarea(container).value === "<h1>Generated</h1>",
			"sibling HTML in the raw pane",
		);

		expect(container.querySelector('[data-testid="plan-editor-html-preview"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="plan-rich-editor"]')).toBeNull();
	});

	it("autosaves raw-pane edits", async () => {
		await render(PLAN);
		await flush();
		await waitFor(() => container.textContent?.includes("Saved") === true, "saved status");

		await act(async () => {
			setTextareaValue(getTextarea(container), "# Roadmap\n\nUpdated");
		});
		expect(mockWriteMutate).not.toHaveBeenCalled();

		await act(async () => {
			await new Promise((resolveWait) => setTimeout(resolveWait, 600));
		});

		expect(mockWriteMutate).toHaveBeenCalledWith({ planId: "plan-1", content: "# Roadmap\n\nUpdated" });
	});

	it("wraps the selection in bold markers via the raw-pane toolbar", async () => {
		await render(PLAN);
		await flush();
		await waitFor(() => getTextarea(container).value === "# Roadmap\n", "loaded content");

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

	it("pins html plans to the HTML source with no generation bar", async () => {
		mockReadQuery.mockResolvedValue({
			ok: true,
			plan: HTML_PLAN,
			content: "<html><body><h1>Hi</h1></body></html>",
		});
		await render(HTML_PLAN);
		await flush();

		expect(container.querySelector('[data-testid="plan-editor-html-preview"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="plan-rich-editor"]')).toBeNull();
		expect(container.querySelector('[data-testid="plan-html-generate-bar"]')).toBeNull();
		expect(getHtmlSwitchButton(container).disabled).toBe(true);
	});
});
