import { useCallback, useState } from "react";

import { useLayoutResetEffect } from "@/resize/layout-customizations";
import { clampBetween } from "@/resize/resize-persistence";
import {
	getResizePreferenceDefaultValue,
	loadBooleanResizePreference,
	loadResizePreference,
	loadStringResizePreference,
	persistBooleanResizePreference,
	persistResizePreference,
	persistStringResizePreference,
	type ResizeBooleanPreference,
	type ResizeNumberPreference,
	type ResizeStringPreference,
} from "@/resize/resize-preferences";
import { LocalStorageKey } from "@/storage/local-storage-store";

/** Which of the source/preview panes are on screen. "split" keeps both, at `rawPaneRatio`. */
export type PlanEditorPaneViewMode = "editor" | "split" | "preview";

const RAW_PANE_RATIO_PREFERENCE: ResizeNumberPreference = {
	key: LocalStorageKey.PlanEditorRawPaneRatio,
	defaultValue: 0.5,
	normalize: (value) => clampBetween(value, 0.2, 0.8),
};

/** Fixed px rather than a ratio: the thumbnails have a natural size the cards read at. */
const TEMPLATE_PANE_WIDTH_PREFERENCE: ResizeNumberPreference = {
	key: LocalStorageKey.PlanEditorTemplatePaneWidth,
	defaultValue: 220,
	normalize: (value) => clampBetween(value, 160, 360),
};

const TEMPLATE_PANE_COLLAPSED_PREFERENCE: ResizeBooleanPreference = {
	key: LocalStorageKey.PlanEditorTemplatePaneCollapsed,
	defaultValue: false,
};

const PANE_VIEW_MODE_PREFERENCE: ResizeStringPreference<PlanEditorPaneViewMode> = {
	key: LocalStorageKey.PlanEditorPaneViewMode,
	defaultValue: "split",
	values: ["editor", "split", "preview"],
};

/**
 * Plan editor pane geometry: the template rail's width/collapsed state, plus which of the
 * raw (left) and rendered (right) panes beside it are shown and how they split the width.
 */
export function usePlanEditorLayout(): {
	rawPaneRatio: number;
	setRawPaneRatio: (ratio: number) => void;
	templatePaneWidth: number;
	setTemplatePaneWidth: (width: number) => void;
	templatePaneCollapsed: boolean;
	toggleTemplatePaneCollapsed: () => void;
	paneViewMode: PlanEditorPaneViewMode;
	setPaneViewMode: (mode: PlanEditorPaneViewMode) => void;
} {
	const [rawPaneRatio, setRawPaneRatioState] = useState(() => loadResizePreference(RAW_PANE_RATIO_PREFERENCE));
	const [templatePaneWidth, setTemplatePaneWidthState] = useState(() =>
		loadResizePreference(TEMPLATE_PANE_WIDTH_PREFERENCE),
	);
	const [templatePaneCollapsed, setTemplatePaneCollapsedState] = useState(() =>
		loadBooleanResizePreference(TEMPLATE_PANE_COLLAPSED_PREFERENCE),
	);
	const [paneViewMode, setPaneViewModeState] = useState(() => loadStringResizePreference(PANE_VIEW_MODE_PREFERENCE));

	const setRawPaneRatio = useCallback((ratio: number) => {
		setRawPaneRatioState(persistResizePreference(RAW_PANE_RATIO_PREFERENCE, ratio));
	}, []);

	const setTemplatePaneWidth = useCallback((width: number) => {
		setTemplatePaneWidthState(persistResizePreference(TEMPLATE_PANE_WIDTH_PREFERENCE, width));
	}, []);

	const toggleTemplatePaneCollapsed = useCallback(() => {
		setTemplatePaneCollapsedState((collapsed) =>
			persistBooleanResizePreference(TEMPLATE_PANE_COLLAPSED_PREFERENCE, !collapsed),
		);
	}, []);

	// The ratio is deliberately left alone: switching to a single-pane mode and back
	// should return to the split the user dragged, not to 50/50.
	const setPaneViewMode = useCallback((mode: PlanEditorPaneViewMode) => {
		setPaneViewModeState(persistStringResizePreference(PANE_VIEW_MODE_PREFERENCE, mode));
	}, []);

	useLayoutResetEffect(() => {
		setRawPaneRatioState(getResizePreferenceDefaultValue(RAW_PANE_RATIO_PREFERENCE));
		setTemplatePaneWidthState(getResizePreferenceDefaultValue(TEMPLATE_PANE_WIDTH_PREFERENCE));
		setTemplatePaneCollapsedState(TEMPLATE_PANE_COLLAPSED_PREFERENCE.defaultValue);
		setPaneViewModeState(PANE_VIEW_MODE_PREFERENCE.defaultValue);
	});

	return {
		rawPaneRatio,
		setRawPaneRatio,
		templatePaneWidth,
		setTemplatePaneWidth,
		templatePaneCollapsed,
		toggleTemplatePaneCollapsed,
		paneViewMode,
		setPaneViewMode,
	};
}
