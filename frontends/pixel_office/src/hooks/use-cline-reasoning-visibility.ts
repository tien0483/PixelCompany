// Stores the global "show Cline reasoning text" preference for the native Cline
// chat panel. Hiding reasoning is purely cosmetic — reasoning messages stay in
// the session and backend, they are just not rendered while the toggle is off.
import { useCallback, useSyncExternalStore } from "react";

import {
	LocalStorageKey,
	readLocalStorageItem,
	writeLocalStorageItem,
} from "@/storage/local-storage-store";

const reasoningVisibilityListeners = new Set<() => void>();
let storageSyncInstalled = false;
let currentReasoningVisible = readStoredReasoningVisibility();

function readStoredReasoningVisibility(): boolean {
	const stored = readLocalStorageItem(LocalStorageKey.ClineShowReasoning);
	// Defaults to visible; only an explicit "false" hides reasoning.
	return stored !== "false";
}

function notifyReasoningVisibilityListeners(): void {
	for (const listener of reasoningVisibilityListeners) {
		listener();
	}
}

function installStorageSyncListener(): void {
	if (storageSyncInstalled || typeof window === "undefined") {
		return;
	}
	storageSyncInstalled = true;
	window.addEventListener("storage", (event) => {
		if (event.key !== null && event.key !== LocalStorageKey.ClineShowReasoning) {
			return;
		}
		const nextValue = readStoredReasoningVisibility();
		if (nextValue === currentReasoningVisible) {
			return;
		}
		currentReasoningVisible = nextValue;
		notifyReasoningVisibilityListeners();
	});
}

function subscribeReasoningVisibility(listener: () => void): () => void {
	installStorageSyncListener();
	reasoningVisibilityListeners.add(listener);
	return () => {
		reasoningVisibilityListeners.delete(listener);
	};
}

function readReasoningVisibilitySnapshot(): boolean {
	return currentReasoningVisible;
}

export function isClineReasoningVisible(): boolean {
	return currentReasoningVisible;
}

export function setClineReasoningVisible(next: boolean): void {
	writeLocalStorageItem(LocalStorageKey.ClineShowReasoning, String(next));
	if (next === currentReasoningVisible) {
		return;
	}
	currentReasoningVisible = next;
	notifyReasoningVisibilityListeners();
}

/** Re-sync the module snapshot from storage. Useful for tests and storage resets. */
export function resetClineReasoningVisibility(): void {
	const stored = readStoredReasoningVisibility();
	if (stored === currentReasoningVisible) {
		return;
	}
	currentReasoningVisible = stored;
	notifyReasoningVisibilityListeners();
}

export interface UseClineReasoningVisibilityResult {
	isVisible: boolean;
	setVisible: (visible: boolean) => void;
}

export function useClineReasoningVisibility(): UseClineReasoningVisibilityResult {
	const isVisible = useSyncExternalStore(
		subscribeReasoningVisibility,
		readReasoningVisibilitySnapshot,
		readReasoningVisibilitySnapshot,
	);

	const setVisible = useCallback((visible: boolean) => {
		setClineReasoningVisible(visible);
	}, []);

	return { isVisible, setVisible };
}
