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
const mockWriteBackupMutate = vi.fn();
const mockListQuery = vi.fn();
const mockWriteSiblingMutate = vi.fn();
const mockReadHtmlSourceQuery = vi.fn();
const mockWriteHtmlSourceMutate = vi.fn();
const mockHtmlStatusQuery = vi.fn();
const mockHtmlTemplatesQuery = vi.fn();

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		plans: {
			read: { query: mockReadQuery },
			write: { mutate: mockWriteMutate },
			writeAsset: { mutate: mockWriteAssetMutate },
			writeBackup: { mutate: mockWriteBackupMutate },
			writeSibling: { mutate: mockWriteSiblingMutate },
			readHtmlSource: { query: mockReadHtmlSourceQuery },
			writeHtmlSource: { mutate: mockWriteHtmlSourceMutate },
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
		mockWriteBackupMutate.mockReset().mockResolvedValue({ ok: true, path: "/tmp/roadmap.bak-1.md" });
		mockWriteSiblingMutate.mockReset().mockResolvedValue({ ok: true, plan: HTML_SIBLING, isNew: true });
		// No recorded base by default — the shape a plan whose HTML predates snapshotting has.
		mockReadHtmlSourceQuery.mockReset().mockResolvedValue({ ok: true, content: null });
		mockWriteHtmlSourceMutate.mockReset().mockResolvedValue({ ok: true, path: "/tmp/roadmap.html.src.md" });
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

	it("recovers autosave after a single failed save instead of getting stuck", async () => {
		await render(PLAN);
		await flush();
		await waitFor(() => container.textContent?.includes("Saved") === true, "saved status");

		mockWriteMutate.mockRejectedValueOnce(new Error("disk full"));

		await act(async () => {
			setTextareaValue(getTextarea(container), "# Roadmap\n\nFirst edit");
		});
		await act(async () => {
			await new Promise((resolveWait) => setTimeout(resolveWait, 600));
		});
		expect(mockWriteMutate).toHaveBeenCalledWith({ planId: "plan-1", content: "# Roadmap\n\nFirst edit" });
		await waitFor(() => container.textContent?.includes("disk full") === true, "error status");

		mockWriteMutate.mockResolvedValue({ ok: true, plan: PLAN });

		// The bug: once `status` flips to "error" after a failed *save*, every later
		// `updateContent` call must still reach the write mutation on the next keystroke
		// — a failed autosave must not permanently block future saves.
		await act(async () => {
			setTextareaValue(getTextarea(container), "# Roadmap\n\nSecond edit");
		});
		await act(async () => {
			await new Promise((resolveWait) => setTimeout(resolveWait, 600));
		});

		expect(mockWriteMutate).toHaveBeenCalledWith({ planId: "plan-1", content: "# Roadmap\n\nSecond edit" });
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

		/** Long enough that a hunk is cheaper than shipping the document twice. */
		const RECORDED_BASE = [
			"# Roadmap",
			"",
			"## Q1",
			"Ship the editor, with the split pane, the toolbar and image paste.",
			"",
			"## Q2",
			"Ship the dashboard. Operations wants per-team throughput.",
			"",
			"## Risks",
			"The sidecar has to be running for any HTML pass to work.",
		].join("\n");

		it("refines with a diff of the notes against the recorded base, not the whole document", async () => {
			mockListQuery.mockResolvedValue({ ok: true, plans: [PLAN, HTML_SIBLING] });
			mockReadHtmlSourceQuery.mockResolvedValue({ ok: true, content: RECORDED_BASE });
			mockReadQuery.mockImplementation(({ planId }: { planId: string }) =>
				Promise.resolve(
					planId === HTML_SIBLING.id
						? { ok: true, plan: HTML_SIBLING, content: "<h1>Generated</h1>" }
						: { ok: true, plan: PLAN, content: RECORDED_BASE },
				),
			);
			await render(PLAN);
			await flush();
			await waitFor(() => !getButton("plan-html-refine-run").disabled, "enabled refine");

			await act(async () => {
				setTextareaValue(
					getTextarea(container),
					RECORDED_BASE.replace("Operations wants per-team throughput.", "Operations wants a weekly rollup."),
				);
			});
			await act(async () => {
				getButton("plan-html-refine-run").click();
			});

			expect(fetchMock).toHaveBeenCalledTimes(1);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe("/api/html/generate");
			const body = JSON.parse(init.body as string) as Record<string, unknown>;
			expect(body).toMatchObject({
				templateId: TEMPLATE.id,
				planId: PLAN.id,
				editFromHtml: "<h1>Generated</h1>",
			});
			expect(body.editFromContent).toBeUndefined();
			expect(body.editDiff).toContain("-Ship the dashboard. Operations wants per-team throughput.");
			expect(body.editDiff).toContain("+Ship the dashboard. Operations wants a weekly rollup.");
			// Cheaper than the full path, which ships both versions of the requirement.
			expect((body.editDiff as string).length).toBeLessThan(RECORDED_BASE.length * 2);
		});

		it("refuses to spend a run when the notes have not changed since the HTML was generated", async () => {
			mockListQuery.mockResolvedValue({ ok: true, plans: [PLAN, HTML_SIBLING] });
			mockReadHtmlSourceQuery.mockResolvedValue({ ok: true, content: "# Roadmap\n" });
			await render(PLAN);
			await flush();
			await waitFor(() => !getButton("plan-html-refine-run").disabled, "enabled refine");

			await act(async () => {
				getButton("plan-html-refine-run").click();
			});

			expect(fetchMock).not.toHaveBeenCalled();
			expect(mockShowAppToast).toHaveBeenCalledWith(
				expect.objectContaining({ message: HTML_LABELS.refineUnchanged }),
			);
		});

		it("falls back to the full document when nothing was recorded for the existing HTML", async () => {
			mockListQuery.mockResolvedValue({ ok: true, plans: [PLAN, HTML_SIBLING] });
			await render(PLAN);
			await flush();
			await waitFor(() => !getButton("plan-html-refine-run").disabled, "enabled refine");

			await act(async () => {
				getButton("plan-html-refine-run").click();
			});

			const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			const body = JSON.parse(init.body as string) as Record<string, unknown>;
			expect(body.editDiff).toBeUndefined();
			expect(body.editFromContent).toBe("# Roadmap\n");
			expect(mockShowAppToast).toHaveBeenCalledWith(
				expect.objectContaining({ message: HTML_LABELS.refineNoBase }),
			);
		});

		it("records the generating markdown only once the HTML is actually saved", async () => {
			await render(PLAN);
			await flush();
			await waitFor(() => !getButton("plan-html-generate-run").disabled, "loaded templates");

			mockWriteSiblingMutate.mockResolvedValueOnce({ ok: false, plan: null, error: "disk full" });
			await act(async () => {
				getButton("plan-html-generate-run").click();
			});
			await flush();
			expect(mockWriteHtmlSourceMutate).not.toHaveBeenCalled();

			await act(async () => {
				getButton("plan-html-generate-run").click();
			});
			await waitFor(() => mockWriteHtmlSourceMutate.mock.calls.length > 0, "recorded html source");

			expect(mockWriteHtmlSourceMutate).toHaveBeenCalledWith({ planId: PLAN.id, content: "# Roadmap\n" });
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

		/** The shape a compliant expansion returns: reorganized plan, then the brief. */
		const REWRITE_ANSWER = [
			"# Plan",
			"",
			"## Context",
			"![shot](roadmap.assets/pasted-1.png)",
			"",
			"*Shows a pie chart labeled Revenue Q3.*",
			"",
			"# Brief",
			"",
			"## Goal",
			"Ship it.",
		].join("\n");

		it("replaces the plan with the reorganized version once the previous bytes are backed up", async () => {
			fetchMock.mockImplementation(() => Promise.resolve(streamResponse(REWRITE_ANSWER)));
			await render(PLAN);
			await flush();
			await waitFor(() => !getButton("plan-html-brief-run").disabled, "enabled expand");

			await act(async () => {
				getButton("plan-html-brief-run").click();
			});
			await waitFor(() => getTextarea(container).value.includes("## Goal"), "rewritten raw pane");

			expect(mockWriteBackupMutate).toHaveBeenCalledWith({ planId: PLAN.id });
			const value = getTextarea(container).value;
			// The user's original heading is gone — replaced, not appended to.
			expect(value.startsWith("# Plan")).toBe(true);
			expect(value).not.toContain("# Roadmap");
			expect(value).toContain("![shot](roadmap.assets/pasted-1.png)");
			expect(value).toContain("*Shows a pie chart labeled Revenue Q3.*");
			expect(value.indexOf("# Plan")).toBeLessThan(value.indexOf("# Brief"));
		});

		it("restores the previous text when the rewrite toast's Undo is used", async () => {
			fetchMock.mockImplementation(() => Promise.resolve(streamResponse(REWRITE_ANSWER)));
			await render(PLAN);
			await flush();
			await waitFor(() => !getButton("plan-html-brief-run").disabled, "enabled expand");

			await act(async () => {
				getButton("plan-html-brief-run").click();
			});
			await waitFor(() => getTextarea(container).value.includes("## Goal"), "rewritten raw pane");

			const rewriteToast = mockShowAppToast.mock.calls
				.map((call) => call[0] as { message?: string; action?: { label: string; onClick: () => void } })
				.find((toast) => toast?.message === HTML_LABELS.expandRewrote);
			expect(rewriteToast?.action?.label).toBe("Undo");

			await act(async () => {
				rewriteToast?.action?.onClick();
			});

			expect(getTextarea(container).value).toBe("# Roadmap\n");
		});

		it("leaves the plan untouched when the backup fails", async () => {
			fetchMock.mockImplementation(() => Promise.resolve(streamResponse(REWRITE_ANSWER)));
			mockWriteBackupMutate.mockResolvedValue({ ok: false, path: null, error: "read-only volume" });
			await render(PLAN);
			await flush();
			await waitFor(() => !getButton("plan-html-brief-run").disabled, "enabled expand");

			await act(async () => {
				getButton("plan-html-brief-run").click();
			});
			await waitFor(
				() => mockShowAppToast.mock.calls.some((call) => call[0]?.message === "read-only volume"),
				"backup failure toast",
			);

			expect(getTextarea(container).value).toBe("# Roadmap\n");
			expect(
				mockWriteMutate.mock.calls.some((call) =>
					(call[0] as { content?: string })?.content?.includes("## Goal"),
				),
			).toBe(false);
		});

		it("falls back to appending when the answer has no reorganized plan section", async () => {
			fetchMock.mockImplementation(() => Promise.resolve(streamResponse("# Brief\n\n## Goal\nShip it.")));
			await render(PLAN);
			await flush();
			await waitFor(() => !getButton("plan-html-brief-run").disabled, "enabled expand");

			await act(async () => {
				getButton("plan-html-brief-run").click();
			});
			await waitFor(() => getTextarea(container).value.includes("## Goal"), "appended brief");

			// A malformed answer must never trigger a destructive overwrite.
			expect(mockWriteBackupMutate).not.toHaveBeenCalled();
			expect(getTextarea(container).value.startsWith("# Roadmap")).toBe(true);
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

			// `render()` applies `key={plan.id}` (see above), so this switch to PLAN2 is a
			// key-driven remount — matching production, where App.tsx's own
			// `key={editingPlan.id}` remounts PlanEditorView on every plan switch.
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

		it("aborts an in-flight generate request when the editor unmounts mid-stream", async () => {
			let capturedSignal: AbortSignal | undefined;
			fetchMock.mockImplementation((_url: string, init: RequestInit) => {
				capturedSignal = init.signal as AbortSignal;
				// A stream that never enqueues or closes — stands in for a request still
				// running server-side when the plan switch (or close) unmounts this component.
				const body = new ReadableStream<Uint8Array>({ start() {} });
				return Promise.resolve(new Response(body, { status: 200 }));
			});
			await render(PLAN);
			await flush();
			await waitFor(() => !getButton("plan-html-generate-run").disabled, "loaded templates");

			await act(async () => {
				getButton("plan-html-generate-run").click();
			});
			await flush();

			expect(capturedSignal).toBeDefined();
			expect(capturedSignal?.aborted).toBe(false);

			// Regression: with `key={editingPlan.id}` (App.tsx) remounting PlanEditorView on
			// every plan switch, `reset()`'s abort never runs on a live switch — only an
			// unmount-time abort inside the hook itself catches this in-flight request.
			await act(async () => {
				root.unmount();
			});

			expect(capturedSignal?.aborted).toBe(true);
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

	describe("AI prompt bar", () => {
		let fetchMock: ReturnType<typeof vi.fn>;

		/** One SSE frame, then done — enough to drive the draft hook to a terminal state. */
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

		function getBar(): HTMLElement {
			const bar = container.querySelector('[data-testid="plan-ai-prompt-bar"]');
			if (!(bar instanceof HTMLElement)) {
				throw new Error("prompt bar not found");
			}
			return bar;
		}

		async function submit(instruction: string): Promise<void> {
			const input = container.querySelector('[data-testid="plan-ai-prompt-input"]');
			const button = container.querySelector('[data-testid="plan-ai-prompt-submit"]');
			if (!(input instanceof HTMLInputElement) || !(button instanceof HTMLButtonElement)) {
				throw new Error("prompt bar controls not found");
			}
			const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
			await act(async () => {
				setter?.call(input, instruction);
				input.dispatchEvent(new Event("input", { bubbles: true }));
			});
			await act(async () => {
				button.click();
			});
		}

		beforeEach(() => {
			fetchMock = vi.fn().mockImplementation(() => Promise.resolve(streamResponse("Drafted line.")));
			vi.stubGlobal("fetch", fetchMock);
		});

		afterEach(() => {
			vi.unstubAllGlobals();
		});

		it("appends a draft below the notes when nothing is selected", async () => {
			await render(PLAN);
			await flush();
			await waitFor(() => getTextarea(container).value === "# Roadmap\n", "loaded content");

			await submit("draft a risks section");
			await waitFor(
				() => getTextarea(container).value.includes("Drafted line."),
				"draft spliced into the raw pane",
			);

			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe("/api/html/draft");
			const body = JSON.parse(init.body as string) as Record<string, unknown>;
			expect(body).toMatchObject({
				planId: PLAN.id,
				instruction: "draft a risks section",
				context: "# Roadmap\n",
			});
			expect(body.selection).toBeUndefined();
			expect(getTextarea(container).value).toBe("# Roadmap\n\nDrafted line.");
			expect(getBar().dataset.mode).toBe("draft");
		});

		it("replaces the raw-pane selection instead of appending", async () => {
			await render(PLAN);
			await flush();
			await waitFor(() => getTextarea(container).value === "# Roadmap\n", "loaded content");

			const textarea = getTextarea(container);
			// React emulates onSelect through its SelectEventPlugin (focus + keyup/mouseup),
			// so a bare `select` event would not reach the handler.
			await act(async () => {
				textarea.focus();
				textarea.setSelectionRange(2, 9);
				textarea.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
			});
			expect(getBar().dataset.mode).toBe("edit");

			await submit("make it shorter");
			await waitFor(
				() => getTextarea(container).value.includes("Drafted line."),
				"rewrite spliced into the raw pane",
			);

			const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(JSON.parse(init.body as string)).toMatchObject({ selection: "Roadmap" });
			expect(getTextarea(container).value).toBe("# Drafted line.\n");
		});

		it("restores the previous text when the draft toast's Undo is used", async () => {
			await render(PLAN);
			await flush();
			await waitFor(() => getTextarea(container).value === "# Roadmap\n", "loaded content");

			await submit("draft a risks section");
			await waitFor(
				() => getTextarea(container).value.includes("Drafted line."),
				"draft spliced into the raw pane",
			);

			const draftToast = mockShowAppToast.mock.calls
				.map((call) => call[0] as { message?: string; action?: { label: string; onClick: () => void } })
				.find((toast) => toast?.message === HTML_LABELS.aiDraftDone);
			expect(draftToast?.action?.label).toBe("Undo");

			await act(async () => {
				draftToast?.action?.onClick();
			});

			expect(getTextarea(container).value).toBe("# Roadmap\n");
		});

		it("leaves the notes untouched when the run finishes empty", async () => {
			fetchMock.mockImplementation(() => {
				const body = new ReadableStream<Uint8Array>({
					start(controller) {
						const encoder = new TextEncoder();
						controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ code: 0 })}\n\n`));
						controller.close();
					},
				});
				return Promise.resolve(new Response(body, { status: 200 }));
			});
			await render(PLAN);
			await flush();
			await waitFor(() => getTextarea(container).value === "# Roadmap\n", "loaded content");

			await submit("draft a risks section");
			await waitFor(
				() => mockShowAppToast.mock.calls.some((call) => call[0]?.message === HTML_LABELS.aiEmpty),
				"empty-draft toast",
			);

			// Including the blank-line separator the draft run wrote before streaming.
			expect(getTextarea(container).value).toBe("# Roadmap\n");
		});

		it("is hidden on the HTML source and on an HTML plan", async () => {
			mockListQuery.mockResolvedValue({ ok: true, plans: [PLAN, HTML_SIBLING] });
			await render(PLAN);
			await flush();
			await waitFor(() => !getHtmlSwitchButton(container).disabled, "enabled HTML switch");
			expect(container.querySelector('[data-testid="plan-ai-prompt-bar"]')).not.toBeNull();

			await act(async () => {
				getHtmlSwitchButton(container).click();
			});

			expect(container.querySelector('[data-testid="plan-ai-prompt-bar"]')).toBeNull();
		});
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

	describe("template rail", () => {
		const RAIL_TEMPLATES = [
			{
				id: "papp-status-grid",
				zhName: "",
				enName: "Papp Asset Status Grid",
				emoji: "🟩",
				description: "",
				category: "dashboard",
				scenario: "engineering",
				aspectHint: "Desktop 1440",
				recommended: 3,
				tags: [],
				example: { hasHtml: true, hasMd: true },
			},
			{
				id: "papp-overview",
				zhName: "",
				enName: "Papp Overview Dashboard",
				emoji: "🏭",
				description: "",
				category: "dashboard",
				scenario: "engineering",
				aspectHint: "Desktop 1440",
				recommended: 1,
				tags: [],
				example: { hasHtml: true, hasMd: true },
			},
		];

		function cards(): HTMLButtonElement[] {
			return Array.from(container.querySelectorAll<HTMLButtonElement>('[data-testid^="plan-template-card-"]'));
		}

		beforeEach(() => {
			mockHtmlStatusQuery.mockResolvedValue({ online: true });
			mockHtmlTemplatesQuery.mockResolvedValue(RAIL_TEMPLATES);
		});

		it("lists a card per template in recommended order and preselects the top-ranked one", async () => {
			await render(PLAN);
			await flush();
			await waitFor(() => cards().length === 2, "template cards");

			expect(cards().map((card) => card.dataset.testid)).toEqual([
				"plan-template-card-papp-overview",
				"plan-template-card-papp-status-grid",
			]);
			// Registry order puts status-grid first; `recommended` is what should win.
			expect(cards()[0]?.getAttribute("aria-pressed")).toBe("true");
			expect(cards()[1]?.getAttribute("aria-pressed")).toBe("false");
		});

		it("renders each thumbnail from the sidecar preview route", async () => {
			await render(PLAN);
			await flush();
			await waitFor(() => cards().length === 2, "template cards");

			const frame = container.querySelector<HTMLIFrameElement>(
				'[data-testid="plan-template-card-papp-overview"] iframe',
			);
			expect(frame?.getAttribute("src")).toBe("/api/html-proxy/api/templates/papp-overview/preview");
		});

		it("sends the card the user picked as the generate template", async () => {
			const fetchMock = vi.fn().mockImplementation(() => {
				const body = new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(new TextEncoder().encode(`event: done\ndata: ${JSON.stringify({ code: 0 })}\n\n`));
						controller.close();
					},
				});
				return Promise.resolve(new Response(body, { status: 200 }));
			});
			vi.stubGlobal("fetch", fetchMock);
			try {
				await render(PLAN);
				await flush();
				await waitFor(() => cards().length === 2, "template cards");

				await act(async () => {
					cards()[1]?.click();
				});
				await act(async () => {
					const run = container.querySelector('[data-testid="plan-html-generate-run"]');
					(run as HTMLButtonElement).click();
				});

				const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
				expect(url).toBe("/api/html/generate");
				expect(JSON.parse(init.body as string)).toMatchObject({ templateId: "papp-status-grid" });
			} finally {
				vi.unstubAllGlobals();
			}
		});

		it("drops the rail for a plan that is already HTML", async () => {
			await render(HTML_PLAN);
			await flush();

			expect(container.querySelector('[data-testid="plan-template-rail"]')).toBeNull();
		});
	});
});
