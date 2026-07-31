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

const RIGHT_COLUMN_MIN_WIDTH = 280;
const RIGHT_COLUMN_MAX_WIDTH = 640;
const RIGHT_COLUMN_DEFAULT_WIDTH = 360;
const SPLIT_MIN = 0.25;
const SPLIT_MAX = 0.75;
const SPLIT_DEFAULT = 0.45;

const RIGHT_COLUMN_WIDTH_PREFERENCE: ResizeNumberPreference = {
	key: LocalStorageKey.HomeRightColumnWidth,
	defaultValue: RIGHT_COLUMN_DEFAULT_WIDTH,
	normalize: (value) => clampBetween(value, RIGHT_COLUMN_MIN_WIDTH, RIGHT_COLUMN_MAX_WIDTH),
};

const RIGHT_SPLIT_RATIO_PREFERENCE: ResizeNumberPreference = {
	key: LocalStorageKey.HomeRightSplitRatio,
	defaultValue: SPLIT_DEFAULT,
	normalize: (value) => clampBetween(value, SPLIT_MIN, SPLIT_MAX),
};

export function useHomeRightColumnLayout(): {
	rightColumnWidth: number;
	setRightColumnWidth: (width: number) => void;
	rightSplitRatio: number;
	setRightSplitRatio: (ratio: number) => void;
	rightColumnMinWidth: number;
	rightColumnMaxWidth: number;
} {
	const [rightColumnWidth, setRightColumnWidthState] = useState(() =>
		loadResizePreference(RIGHT_COLUMN_WIDTH_PREFERENCE),
	);
	const [rightSplitRatio, setRightSplitRatioState] = useState(() =>
		loadResizePreference(RIGHT_SPLIT_RATIO_PREFERENCE),
	);

	const setRightColumnWidth = useCallback((width: number) => {
		setRightColumnWidthState(persistResizePreference(RIGHT_COLUMN_WIDTH_PREFERENCE, width));
	}, []);

	const setRightSplitRatio = useCallback((ratio: number) => {
		setRightSplitRatioState(persistResizePreference(RIGHT_SPLIT_RATIO_PREFERENCE, ratio));
	}, []);

	useLayoutResetEffect(() => {
		setRightColumnWidthState(getResizePreferenceDefaultValue(RIGHT_COLUMN_WIDTH_PREFERENCE));
		setRightSplitRatioState(getResizePreferenceDefaultValue(RIGHT_SPLIT_RATIO_PREFERENCE));
	});

	return {
		rightColumnWidth,
		setRightColumnWidth,
		rightSplitRatio,
		setRightSplitRatio,
		rightColumnMinWidth: RIGHT_COLUMN_MIN_WIDTH,
		rightColumnMaxWidth: RIGHT_COLUMN_MAX_WIDTH,
	};
}
