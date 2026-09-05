import { useCallback, useState } from "react";

import { useLayoutResetEffect } from "@/resize/layout-customizations";
import { clampBetween } from "@/resize/resize-persistence";
import {
	getResizePreferenceDefaultValue,
	loadBooleanResizePreference,
	loadResizePreference,
	persistBooleanResizePreference,
	persistResizePreference,
	type ResizeBooleanPreference,
	type ResizeNumberPreference,
} from "@/resize/resize-preferences";
import { LocalStorageKey } from "@/storage/local-storage-store";

/** The width of both collapsed rails, in px. Mirrored by `w-8` in the markup. */
export const REVIEW_SIDE_RAIL_WIDTH = 32;

const LEFT_MIN_WIDTH = 240;
const LEFT_MAX_WIDTH = 560;
/** `w-80`, the width the tabbed aside shipped with. */
const LEFT_DEFAULT_WIDTH = 320;

const RIGHT_MIN_WIDTH = 300;
const RIGHT_MAX_WIDTH = 640;
/** `w-96`, the width the Claude panel shipped with. */
const RIGHT_DEFAULT_WIDTH = 384;

const LEFT_WIDTH_PREFERENCE: ResizeNumberPreference = {
	key: LocalStorageKey.ReviewLeftPanelWidth,
	defaultValue: LEFT_DEFAULT_WIDTH,
	normalize: (value) => clampBetween(value, LEFT_MIN_WIDTH, LEFT_MAX_WIDTH),
};

const LEFT_COLLAPSED_PREFERENCE: ResizeBooleanPreference = {
	key: LocalStorageKey.ReviewLeftPanelCollapsed,
	defaultValue: false,
};

const RIGHT_WIDTH_PREFERENCE: ResizeNumberPreference = {
	key: LocalStorageKey.ReviewRightPanelWidth,
	defaultValue: RIGHT_DEFAULT_WIDTH,
	normalize: (value) => clampBetween(value, RIGHT_MIN_WIDTH, RIGHT_MAX_WIDTH),
};

const RIGHT_COLLAPSED_PREFERENCE: ResizeBooleanPreference = {
	key: LocalStorageKey.ReviewRightPanelCollapsed,
	defaultValue: false,
};

export interface ReviewWorkspaceLayout {
	leftWidth: number;
	isLeftCollapsed: boolean;
	setLeftWidth: (width: number) => void;
	setLeftCollapsed: (collapsed: boolean) => void;
	rightWidth: number;
	isRightCollapsed: boolean;
	setRightWidth: (width: number) => void;
	setRightCollapsed: (collapsed: boolean) => void;
}

/**
 * Widths and collapsed state for the Review tab's two asides.
 *
 * Both asides used to be fixed `w-80`/`w-96` with no way to get them out of the way, so
 * the diff — the thing being reviewed — got whatever was left. Collapsing leaves a rail
 * rather than nothing, because the tabs behind the left aside (files, threads, findings)
 * are navigated constantly and a fully hidden panel costs a hunt for the toggle.
 */
export function useReviewWorkspaceLayout(): ReviewWorkspaceLayout {
	const [leftWidth, setLeftWidthState] = useState(() => loadResizePreference(LEFT_WIDTH_PREFERENCE));
	const [isLeftCollapsed, setIsLeftCollapsedState] = useState(() =>
		loadBooleanResizePreference(LEFT_COLLAPSED_PREFERENCE),
	);
	const [rightWidth, setRightWidthState] = useState(() => loadResizePreference(RIGHT_WIDTH_PREFERENCE));
	const [isRightCollapsed, setIsRightCollapsedState] = useState(() =>
		loadBooleanResizePreference(RIGHT_COLLAPSED_PREFERENCE),
	);

	const setLeftWidth = useCallback((width: number) => {
		setLeftWidthState(persistResizePreference(LEFT_WIDTH_PREFERENCE, width));
	}, []);

	const setRightWidth = useCallback((width: number) => {
		setRightWidthState(persistResizePreference(RIGHT_WIDTH_PREFERENCE, width));
	}, []);

	const setLeftCollapsed = useCallback((collapsed: boolean) => {
		setIsLeftCollapsedState(persistBooleanResizePreference(LEFT_COLLAPSED_PREFERENCE, collapsed));
	}, []);

	const setRightCollapsed = useCallback((collapsed: boolean) => {
		setIsRightCollapsedState(persistBooleanResizePreference(RIGHT_COLLAPSED_PREFERENCE, collapsed));
	}, []);

	useLayoutResetEffect(() => {
		setLeftWidthState(getResizePreferenceDefaultValue(LEFT_WIDTH_PREFERENCE));
		setRightWidthState(getResizePreferenceDefaultValue(RIGHT_WIDTH_PREFERENCE));
		setIsLeftCollapsedState(LEFT_COLLAPSED_PREFERENCE.defaultValue);
		setIsRightCollapsedState(RIGHT_COLLAPSED_PREFERENCE.defaultValue);
	});

	return {
		leftWidth,
		isLeftCollapsed,
		setLeftWidth,
		setLeftCollapsed,
		rightWidth,
		isRightCollapsed,
		setRightWidth,
		setRightCollapsed,
	};
}

export function clampReviewLeftPanelWidth(width: number): number {
	return clampBetween(width, LEFT_MIN_WIDTH, LEFT_MAX_WIDTH);
}

export function clampReviewRightPanelWidth(width: number): number {
	return clampBetween(width, RIGHT_MIN_WIDTH, RIGHT_MAX_WIDTH);
}
