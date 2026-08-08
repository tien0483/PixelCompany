import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlanEditorView } from "@/components/plan-editor/plan-editor-view";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HTML_LABELS } from "@/html/html-labels";
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

const mockShowAppToast = vi.fn();
vi.mock("@/components/app-toaster", () => ({
	showAppToast: (...args: unknown[]) => mockShowAppToast(...args),
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

const PLAN2: RuntimeSavedPlan = {
	id: "plan-2",
	name: "plan-2",
	path: "/tmp/plan-2.md",
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
					{/*
					 * `key={plan.id}` mirrors the real App.tsx render call (`key={editingPlan.id}`,
					 * task 3c) — in production a plan switch always remounts, so the regression test
					 * for the cross-plan leak should exercise that same remount rather than a bare
					 * prop swap on a surviving instance, which is not a shape the shipped app produces.
					 */}
					<PlanEditorView key={plan.id} plan={plan} workspaceId="workspace-1" onClose={() => {}} />
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
					: planId === PLAN2.id
						? { ok: true, plan: PLAN2, content: "# Plan 2\n" }
						: { ok: true, plan: PLAN, content: "# Roadmap\n" },
			),
		);
		mockWriteMutate.mockReset().mockResolvedValue({ ok: true, plan: PLAN });
		mockWriteAssetMutate.mockReset();
		mockWriteSiblingMutate.mockReset().mockResolvedValue({ ok: true, plan: HTML_SIBLING, isNew: true });
		mockListQuery.mockReset().mockResolvedValue({ ok: true, plans: [PLAN] });
		mockHtmlStatusQuery.mockReset().mockResolvedValue({ online: false });
		mockHtmlTemplatesQuery.mockReset().mockResolvedValue([]);
		mockShowAppToast.mockReset();
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

	describe("expand and refine", () => {
		const TEMPLATE = {
			id: "dashboard",
			zhName: "仪表板",
			enName: "Admin Dashboard",
			emoji: "🎛️",
			description: "",
			category: "dashboard",
			scenario: "operations",
			aspectHint: "",
			tags: [],
		};

		let fetchMock: ReturnType<typeof vi.fn>;

		function getButton(testId: string): HTMLButtonElement {
			const button = container.querySelector(`[data-testid="${testId}"]`);
			if (!(button instanceof HTMLButtonElement)) {
				throw new Error(`${testId} not found`);
			}
			return button;
		}

		/** One SSE frame, then done — enough to drive the hook to a terminal state. */
		function streamResponse(text: string): Response {
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					const encoder = new TextEncoder();
					controller.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ text })}\n\n`));
					controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ code: 0 })}\n\n`));
					controller.close();
				},
			});
			return new Response(body, { status: 200 });
		}

		/** `done` with no preceding `delta` at all — a stream that produced nothing. */
		function emptyStreamResponse(): Response {
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					const encoder = new TextEncoder();
					controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ code: 0 })}\n\n`));
					controller.close();
				},
			});
			return new Response(body, { status: 200 });
		}

		beforeEach(() => {
			mockHtmlStatusQuery.mockResolvedValue({ online: true });
			mockHtmlTemplatesQuery.mockResolvedValue([TEMPLATE]);
			fetchMock = vi.fn().mockImplementation(() => Promise.resolve(streamResponse("<h1>New</h1>")));
			vi.stubGlobal("fetch", fetchMock);
		});

		afterEach(() => {
			vi.unstubAllGlobals();
		});

		it("keeps Refine disabled until generated HTML exists", async () => {
			await render(PLAN);
			await flush();
			await waitFor(() => !getButton("plan-html-generate-run").disabled, "loaded templates");

			expect(getButton("plan-html-refine-run").disabled).toBe(true);
		});

		it("refines from the existing HTML instead of regenerating it", async () => {
			mockListQuery.mockResolvedValue({ ok: true, plans: [PLAN, HTML_SIBLING] });
			await render(PLAN);
			await flush();
			await waitFor(() => !getButton("plan-html-refine-run").disabled, "enabled refine");

			await act(async () => {
				getButton("plan-html-refine-run").click();
			});

			expect(fetchMock).toHaveBeenCalledTimes(1);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe("/api/html/generate");
			expect(JSON.parse(init.body as string)).toMatchObject({
				templateId: TEMPLATE.id,
				planId: PLAN.id,
				editFromHtml: "<h1>Generated</h1>",
				editFromContent: "# Roadmap\n",
			});
		});

		it("generates without the edit pair on a first run", async () => {
			await render(PLAN);
			await flush();
			await waitFor(() => !getButton("plan-html-generate-run").disabled, "loaded templates");

			await act(async () => {
				getButton("plan-html-generate-run").click();
			});

			const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			const body = JSON.parse(init.body as string) as Record<string, unknown>;
			expect(body.editFromHtml).toBeUndefined();
			expect(body.editFromContent).toBeUndefined();
		});

		it("appends the expanded brief below the user's own notes", async () => {
			fetchMock.mockImplementation(() => Promise.resolve(streamResponse("# Brief\n\n## Goal\nShip it.")));
			await render(PLAN);
			await flush();
			await waitFor(() => !getButton("plan-html-brief-run").disabled, "enabled expand");

			await act(async () => {
				getButton("plan-html-brief-run").click();
			});
			await waitFor(
				() => getTextarea(container).value.includes("## Goal"),
				"brief appended to the raw pane",
			);

			expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/html/brief");
			const value = getTextarea(container).value;
			expect(value.startsWith("# Roadmap")).toBe(true);
			expect(value.indexOf("# Roadmap")).toBeLessThan(value.indexOf("# Brief"));
		});

		it("surfaces an error toast instead of a silent no-op when the brief finishes empty", async () => {
			fetchMock.mockImplementation(() => Promise.resolve(emptyStreamResponse()));
			await render(PLAN);
			await flush();
			await waitFor(() => !getButton("plan-html-brief-run").disabled, "enabled expand");

			await act(async () => {
				getButton("plan-html-brief-run").click();
			});
			await waitFor(
				() => mockShowAppToast.mock.calls.some((call) => call[0]?.message === HTML_LABELS.expandEmpty),
				"empty-brief toast",
			);

			expect(mockShowAppToast).toHaveBeenCalledWith({ intent: "danger", message: HTML_LABELS.expandEmpty });
			expect(getTextarea(container).value).toBe("# Roadmap\n");
		});

		it("surfaces an error toast instead of a silent no-op when generation finishes empty", async () => {
			fetchMock.mockImplementation(() => Promise.resolve(emptyStreamResponse()));
			await render(PLAN);
			await flush();
			await waitFor(() => !getButton("plan-html-generate-run").disabled, "loaded templates");

			await act(async () => {
				getButton("plan-html-generate-run").click();
			});
			await waitFor(
				() => mockShowAppToast.mock.calls.some((call) => call[0]?.message === HTML_LABELS.generateEmpty),
				"empty-generate toast",
			);

			expect(mockShowAppToast).toHaveBeenCalledWith({ intent: "danger", message: HTML_LABELS.generateEmpty });
			expect(mockWriteSiblingMutate).not.toHaveBeenCalled();
		});

		it("does not leak a completed brief into the next plan after switching", async () => {
			fetchMock.mockImplementation(() =>
				Promise.resolve(streamResponse("# Brief\n\n## Goal\nShip it.")),
			);
			await render(PLAN);
			await flush();
			await waitFor(() => !getButton("plan-html-brief-run").disabled, "enabled expand");

			await act(async () => {
				getButton("plan-html-brief-run").click();
			});
			await waitFor(
				() => getTextarea(container).value.includes("## Goal"),
				"brief appended to plan 1",
			);

			// Same component instance, just a new `plan` prop — mirrors switching plans
			// without a remount, which is exactly the shape of the original bug.
			await render(PLAN2);
			await flush();
			await waitFor(
				() => getTextarea(container).value === "# Plan 2\n",
				"plan 2 content loaded without the old brief",
			);

			expect(getTextarea(container).value).not.toContain("## Goal");

			// Let any pending autosave fire so a leaked write would actually surface.
			await act(async () => {
				await new Promise((resolveWait) => setTimeout(resolveWait, 600));
			});

			expect(
				mockWriteMutate.mock.calls.some(
					(call) =>
						(call[0] as { planId?: string; content?: string })?.planId === PLAN2.id &&
						(call[0] as { content?: string })?.content?.includes("## Goal"),
				),
			).toBe(false);
		});

		it("does not write a generated-HTML sibling for the next plan using the old plan's HTML", async () => {
			mockListQuery.mockResolvedValue({ ok: true, plans: [PLAN, HTML_SIBLING] });
			fetchMock.mockImplementation(() => Promise.resolve(streamResponse("<h1>Old plan HTML</h1>")));
			await render(PLAN);
			await flush();
			await waitFor(() => !getButton("plan-html-generate-run").disabled, "loaded templates");

			await act(async () => {
				getButton("plan-html-generate-run").click();
			});
			await waitFor(
				() => mockWriteSiblingMutate.mock.calls.length > 0,
				"sibling written for plan 1",
			);
			mockWriteSiblingMutate.mockClear();

			await render(PLAN2);
			await flush();
			await waitFor(
				() => getTextarea(container).value === "# Plan 2\n",
				"plan 2 content loaded without the old HTML",
			);

			expect(mockWriteSiblingMutate).not.toHaveBeenCalled();
			expect(container.querySelector('[data-testid="plan-editor-html-preview"]')).toBeNull();
		});

		it("expands even while the template sidecar is offline", async () => {
			mockHtmlStatusQuery.mockResolvedValue({ online: false });
			mockHtmlTemplatesQuery.mockResolvedValue([]);
			await render(PLAN);
			await flush();

			expect(getButton("plan-html-brief-run").disabled).toBe(false);
			expect(getButton("plan-html-generate-run").disabled).toBe(true);
		});
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

	it("shows an empty-file hint in the rendered pane when the successfully-loaded document is empty", async () => {
		mockReadQuery.mockResolvedValue({ ok: true, plan: PLAN, content: "" });
		await render(PLAN);
		await flush();
		await waitFor(
			() => container.textContent?.includes("This plan file is empty.") === true,
			"empty file message",
		);

		expect(container.querySelector('[data-testid="plan-rich-editor"]')).toBeNull();
		expect(container.textContent).toContain("This plan file is empty.");

		// Typing a character should dismiss the message by re-rendering the rich editor
		await act(async () => {
			setTextareaValue(getTextarea(container), "x");
		});
		// The rendered pane debounces for 250ms, so wait for it to catch up
		await act(async () => {
			await new Promise((resolveWait) => setTimeout(resolveWait, 300));
		});

		expect(container.querySelector('[data-testid="plan-rich-editor"]')).not.toBeNull();
		expect(container.textContent?.includes("This plan file is empty.")).toBe(false);
	});
});
