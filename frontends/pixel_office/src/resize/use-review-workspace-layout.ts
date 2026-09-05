import { useCallback, useState } from "react";

import { useLayoutResetEffect } from "@/resize/layout-customizations";
import {
	loadBooleanResizePreference,
	persistBooleanResizePreference,
	type ResizeBooleanPreference,
} from "@/resize/resize-preferences";
import { LocalStorageKey } from "@/storage/local-storage-store";

/** The width of both collapsed rails, in px. Mirrored by `w-8` in the markup. */
export const REVIEW_SIDE_RAIL_WIDTH = 32;

const LEFT_COLLAPSED_PREFERENCE: ResizeBooleanPreference = {
	key: LocalStorageKey.ReviewLeftPanelCollapsed,
	defaultValue: false,
};

const RIGHT_COLLAPSED_PREFERENCE: ResizeBooleanPreference = {
	key: LocalStorageKey.ReviewRightPanelCollapsed,
	defaultValue: false,
};

export interface ReviewPaneCollapse {
	isLeftCollapsed: boolean;
	isRightCollapsed: boolean;
	setLeftCollapsed: (collapsed: boolean) => void;
	setRightCollapsed: (collapsed: boolean) => void;
}

/**
 * Whether the Review tab's two asides are open at all.
 *
 * Their widths belong to `useReviewLayout`, which owns every draggable size in the
 * tab; this is the other axis — a collapsed pane has no width to remember, and the
 * reviewer's choice to work full-width on the diff has to outlive a reload.
 */
export function useReviewPaneCollapse(): ReviewPaneCollapse {
	const [isLeftCollapsed, setIsLeftCollapsedState] = useState(() =>
		loadBooleanResizePreference(LEFT_COLLAPSED_PREFERENCE),
	);
	const [isRightCollapsed, setIsRightCollapsedState] = useState(() =>
		loadBooleanResizePreference(RIGHT_COLLAPSED_PREFERENCE),
	);

	const setLeftCollapsed = useCallback((collapsed: boolean) => {
		setIsLeftCollapsedState(persistBooleanResizePreference(LEFT_COLLAPSED_PREFERENCE, collapsed));
	}, []);

	const setRightCollapsed = useCallback((collapsed: boolean) => {
		setIsRightCollapsedState(persistBooleanResizePreference(RIGHT_COLLAPSED_PREFERENCE, collapsed));
	}, []);

	useLayoutResetEffect(() => {
		setIsLeftCollapsedState(LEFT_COLLAPSED_PREFERENCE.defaultValue);
		setIsRightCollapsedState(RIGHT_COLLAPSED_PREFERENCE.defaultValue);
	});

	return { isLeftCollapsed, isRightCollapsed, setLeftCollapsed, setRightCollapsed };
}
