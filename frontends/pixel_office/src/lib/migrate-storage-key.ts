/**
 * Migrates a single localStorage key from oldKey to newKey if old exists and new is absent.
 */
export function migrateStorageKey(oldKey: string, newKey: string): string | null {
	if (typeof localStorage === "undefined") {
		return null;
	}
	const old = localStorage.getItem(oldKey);
	if (old !== null && localStorage.getItem(newKey) === null) {
		localStorage.setItem(newKey, old);
		localStorage.removeItem(oldKey);
	}
	return localStorage.getItem(newKey);
}

/**
 * Migrates all localStorage keys matching oldPrefix to newPrefix.
 */
export function migrateStoragePrefix(oldPrefix: string, newPrefix: string): void {
	if (typeof localStorage === "undefined") {
		return;
	}
	const keys = Object.keys(localStorage);
	for (const key of keys) {
		if (key.startsWith(oldPrefix)) {
			const suffix = key.slice(oldPrefix.length);
			const newKey = `${newPrefix}${suffix}`;
			migrateStorageKey(key, newKey);
		}
	}
}
