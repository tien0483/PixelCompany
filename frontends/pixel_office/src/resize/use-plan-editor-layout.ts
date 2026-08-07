import { useCallback, useState } from "react";

import { useLayoutResetEffect } from "@/resize/layout-customizations";
import { clampBetween } from "@/resize/resize-persistence";
import {
	getResizePreferenceDefaultValue,
	loadResizePreference,
	persistResizePreference,
	type ResizeNumberPreference,
} from "@/resize/resize-preferences";
import { LocalStorageKey } from "@/storage/local-storage-store";

const RAW_PANE_RATIO_PREFERENCE: ResizeNumberPreference = {
	key: LocalStorageKey.PlanEditorRawPaneRatio,
	defaultValue: 0.5,
	normalize: (value) => clampBetween(value, 0.2, 0.8),
};

/** Width split between the plan editor's raw (left) and rendered (right) panes. */
export function usePlanEditorLayout(): {
	rawPaneRatio: number;
	setRawPaneRatio: (ratio: number) => void;
} {
	const [rawPaneRatio, setRawPaneRatioState] = useState(() => loadResizePreference(RAW_PANE_RATIO_PREFERENCE));

	const setRawPaneRatio = useCallback((ratio: number) => {
		setRawPaneRatioState(persistResizePreference(RAW_PANE_RATIO_PREFERENCE, ratio));
	}, []);

	useLayoutResetEffect(() => {
		setRawPaneRatioState(getResizePreferenceDefaultValue(RAW_PANE_RATIO_PREFERENCE));
	});

	return { rawPaneRatio, setRawPaneRatio };
}
