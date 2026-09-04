import { useCallback, useState } from "react";

import {
	buildHomePathname,
	HOME_ROUTE_BOARD,
	type HomeRoute,
	isSameHomeRoute,
	parseHomeRoute,
} from "@/hooks/home-route";
import { useWindowEvent } from "@/utils/react-use";

export interface NavigateHomeRouteOptions {
	/**
	 * Replace the current history entry instead of adding one. Use it for anything the user did
	 * not ask for — normalization, a project switch resetting the view — so Back never lands on
	 * a state nobody navigated to.
	 */
	replace?: boolean;
}

export interface UseHomeRouteOptions {
	/**
	 * The project the URL is currently scoped to. `null` while nothing is selected, which is
	 * also when the shell has nothing routable to show.
	 */
	projectId: string | null;
	/** Mirrors the guard `toggleView` already had: with no projects there is nowhere to go. */
	hasNoProjects: boolean;
}

export interface UseHomeRouteResult {
	route: HomeRoute;
	navigate: (route: HomeRoute, options?: NavigateHomeRouteOptions) => void;
}

/**
 * Single owner of the home shell's route, and the only writer of `window.history` for the
 * *pathname*. The card detail's `?task=` param (`use-detail-task-navigation.ts`) and the
 * office column's `?office=` flag own the query string, which is why every write here carries
 * the existing `search` and `hash` through untouched.
 */
export function useHomeRoute({ projectId, hasNoProjects }: UseHomeRouteOptions): UseHomeRouteResult {
	const [route, setRoute] = useState<HomeRoute>(() => {
		if (typeof window === "undefined") {
			return HOME_ROUTE_BOARD;
		}
		return parseHomeRoute(window.location.pathname);
	});

	const navigate = useCallback(
		(nextRoute: HomeRoute, options?: NavigateHomeRouteOptions) => {
			if (hasNoProjects) {
				return;
			}
			setRoute(nextRoute);
			if (typeof window === "undefined") {
				return;
			}
			const currentUrl = new URL(window.location.href);
			const nextPathname = buildHomePathname(projectId, nextRoute);
			const nextUrl = `${nextPathname}${currentUrl.search}${currentUrl.hash}`;
			// Re-selecting the surface already on screen is not a destination — pushing it would
			// stack duplicate entries that Back appears to ignore.
			const shouldReplace = options?.replace === true || nextPathname === currentUrl.pathname;
			if (shouldReplace) {
				window.history.replaceState(window.history.state, "", nextUrl);
				return;
			}
			window.history.pushState(window.history.state, "", nextUrl);
		},
		[hasNoProjects, projectId],
	);

	const handlePopState = useCallback(() => {
		if (typeof window === "undefined") {
			return;
		}
		const nextRoute = parseHomeRoute(window.location.pathname);
		setRoute((current) => (isSameHomeRoute(current, nextRoute) ? current : nextRoute));
	}, []);
	useWindowEvent("popstate", handlePopState);

	// With no projects the shell shows "No projects yet" and `useProjectNavigation` has already
	// reset the pathname to `/`, so reporting a stale route would leave the sidebar on a
	// section the URL no longer names.
	return { route: hasNoProjects ? HOME_ROUTE_BOARD : route, navigate };
}
