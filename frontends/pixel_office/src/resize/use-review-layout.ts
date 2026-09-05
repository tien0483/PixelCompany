import { useCallback, useMemo, useState } from "react";

import { useLayoutResetEffect } from "@/resize/layout-customizations";
import { clampAtLeast, clampSizeToContainer } from "@/resize/resize-persistence";
import {
	getResizePreferenceDefaultValue,
	loadResizePreference,
	persistResizePreference,
	type ResizeNumberPreference,
} from "@/resize/resize-preferences";
import { LocalStorageKey } from "@/storage/local-storage-store";

/**
 * Every pane size in the review workspace.
 *
 * Defaults are exactly the sizes this screen was hard-coded to before it became
 * resizable (`w-80`, `w-96`, `max-h-56`, `max-h-32`, `rows={2}`), so a reviewer who
 * never touches a handle sees no change.
 */

export const MIN_REVIEW_SIDEBAR_WIDTH = 220;
export const MIN_REVIEW_CLAUDE_PANEL_WIDTH = 300;
export const MIN_REVIEW_DIFF_WIDTH = 360;
/** The two vertical handles between the three columns, one pixel each. */
export const REVIEW_COLUMN_SEPARATOR_COUNT = 2;

export const MIN_REVIEW_FINDINGS_HEIGHT = 80;
export const MIN_REVIEW_DRAFTS_HEIGHT = 64;
export const MIN_REVIEW_COMPOSER_HEIGHT = 44;
/** The transcript is the elastic remainder, and it is never allowed to vanish. */
export const MIN_REVIEW_TRANSCRIPT_HEIGHT = 120;
/**
 * The Claude column's intrinsic furniture — panel header, the inline-prompt row, the
 * composer's chips and footer, each section's own title bar. An estimate rather than a
 * measurement: it is only used to stop a drag from claiming space that furniture holds,
 * and the sections are `flex-shrink: 1`, so an underestimate costs a little scroll
 * rather than a clipped control.
 */
export const REVIEW_CLAUDE_PANEL_CHROME_HEIGHT = 200;

export const MIN_REVIEW_DESCRIPTION_HEIGHT = 80;
/** What the description may not eat: the workspace header plus a usable columns row. */
export const REVIEW_WORKSPACE_RESERVED_HEIGHT = 288;

const SIDEBAR_WIDTH_PREFERENCE: ResizeNumberPreference = {
	key: LocalStorageKey.ReviewSidebarWidth,
	defaultValue: 320,
	normalize: (value) => clampAtLeast(value, MIN_REVIEW_SIDEBAR_WIDTH, true),
};

const CLAUDE_PANEL_WIDTH_PREFERENCE: ResizeNumberPreference = {
	key: LocalStorageKey.ReviewClaudePanelWidth,
	defaultValue: 384,
	normalize: (value) => clampAtLeast(value, MIN_REVIEW_CLAUDE_PANEL_WIDTH, true),
};

const FINDINGS_HEIGHT_PREFERENCE: ResizeNumberPreference = {
	key: LocalStorageKey.ReviewFindingsHeight,
	defaultValue: 224,
	normalize: (value) => clampAtLeast(value, MIN_REVIEW_FINDINGS_HEIGHT, true),
};

const DRAFTS_HEIGHT_PREFERENCE: ResizeNumberPreference = {
	key: LocalStorageKey.ReviewDraftsHeight,
	defaultValue: 128,
	normalize: (value) => clampAtLeast(value, MIN_REVIEW_DRAFTS_HEIGHT, true),
};

const COMPOSER_HEIGHT_PREFERENCE: ResizeNumberPreference = {
	key: LocalStorageKey.ReviewComposerHeight,
	defaultValue: 48,
	normalize: (value) => clampAtLeast(value, MIN_REVIEW_COMPOSER_HEIGHT, true),
};

const DESCRIPTION_HEIGHT_PREFERENCE: ResizeNumberPreference = {
	key: LocalStorageKey.ReviewDescriptionHeight,
	defaultValue: 224,
	normalize: (value) => clampAtLeast(value, MIN_REVIEW_DESCRIPTION_HEIGHT, true),
};

/**
 * True once a container has actually been laid out. `useMeasure` reports zeros before
 * the first `ResizeObserver` callback — and permanently in jsdom, where the observer
 * does not exist — and clamping against a zero-width container would snap every pane
 * to its minimum on the first paint.
 */
function isMeasured(size: number | null): size is number {
	return size !== null && Number.isFinite(size) && size > 0;
}

