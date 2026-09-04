import { useCallback } from "react";

import { HOME_ROUTE_BOARD, type HomeRoute, homeRouteCenterView } from "@/hooks/home-route";
import type { NavigateHomeRouteOptions } from "@/hooks/use-home-route";

/**
 * What occupies the home center pane.
 *
 * `"board"` is the three-pane default (`HomeTriplePane`); every other value replaces
 * it wholesale. Modelled as one enum rather than a boolean per view on purpose: the
 * views are mutually exclusive, and a boolean pile needs one reset call per *pair*,
 * so each new surface added quadratically more places to forget.
 */
export type HomeCenterView = "board" | "docs" | "git" | "learning" | "understand";

export interface UseHomeCenterViewOptions {
	/** The shell's route — the source of truth for what is on screen, and for the URL. */
	route: HomeRoute;
	navigate: (route: HomeRoute, options?: NavigateHomeRouteOptions) => void;
	/**
	 * The Office right column is a *column*, not a center view, so it lives in
	 * `useOfficeViewState`. Opening any non-board center view hides it, matching what
	 * the Docs toggle already did — the alternative is a column that silently
	 * reappears when the view is closed again.
	 */
	closeOffice: () => void;
}

export interface UseHomeCenterViewResult {
	centerView: HomeCenterView;
	isDocsOpen: boolean;
	isGitHistoryOpen: boolean;
	isLearningOpen: boolean;
	isUnderstandOpen: boolean;
	/** Opens `view`, or returns to the board when it is already the current one. */
	toggleView: (view: Exclude<HomeCenterView, "board">) => void;
	/** Back to the board whatever is open. Used on project switch and when Office opens. */
	resetToBoard: (options?: NavigateHomeRouteOptions) => void;
	/** Closes git history only — leaves any other view alone. */
	closeGitHistory: () => void;
}

/**
 * Derives the center pane from the route and turns the toggles back into navigations.
 *
 * It used to own a `useState`, which is why none of these views had a URL. The public shape is
 * unchanged so the toggle call sites in `App.tsx` did not have to move; the only new thing is
 * that `resetToBoard` takes history options, because a project switch resetting the view is
 * not a place the user navigated to.
 */
export function useHomeCenterView({
	route,
	navigate,
	closeOffice,
}: UseHomeCenterViewOptions): UseHomeCenterViewResult {
	const centerView = homeRouteCenterView(route);

	const toggleView = useCallback(
		(view: Exclude<HomeCenterView, "board">) => {
			closeOffice();
			navigate(homeRouteCenterView(route) === view ? HOME_ROUTE_BOARD : { kind: "center", view });
		},
		[closeOffice, navigate, route],
	);

	const resetToBoard = useCallback(
		(options?: NavigateHomeRouteOptions) => {
			navigate(HOME_ROUTE_BOARD, options);
		},
		[navigate],
	);

	const closeGitHistory = useCallback(() => {
		if (homeRouteCenterView(route) !== "git") {
			return;
		}
		navigate(HOME_ROUTE_BOARD);
	}, [navigate, route]);

	return {
		centerView,
		isDocsOpen: centerView === "docs",
		isGitHistoryOpen: centerView === "git",
		isLearningOpen: centerView === "learning",
		isUnderstandOpen: centerView === "understand",
		toggleView,
		resetToBoard,
		closeGitHistory,
	};
}
