import { readPersistedResizeNumber, writePersistedResizeNumber } from "@/resize/resize-persistence";
import { type LocalStorageKey, readLocalStorageItem, writeLocalStorageItem } from "@/storage/local-storage-store";

export interface ResizeNumberPreference {
	defaultValue: number | (() => number);
	key: LocalStorageKey;
	normalize?: (value: number) => number;
}

export interface ResizeBooleanPreference {
	defaultValue: boolean;
	key: LocalStorageKey;
}

export interface ResizeStringPreference<T extends string> {
	defaultValue: T;
	key: LocalStorageKey;
	/** The full set of accepted values; anything else in storage is treated as absent. */
	values: readonly T[];
}

export function getResizePreferenceDefaultValue(preference: ResizeNumberPreference): number {
	return typeof preference.defaultValue === "function" ? preference.defaultValue() : preference.defaultValue;
}

export function loadResizePreference(preference: ResizeNumberPreference): number {
	return readPersistedResizeNumber({
		key: preference.key,
		fallback: getResizePreferenceDefaultValue(preference),
		normalize: preference.normalize,
	});
}

export function persistResizePreference(preference: ResizeNumberPreference, value: number): number {
	return writePersistedResizeNumber({
		key: preference.key,
		value,
		normalize: preference.normalize,
	});
}

export function loadBooleanResizePreference(preference: ResizeBooleanPreference): boolean {
	const storedValue = readLocalStorageItem(preference.key);
	if (storedValue === null) {
		return preference.defaultValue;
	}
	return storedValue === "true";
}

export function persistBooleanResizePreference(preference: ResizeBooleanPreference, value: boolean): boolean {
	writeLocalStorageItem(preference.key, String(value));
	return value;
}

export function loadStringResizePreference<T extends string>(preference: ResizeStringPreference<T>): T {
	const storedValue = readLocalStorageItem(preference.key);
	// A value written by an older build (or by hand) must not strand the UI in a mode it
	// no longer renders, so anything outside the accepted set falls back to the default.
	if (storedValue === null || !preference.values.includes(storedValue as T)) {
		return preference.defaultValue;
	}
	return storedValue as T;
}

export function persistStringResizePreference<T extends string>(preference: ResizeStringPreference<T>, value: T): T {
	writeLocalStorageItem(preference.key, value);
	return value;
}
