import type { HomeSidebarSection } from "@/components/project-navigation-panel";
import type { HomeCenterView } from "@/hooks/use-home-center-view";

/**
 * Identity of a merge request as it travels in the URL.
 *
 * `host` rides along for the same reason it rides in `ReviewTarget`: the same project id on
 * two GitLab instances is two different projects.
 */
export interface HomeReviewRouteTarget {
	host: string;
	projectId: number;
	iid: number;
}

/**
 * What the home shell is showing, as one value.
 *
 * Before this existed the answer was spread over three unrelated state owners — the sidebar
 * section, the center-view enum and the three center overlays (plan editor / review / agent
 * studio) — none of which touched the URL, so no full-pane surface could be linked to, and
 * browser Back/Forward did nothing between them. Collapsing them into a single route is what
 * makes one pathname able to describe the screen, and therefore what makes history work.
 *
 * `null` ids mean "the section, nothing opened inside it": `/proj/plans` lists plans with the
 * board still in the center, `/proj/plans/<id>` replaces the center with the editor.
 */
export type HomeRoute =
	| { kind: "board" }
	| { kind: "manager" }
	| { kind: "plans"; planId: string | null }
	| { kind: "review"; target: HomeReviewRouteTarget | null }
	/** `flowId === AGENT_STUDIO_NEW_FLOW_ID` opens a blank canvas rather than an existing flow. */
	| { kind: "agents"; flowId: string | null }
	| { kind: "center"; view: Exclude<HomeCenterView, "board"> };

export const HOME_ROUTE_BOARD: HomeRoute = { kind: "board" };

/** The `/agents/<segment>` value that means "create an agent" instead of naming a flow. */
export const AGENT_STUDIO_NEW_FLOW_ID = "new";

const CENTER_VIEW_SEGMENTS: ReadonlyArray<Exclude<HomeCenterView, "board">> = [
	"docs",
	"git",
	"learning",
	"understand",
];

function splitPathname(pathname: string): string[] {
	return pathname.split("/").filter((segment) => segment.length > 0);
}

function decodeSegment(segment: string): string | null {
	try {
		return decodeURIComponent(segment);
	} catch {
		return null;
	}
}

/** A GitLab project id / merge request iid as it appears in the path: a positive integer. */
function parsePositiveInteger(segment: string | undefined): number | null {
	if (segment === undefined || !/^\d+$/.test(segment)) {
		return null;
	}
	const parsed = Number.parseInt(segment, 10);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Reads the route out of a pathname, ignoring segment 0 (the project id — that is
 * `parseProjectIdFromPathname`'s job, and the two are parsed independently so a project switch
 * can rewrite one without disturbing the other).
 *
 * Never throws and never reports failure: an unknown or malformed segment falls back to the
 * board, because a hand-typed or stale URL must render the app rather than blank it.
 */
export function parseHomeRoute(pathname: string): HomeRoute {
	const segments = splitPathname(pathname);
	const viewSegment = segments[1] === undefined ? null : decodeSegment(segments[1]);
	if (viewSegment === null) {
		return HOME_ROUTE_BOARD;
	}

	const centerView = CENTER_VIEW_SEGMENTS.find((view) => view === viewSegment);
	if (centerView) {
		return { kind: "center", view: centerView };
	}

	if (viewSegment === "manager") {
		return { kind: "manager" };
	}

	if (viewSegment === "plans") {
		const planId = segments[2] === undefined ? null : decodeSegment(segments[2]);
		return { kind: "plans", planId: planId && planId.length > 0 ? planId : null };
	}

	if (viewSegment === "review") {
		const host = segments[2] === undefined ? null : decodeSegment(segments[2]);
		const projectId = parsePositiveInteger(segments[3]);
		const iid = parsePositiveInteger(segments[4]);
		if (host === null || host.length === 0 || projectId === null || iid === null) {
			// A partial triple identifies no merge request, so it opens the list rather than
			// a review of nothing.
			return { kind: "review", target: null };
		}
		return { kind: "review", target: { host, projectId, iid } };
	}

	if (viewSegment === "agents") {
		const flowId = segments[2] === undefined ? null : decodeSegment(segments[2]);
		return { kind: "agents", flowId: flowId && flowId.length > 0 ? flowId : null };
	}

	return HOME_ROUTE_BOARD;
}

function homeRouteSegments(route: HomeRoute): string[] {
	switch (route.kind) {
		case "board":
			return [];
		case "manager":
			return ["manager"];
		case "plans":
			return route.planId ? ["plans", route.planId] : ["plans"];
		case "review":
			return route.target
				? ["review", route.target.host, String(route.target.projectId), String(route.target.iid)]
				: ["review"];
		case "agents":
			return route.flowId ? ["agents", route.flowId] : ["agents"];
		case "center":
			return [route.view];
	}
}

/**
 * The pathname for `route` under `projectId`.
 *
 * Every segment is encoded the same way `buildProjectPathname` encodes the project id, so a
 * plan id or GitLab host containing a slash survives the round trip.
 */
export function buildHomePathname(projectId: string | null, route: HomeRoute): string {
	// A route cannot be addressed without a project — every one of them is scoped to a
	// workspace, and the project-less shell only ever shows "No projects yet".
	const allSegments = projectId === null ? [] : [projectId, ...homeRouteSegments(route)];
	if (allSegments.length === 0) {
		return "/";
	}
	return `/${allSegments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

/**
 * Rewrites segment 0 (the project) and leaves the rest of the path alone.
 *
 * `useProjectNavigation` normalizes the pathname whenever the runtime reports the active
 * project, and it used to do that by rebuilding the whole pathname from the project id — which
 * silently deleted whatever route was open. It only ever needed to own its own segment.
 */
export function replaceProjectSegment(pathname: string, projectId: string): string {
	const segments = splitPathname(pathname);
	const rest = segments.slice(1);
	return `/${[projectId, ...rest.map((segment) => decodeSegment(segment) ?? segment)]
		.map((segment) => encodeURIComponent(segment))
		.join("/")}`;
}

/** Which sidebar list the route implies. The overlays imply the section they were opened from. */
export function homeRouteSidebarSection(route: HomeRoute): HomeSidebarSection {
	switch (route.kind) {
		case "manager":
			return "manager";
		case "plans":
			return "plans";
		case "review":
			return "review";
		case "agents":
			return "agents";
		// A center view replaces the board without belonging to any list, so the sidebar stays
		// on Projects rather than inventing a section for it.
		case "board":
		case "center":
			return "projects";
	}
}

export function homeRouteCenterView(route: HomeRoute): HomeCenterView {
	return route.kind === "center" ? route.view : "board";
}

/** The route a bare sidebar tab click lands on: the section with nothing opened inside it. */
export function sectionHomeRoute(section: HomeSidebarSection): HomeRoute {
	switch (section) {
		case "projects":
			return HOME_ROUTE_BOARD;
		case "manager":
			return { kind: "manager" };
		case "plans":
			return { kind: "plans", planId: null };
		case "review":
			return { kind: "review", target: null };
		case "agents":
			return { kind: "agents", flowId: null };
	}
}

export function isSameHomeRoute(left: HomeRoute, right: HomeRoute): boolean {
	return buildHomePathname("p", left) === buildHomePathname("p", right);
}
