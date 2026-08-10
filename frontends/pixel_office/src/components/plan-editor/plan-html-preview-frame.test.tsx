import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	PlanHtmlPreviewFrame,
	type PlanHtmlPreviewMode,
	PREVIEW_STREAM_DEBOUNCE_MS,
} from "@/components/plan-editor/plan-html-preview-frame";

const ACCEPTED = "<html><head><title>Accepted</title></head><body>accepted</body></html>";

/** A streamed document that has got far enough to be worth rendering. */
function streamed(marker: string): string {
	return `<html><head><title>Streaming</title></head><body>${marker}</body></html>`;
}

describe("PlanHtmlPreviewFrame", () => {
	let container: HTMLDivElement;
	let root: Root;

	function render(props: {
		html: string;
		fallbackHtml: string;
		streaming: boolean;
		mode: PlanHtmlPreviewMode;
	}): Promise<void> {
		return act(async () => {
			root.render(<PlanHtmlPreviewFrame {...props} planId="plan-1" />);
		});
	}

	function srcDoc(): string {
		const frame = container.querySelector('[data-testid="plan-editor-html-preview"]');
		if (!(frame instanceof HTMLIFrameElement)) {
			throw new Error("preview iframe not found");
		}
		return frame.srcdoc;
	}

	beforeEach(() => {
		vi.useFakeTimers();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		vi.useRealTimers();
	});

	it("throttles streamed updates instead of reloading the iframe per delta", async () => {
		await render({ html: "", fallbackHtml: "", streaming: true, mode: "debounce" });

		// First complete-enough frame renders straight away, then the throttle closes.
		await render({ html: streamed("one"), fallbackHtml: "", streaming: true, mode: "debounce" });
		expect(srcDoc()).toContain("one");

		await render({ html: streamed("two"), fallbackHtml: "", streaming: true, mode: "debounce" });
		await render({ html: streamed("three"), fallbackHtml: "", streaming: true, mode: "debounce" });
		expect(srcDoc()).toContain("one");

		await act(async () => {
			await vi.advanceTimersByTimeAsync(PREVIEW_STREAM_DEBOUNCE_MS);
		});
		expect(srcDoc()).toContain("three");
	});

	it("withholds a partial document until its head is closed", async () => {
		await render({ html: "", fallbackHtml: "", streaming: true, mode: "debounce" });

		await render({ html: "<html><head><link rel=", fallbackHtml: "", streaming: true, mode: "debounce" });
		await act(async () => {
			await vi.advanceTimersByTimeAsync(PREVIEW_STREAM_DEBOUNCE_MS * 2);
		});

		expect(srcDoc()).not.toContain("<link");
	});

	it("holds the accepted document for the whole run in hold mode, then swaps once", async () => {
		await render({ html: ACCEPTED, fallbackHtml: ACCEPTED, streaming: false, mode: "hold" });
		expect(srcDoc()).toContain("accepted");

		await render({ html: streamed("refined"), fallbackHtml: ACCEPTED, streaming: true, mode: "hold" });
		await act(async () => {
			await vi.advanceTimersByTimeAsync(PREVIEW_STREAM_DEBOUNCE_MS * 4);
		});
		expect(srcDoc()).toContain("accepted");
		expect(srcDoc()).not.toContain("refined");

		await render({ html: streamed("refined"), fallbackHtml: ACCEPTED, streaming: false, mode: "hold" });
		expect(srcDoc()).toContain("refined");
	});

	it("keeps the last document on screen when an empty one arrives", async () => {
		// The gap right after a save: the sibling is re-read from disk and is briefly "".
		await render({ html: ACCEPTED, fallbackHtml: ACCEPTED, streaming: false, mode: "debounce" });
		expect(srcDoc()).toContain("accepted");

		await render({ html: "", fallbackHtml: "", streaming: false, mode: "debounce" });

		expect(srcDoc()).toContain("accepted");
	});

	it("injects the per-plan base href so relative images resolve", async () => {
		await render({ html: ACCEPTED, fallbackHtml: ACCEPTED, streaming: false, mode: "debounce" });

		expect(srcDoc()).toContain('<base href="/api/plans/plan-1/file/">');
	});
});