export function clampReviewSidebarWidth(
	width: number,
	containerWidth: number | null,
	claudePanelWidth: number,
): number {
	if (!isMeasured(containerWidth)) {
		return clampAtLeast(width, MIN_REVIEW_SIDEBAR_WIDTH, true);
	}
	return clampSizeToContainer({
		size: width,
		minSize: MIN_REVIEW_SIDEBAR_WIDTH,
		containerSize: containerWidth,
		reservedSize: claudePanelWidth + MIN_REVIEW_DIFF_WIDTH + REVIEW_COLUMN_SEPARATOR_COUNT,
	});
}

export function clampReviewClaudePanelWidth(
	width: number,
	containerWidth: number | null,
	sidebarWidth: number,
): number {
	if (!isMeasured(containerWidth)) {
		return clampAtLeast(width, MIN_REVIEW_CLAUDE_PANEL_WIDTH, true);
	}
	return clampSizeToContainer({
		size: width,
		minSize: MIN_REVIEW_CLAUDE_PANEL_WIDTH,
		containerSize: containerWidth,
		reservedSize: sidebarWidth + MIN_REVIEW_DIFF_WIDTH + REVIEW_COLUMN_SEPARATOR_COUNT,
	});
}

/**
 * One of the Claude column's fixed-height rows.
 *
 * `otherSectionsHeight` is the sum of the *rendered* sibling rows. Findings and drafts
 * are conditionally mounted, so a caller must pass 0 for an absent one rather than its
 * stored height — otherwise dragging the composer with an empty draft list would refuse
 * space that is plainly on screen.
 */
export function clampReviewStackHeight({
	height,
	minHeight,
	panelHeight,
	otherSectionsHeight,
}: {
	height: number;
	minHeight: number;
	panelHeight: number | null;
	otherSectionsHeight: number;
}): number {
	if (!isMeasured(panelHeight)) {
		return clampAtLeast(height, minHeight, true);
	}
	return clampSizeToContainer({
		size: height,
		minSize: minHeight,
		containerSize: panelHeight,
		reservedSize: otherSectionsHeight + MIN_REVIEW_TRANSCRIPT_HEIGHT + REVIEW_CLAUDE_PANEL_CHROME_HEIGHT,
	});
}

export function clampReviewDescriptionHeight(height: number, workspaceHeight: number | null): number {
	if (!isMeasured(workspaceHeight)) {
		return clampAtLeast(height, MIN_REVIEW_DESCRIPTION_HEIGHT, true);
	}
	return clampSizeToContainer({
		size: height,
		minSize: MIN_REVIEW_DESCRIPTION_HEIGHT,
		containerSize: workspaceHeight,
		reservedSize: REVIEW_WORKSPACE_RESERVED_HEIGHT,
	});
}

export interface ReviewLayout {
	/** The stored widths — what a drag starts from, before the container clamp. */
	sidebarWidth: number;
	claudePanelWidth: number;
	/** The widths actually rendered, clamped to what the container can hold. */
	displaySidebarWidth: number;
	displayClaudePanelWidth: number;
	findingsHeight: number;
	draftsHeight: number;
	composerHeight: number;
	descriptionHeight: number;
	displayFindingsHeight: number;
	displayDraftsHeight: number;
	displayComposerHeight: number;
	displayDescriptionHeight: number;
	setSidebarWidth: (width: number) => void;
	setClaudePanelWidth: (width: number) => void;
	setFindingsHeight: (height: number) => void;
	setDraftsHeight: (height: number) => void;
	setComposerHeight: (height: number) => void;
	setDescriptionHeight: (height: number) => void;
}

