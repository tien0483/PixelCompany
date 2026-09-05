import { type LocalStorageKey, readLocalStorageItem, writeLocalStorageItem } from "@/storage/local-storage-store";

export function clampBetween(value: number, min: number, max: number, round = false): number {
	const normalizedValue = round ? Math.round(value) : value;
	return Math.max(min, Math.min(max, normalizedValue));
}

export function clampAtLeast(value: number, min: number, round = false): number {
	const normalizedValue = round ? Math.round(value) : value;
	return Math.max(min, normalizedValue);
}

/**
 * One pane's size, held above its own minimum and below whatever the container has
 * left once the panes beside it have taken theirs. Axis-neutral: the arithmetic is
 * the same for a column's width and a stacked section's height.
 */
export function clampSizeToContainer({
	size,
	minSize,
	containerSize,
	reservedSize,
}: {
	size: number;
	minSize: number;
	containerSize: number;
	reservedSize: number;
}): number {
	return clampBetween(size, minSize, containerSize - reservedSize, true);
}

export function clampWidthToContainer({
	width,
	minWidth,
	containerWidth,
	reservedWidth,
}: {
	width: number;
	minWidth: number;
	containerWidth: number;
	reservedWidth: number;
}): number {
	return clampSizeToContainer({
		size: width,
		minSize: minWidth,
		containerSize: containerWidth,
		reservedSize: reservedWidth,
	});
}

export function readPersistedResizeNumber({
	key,
	fallback,
	normalize,
}: {
	key: LocalStorageKey;
	fallback: number;
	normalize?: (value: number) => number;
}): number {
	const storedValue = readLocalStorageItem(key);
	if (!storedValue) {
		return fallback;
	}
	const parsedValue = Number(storedValue);
	if (!Number.isFinite(parsedValue)) {
		return fallback;
	}
	return normalize ? normalize(parsedValue) : parsedValue;
}

export function readOptionalPersistedResizeNumber({
	key,
	normalize,
}: {
	key: LocalStorageKey;
	normalize?: (value: number) => number;
}): number | undefined {
	const storedValue = readLocalStorageItem(key);
	if (!storedValue) {
		return undefined;
	}
	const parsedValue = Number(storedValue);
	if (!Number.isFinite(parsedValue)) {
		return undefined;
	}
	return normalize ? normalize(parsedValue) : parsedValue;
}

export function writePersistedResizeNumber({
	key,
	value,
	normalize,
}: {
	key: LocalStorageKey;
	value: number;
	normalize?: (value: number) => number;
}): number {
	const normalizedValue = normalize ? normalize(value) : value;
	writeLocalStorageItem(key, String(normalizedValue));
	return normalizedValue;
}
