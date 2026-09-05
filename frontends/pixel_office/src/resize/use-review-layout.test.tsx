import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	clampReviewClaudePanelWidth,
	clampReviewDescriptionHeight,
	clampReviewSidebarWidth,
	clampReviewStackHeight,
	MIN_REVIEW_CLAUDE_PANEL_WIDTH,
	MIN_REVIEW_DESCRIPTION_HEIGHT,
	MIN_REVIEW_DIFF_WIDTH,
	MIN_REVIEW_DRAFTS_HEIGHT,
	MIN_REVIEW_SIDEBAR_WIDTH,
	MIN_REVIEW_TRANSCRIPT_HEIGHT,
	REVIEW_CLAUDE_PANEL_CHROME_HEIGHT,
	REVIEW_COLUMN_SEPARATOR_COUNT,
	REVIEW_WORKSPACE_RESERVED_HEIGHT,
	type ReviewLayout,
	useReviewLayout,
} from "@/resize/use-review-layout";
import { LocalStorageKey } from "@/storage/local-storage-store";

describe("clampReviewSidebarWidth", () => {
	it("leaves the diff pane and the Claude column their minimums", () => {
		const containerWidth = 1400;
		const claudePanelWidth = 384;
		expect(clampReviewSidebarWidth(1000, containerWidth, claudePanelWidth)).toBe(
			containerWidth - claudePanelWidth - MIN_REVIEW_DIFF_WIDTH - REVIEW_COLUMN_SEPARATOR_COUNT,
		);
	});

	it("holds the sidebar at its own minimum", () => {
		expect(clampReviewSidebarWidth(40, 1400, 384)).toBe(MIN_REVIEW_SIDEBAR_WIDTH);
	});

	it("floors at the minimum rather than going negative in a container too small for anyone", () => {
		expect(clampReviewSidebarWidth(300, 500, 384)).toBe(MIN_REVIEW_SIDEBAR_WIDTH);
	});

	// A zero width is `useMeasure` before its first observation — and permanently in
	// jsdom. Clamping against it would snap every column to its minimum on first paint.
	it.each([null, 0])("treats an unmeasured container (%s) as no constraint", (containerWidth) => {
		expect(clampReviewSidebarWidth(500, containerWidth, 384)).toBe(500);
	});
});

describe("clampReviewClaudePanelWidth", () => {
	it("leaves the diff pane and the sidebar their minimums", () => {
		const containerWidth = 1400;
		const sidebarWidth = 320;
		expect(clampReviewClaudePanelWidth(2000, containerWidth, sidebarWidth)).toBe(
			containerWidth - sidebarWidth - MIN_REVIEW_DIFF_WIDTH - REVIEW_COLUMN_SEPARATOR_COUNT,
		);
	});

	it("holds the Claude column at its own minimum", () => {
		expect(clampReviewClaudePanelWidth(40, 1400, 320)).toBe(MIN_REVIEW_CLAUDE_PANEL_WIDTH);
	});
});

describe("clampReviewStackHeight", () => {
	const panelHeight = 800;

	it("leaves the transcript and the panel's own furniture their space", () => {
		const otherSectionsHeight = 272;
		expect(
			clampReviewStackHeight({
				height: 1000,
				minHeight: MIN_REVIEW_DRAFTS_HEIGHT,
				panelHeight,
				otherSectionsHeight,
			}),
		).toBe(panelHeight - otherSectionsHeight - MIN_REVIEW_TRANSCRIPT_HEIGHT - REVIEW_CLAUDE_PANEL_CHROME_HEIGHT);
	});

	// The rule that makes an unmounted row cost nothing: callers pass 0 for a section
	// that is not on screen, and the remaining rows get exactly that space back.
	it("gives a row the space an absent sibling is not using", () => {
		const withSibling = clampReviewStackHeight({
			height: 1000,
			minHeight: MIN_REVIEW_DRAFTS_HEIGHT,
			panelHeight,
			otherSectionsHeight: 224,
		});
		const withoutSibling = clampReviewStackHeight({
			height: 1000,
			minHeight: MIN_REVIEW_DRAFTS_HEIGHT,
			panelHeight,
			otherSectionsHeight: 0,
		});
		expect(withoutSibling - withSibling).toBe(224);
	});

	it("floors at the row's minimum when the panel cannot hold it", () => {
		expect(
			clampReviewStackHeight({
				height: 1000,
				minHeight: MIN_REVIEW_DRAFTS_HEIGHT,
				panelHeight: 300,
				otherSectionsHeight: 272,
			}),
		).toBe(MIN_REVIEW_DRAFTS_HEIGHT);
	});

	it.each([null, 0])("treats an unmeasured panel (%s) as no constraint", (unmeasured) => {
		expect(
			clampReviewStackHeight({
				height: 400,
				minHeight: MIN_REVIEW_DRAFTS_HEIGHT,
				panelHeight: unmeasured,
				otherSectionsHeight: 272,
			}),
		).toBe(400);
	});
});

describe("clampReviewDescriptionHeight", () => {
	it("leaves the header and a usable columns row below it", () => {
		expect(clampReviewDescriptionHeight(1000, 900)).toBe(900 - REVIEW_WORKSPACE_RESERVED_HEIGHT);
	});

	it("holds the body at its own minimum", () => {
		expect(clampReviewDescriptionHeight(10, 900)).toBe(MIN_REVIEW_DESCRIPTION_HEIGHT);
	});

	it("treats an unmeasured workspace as no constraint", () => {
		expect(clampReviewDescriptionHeight(400, null)).toBe(400);
	});
});

describe("useReviewLayout", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		window.localStorage.clear();
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		window.localStorage.clear();
	});

	function renderLayout(options: {
		claudePanelHeight: number | null;
		hasFindings: boolean;
		hasDrafts: boolean;
	}): ReviewLayout {
		let layout: ReviewLayout | null = null;
		function Probe(): null {
			layout = useReviewLayout({
				containerWidth: 1400,
				workspaceHeight: 900,
				...options,
			});
			return null;
		}
		act(() => root.render(<Probe />));
		if (!layout) {
			throw new Error("The layout hook did not render.");
		}
		return layout;
	}

	it("hands the drafts row the space an unmounted findings row is not using", () => {
		// Dragged past what the column can hold, so both renders sit on the clamp and the
		// difference between them is exactly the space the findings row stopped reserving.
		window.localStorage.setItem(LocalStorageKey.ReviewDraftsHeight, "5000");

		const withFindings = renderLayout({ claudePanelHeight: 900, hasFindings: true, hasDrafts: true });
		const heightWithFindings = withFindings.displayDraftsHeight;
		const findingsHeight = withFindings.findingsHeight;

		const withoutFindings = renderLayout({ claudePanelHeight: 900, hasFindings: false, hasDrafts: true });

		expect(withoutFindings.displayDraftsHeight - heightWithFindings).toBe(findingsHeight);
	});

	it("starts on the sizes this screen was hard-coded to before it was resizable", () => {
		const layout = renderLayout({ claudePanelHeight: null, hasFindings: true, hasDrafts: true });
		expect(layout.sidebarWidth).toBe(320);
		expect(layout.claudePanelWidth).toBe(384);
		expect(layout.findingsHeight).toBe(224);
		expect(layout.draftsHeight).toBe(128);
		expect(layout.composerHeight).toBe(48);
		expect(layout.descriptionHeight).toBe(224);
	});
});