export function useReviewLayout({
	containerWidth,
	claudePanelHeight,
	workspaceHeight,
	hasFindings,
	hasDrafts,
}: {
	/** Width of the three-column row. Null or 0 until it has been laid out. */
	containerWidth: number | null;
	/** Height of the Claude column, which shrinks as the workspace's banners appear. */
	claudePanelHeight: number | null;
	workspaceHeight: number | null;
	/** Whether the findings row is currently mounted — it is hidden when nothing is pending. */
	hasFindings: boolean;
	/** Whether the drafts row is currently mounted. */
	hasDrafts: boolean;
}): ReviewLayout {
	const [sidebarWidth, setSidebarWidthState] = useState(() => loadResizePreference(SIDEBAR_WIDTH_PREFERENCE));
	const [claudePanelWidth, setClaudePanelWidthState] = useState(() =>
		loadResizePreference(CLAUDE_PANEL_WIDTH_PREFERENCE),
	);
	const [findingsHeight, setFindingsHeightState] = useState(() => loadResizePreference(FINDINGS_HEIGHT_PREFERENCE));
	const [draftsHeight, setDraftsHeightState] = useState(() => loadResizePreference(DRAFTS_HEIGHT_PREFERENCE));
	const [composerHeight, setComposerHeightState] = useState(() => loadResizePreference(COMPOSER_HEIGHT_PREFERENCE));
	const [descriptionHeight, setDescriptionHeightState] = useState(() =>
		loadResizePreference(DESCRIPTION_HEIGHT_PREFERENCE),
	);

	const setSidebarWidth = useCallback((width: number) => {
		setSidebarWidthState(persistResizePreference(SIDEBAR_WIDTH_PREFERENCE, width));
	}, []);
	const setClaudePanelWidth = useCallback((width: number) => {
		setClaudePanelWidthState(persistResizePreference(CLAUDE_PANEL_WIDTH_PREFERENCE, width));
	}, []);
	const setFindingsHeight = useCallback((height: number) => {
		setFindingsHeightState(persistResizePreference(FINDINGS_HEIGHT_PREFERENCE, height));
	}, []);
	const setDraftsHeight = useCallback((height: number) => {
		setDraftsHeightState(persistResizePreference(DRAFTS_HEIGHT_PREFERENCE, height));
	}, []);
	const setComposerHeight = useCallback((height: number) => {
		setComposerHeightState(persistResizePreference(COMPOSER_HEIGHT_PREFERENCE, height));
	}, []);
	const setDescriptionHeight = useCallback((height: number) => {
		setDescriptionHeightState(persistResizePreference(DESCRIPTION_HEIGHT_PREFERENCE, height));
	}, []);

	useLayoutResetEffect(() => {
		setSidebarWidthState(getResizePreferenceDefaultValue(SIDEBAR_WIDTH_PREFERENCE));
		setClaudePanelWidthState(getResizePreferenceDefaultValue(CLAUDE_PANEL_WIDTH_PREFERENCE));
		setFindingsHeightState(getResizePreferenceDefaultValue(FINDINGS_HEIGHT_PREFERENCE));
		setDraftsHeightState(getResizePreferenceDefaultValue(DRAFTS_HEIGHT_PREFERENCE));
		setComposerHeightState(getResizePreferenceDefaultValue(COMPOSER_HEIGHT_PREFERENCE));
		setDescriptionHeightState(getResizePreferenceDefaultValue(DESCRIPTION_HEIGHT_PREFERENCE));
	});

	// The Claude column is clamped first because the sidebar's clamp reserves it, which
	// is the same order `useGitHistoryLayout` resolves its two widths in.
	const { displaySidebarWidth, displayClaudePanelWidth } = useMemo(() => {
		const clampedClaudePanelWidth = clampReviewClaudePanelWidth(claudePanelWidth, containerWidth, sidebarWidth);
		return {
			displayClaudePanelWidth: clampedClaudePanelWidth,
			displaySidebarWidth: clampReviewSidebarWidth(sidebarWidth, containerWidth, clampedClaudePanelWidth),
		};
	}, [claudePanelWidth, containerWidth, sidebarWidth]);

	const { displayFindingsHeight, displayDraftsHeight, displayComposerHeight } = useMemo(() => {
		// Each row is clamped against the two others *as rendered*, so an unmounted row
		// reserves nothing and the remaining rows get its space.
		const mountedFindings = hasFindings ? findingsHeight : 0;
		const mountedDrafts = hasDrafts ? draftsHeight : 0;
		return {
			displayFindingsHeight: clampReviewStackHeight({
				height: findingsHeight,
				minHeight: MIN_REVIEW_FINDINGS_HEIGHT,
				panelHeight: claudePanelHeight,
				otherSectionsHeight: mountedDrafts + composerHeight,
			}),
			displayDraftsHeight: clampReviewStackHeight({
				height: draftsHeight,
				minHeight: MIN_REVIEW_DRAFTS_HEIGHT,
				panelHeight: claudePanelHeight,
				otherSectionsHeight: mountedFindings + composerHeight,
			}),
			displayComposerHeight: clampReviewStackHeight({
				height: composerHeight,
				minHeight: MIN_REVIEW_COMPOSER_HEIGHT,
				panelHeight: claudePanelHeight,
				otherSectionsHeight: mountedFindings + mountedDrafts,
			}),
		};
	}, [claudePanelHeight, composerHeight, draftsHeight, findingsHeight, hasDrafts, hasFindings]);

	const displayDescriptionHeight = useMemo(
		() => clampReviewDescriptionHeight(descriptionHeight, workspaceHeight),
		[descriptionHeight, workspaceHeight],
	);

	return {
		sidebarWidth,
		claudePanelWidth,
		displaySidebarWidth,
		displayClaudePanelWidth,
		findingsHeight,
		draftsHeight,
		composerHeight,
		descriptionHeight,
		displayFindingsHeight,
		displayDraftsHeight,
		displayComposerHeight,
		displayDescriptionHeight,
		setSidebarWidth,
		setClaudePanelWidth,
		setFindingsHeight,
		setDraftsHeight,
		setComposerHeight,
		setDescriptionHeight,
	};
}
