import { useCallback, useEffect, useState } from "react";

import { buildOfficeUrl, parseOfficeOpenFromSearch } from "@/hooks/app-utils";
import {
	LocalStorageKey,
	readLocalStorageItem,
	writeLocalStorageItem,
} from "@/storage/local-storage-store";
import { useWindowEvent } from "@/utils/react-use";

function officeOpenKey(projectId: string): string {
	return `kanban.office-view-open.${projectId}`;
}

/**
 * Mirrors the column into `?office=1|0` so a shared URL shows the same screen.
 *
 * `replaceState`, never `pushState`: the office is a toggle on the current view, not a place —
 * pushing it would make the Back button collapse a sidebar instead of leaving the surface the
 * user is looking at, which is the whole thing routing was added to fix.
 */
function syncOfficeParam(isOpen: boolean): void {
	if (typeof window === "undefined") {
		return;
	}
	const currentUrl = new URL(window.location.href);
	if (parseOfficeOpenFromSearch(currentUrl.search) === isOpen) {
		return;
	}
	window.history.replaceState(
		window.history.state,
		"",
		buildOfficeUrl({
			pathname: currentUrl.pathname,
			search: currentUrl.search,
			hash: currentUrl.hash,
			isOpen,
		}),
	);
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
 * Per-project right-column (manager watch + Office) toggle + persistence.
 *
 * `isOfficeOpen` means the home right column is visible — the board stays in center.
 */
export function useOfficeViewState({
	currentProjectId,
	hasNoProjects,
	onWillOpenOffice,
}: UseOfficeViewStateOptions): UseOfficeViewStateResult {
	const [isOfficeOpen, setIsOfficeOpen] = useState(() => {
		// An explicit `?office=` outranks the stored preference: a pasted URL has to render the
		// screen it describes, otherwise it is not a link to anything.
		const fromUrl = typeof window === "undefined" ? null : parseOfficeOpenFromSearch(window.location.search);
		if (fromUrl !== null) {
			return fromUrl;
		}
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
		syncOfficeParam(false);
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
		syncOfficeParam(next);
	}, [hasNoProjects, isOfficeOpen, onWillOpenOffice, persist]);

	useEffect(() => {
		if (!currentProjectId) {
			return;
		}
		const fromUrl = parseOfficeOpenFromSearch(window.location.search);
		if (fromUrl !== null) {
			setIsOfficeOpen(fromUrl);
			return;
		}
		const stored = window.localStorage.getItem(officeOpenKey(currentProjectId));
		// Per-project: missing key → open (three-pane default).
		setIsOfficeOpen(stored !== "false");
	}, [currentProjectId]);

	// The flag is not pushed, but it does ride along on entries the *route* pushed — so a Back
	// that lands on a URL saying `office=1` has to bring the column back with it, or the screen
	// stops matching the address bar.
	const handleOfficePopState = useCallback(() => {
		if (typeof window === "undefined") {
			return;
		}
		const fromUrl = parseOfficeOpenFromSearch(window.location.search);
		if (fromUrl === null) {
			return;
		}
		setIsOfficeOpen(fromUrl);
	}, []);
	useWindowEvent("popstate", handleOfficePopState);

	return {
		isOfficeOpen,
		handleToggleOffice,
		closeOffice,
	};
}
