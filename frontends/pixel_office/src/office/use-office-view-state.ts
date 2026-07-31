import { useCallback, useEffect, useState } from "react";

import {
	LocalStorageKey,
	readLocalStorageItem,
	writeLocalStorageItem,
} from "@/storage/local-storage-store";

function officeOpenKey(projectId: string): string {
	return `kanban.office-view-open.${projectId}`;
}

export interface UseOfficeViewStateOptions {
	currentProjectId: string | null;
	hasNoProjects: boolean;
	/**
	 * Called when the office is about to open (close git history, leave card
	 * detail so the home layout is visible, etc.).
	 */
	onWillOpenOffice?: () => void;
}

export interface UseOfficeViewStateResult {
	isOfficeOpen: boolean;
	handleToggleOffice: () => void;
	closeOffice: () => void;
}

/**
 * Per-project right-column (Jacked watch + Office) toggle + persistence.
 *
 * `isOfficeOpen` means the home right column is visible — the board stays in center.
 */
export function useOfficeViewState({
	currentProjectId,
	hasNoProjects,
	onWillOpenOffice,
}: UseOfficeViewStateOptions): UseOfficeViewStateResult {
	const [isOfficeOpen, setIsOfficeOpen] = useState(() => {
		const stored = readLocalStorageItem(LocalStorageKey.OfficeViewOpen);
		// Right column defaults open; only an explicit "false" hides it.
		return stored !== "false";
	});

	const persist = useCallback(
		(next: boolean) => {
			if (currentProjectId) {
				window.localStorage.setItem(officeOpenKey(currentProjectId), String(next));
			} else {
				writeLocalStorageItem(LocalStorageKey.OfficeViewOpen, String(next));
			}
		},
		[currentProjectId],
	);

	const closeOffice = useCallback(() => {
		setIsOfficeOpen(false);
		persist(false);
	}, [persist]);

	const handleToggleOffice = useCallback(() => {
		if (hasNoProjects) {
			return;
		}
		const next = !isOfficeOpen;
		persist(next);
		if (next) {
			onWillOpenOffice?.();
		}
		setIsOfficeOpen(next);
	}, [hasNoProjects, isOfficeOpen, onWillOpenOffice, persist]);

	useEffect(() => {
		if (!currentProjectId) {
			return;
		}
		const stored = window.localStorage.getItem(officeOpenKey(currentProjectId));
		// Per-project: missing key → open (three-pane default).
		setIsOfficeOpen(stored !== "false");
	}, [currentProjectId]);

	return {
		isOfficeOpen,
		handleToggleOffice,
		closeOffice,
	};
}
