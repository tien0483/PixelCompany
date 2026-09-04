import { describe, expect, it } from "vitest";

import {
	AGENT_STUDIO_NEW_FLOW_ID,
	buildHomePathname,
	type HomeRoute,
	homeRouteCenterView,
	homeRouteSidebarSection,
	parseHomeRoute,
	replaceProjectSegment,
	sectionHomeRoute,
} from "@/hooks/home-route";

const ROUND_TRIPS: ReadonlyArray<[string, HomeRoute]> = [
	["/proj", { kind: "board" }],
	["/proj/manager", { kind: "manager" }],
	["/proj/plans", { kind: "plans", planId: null }],
	["/proj/plans/plan-7", { kind: "plans", planId: "plan-7" }],
	["/proj/review", { kind: "review", target: null }],
	[
		"/proj/review/gitlab.example.com/42/9",
		{ kind: "review", target: { host: "gitlab.example.com", projectId: 42, iid: 9 } },
	],
	["/proj/agents", { kind: "agents", flowId: null }],
	["/proj/agents/new", { kind: "agents", flowId: AGENT_STUDIO_NEW_FLOW_ID }],
	["/proj/agents/flow-1", { kind: "agents", flowId: "flow-1" }],
	["/proj/docs", { kind: "center", view: "docs" }],
	["/proj/git", { kind: "center", view: "git" }],
	["/proj/learning", { kind: "center", view: "learning" }],
	["/proj/understand", { kind: "center", view: "understand" }],
];

describe("parseHomeRoute / buildHomePathname", () => {
	it.each(ROUND_TRIPS)("round-trips %s", (pathname, route) => {
		expect(parseHomeRoute(pathname)).toEqual(route);
		expect(buildHomePathname("proj", route)).toBe(pathname);
	});

	it("falls back to the board rather than throwing on an unknown or broken segment", () => {
		expect(parseHomeRoute("/proj/nonsense")).toEqual({ kind: "board" });
		expect(parseHomeRoute("/")).toEqual({ kind: "board" });
		expect(parseHomeRoute("")).toEqual({ kind: "board" });
		expect(parseHomeRoute("/proj/%E0%A4%A")).toEqual({ kind: "board" });
	});

	it("opens the merge request list when the review triple is incomplete or not numeric", () => {
		expect(parseHomeRoute("/proj/review/gitlab.example.com")).toEqual({ kind: "review", target: null });
		expect(parseHomeRoute("/proj/review/gitlab.example.com/42")).toEqual({ kind: "review", target: null });
		expect(parseHomeRoute("/proj/review/gitlab.example.com/abc/9")).toEqual({ kind: "review", target: null });
		expect(parseHomeRoute("/proj/review/gitlab.example.com/0/9")).toEqual({ kind: "review", target: null });
	});

	it("treats an empty trailing id as no id", () => {
		expect(parseHomeRoute("/proj/plans/")).toEqual({ kind: "plans", planId: null });
		expect(parseHomeRoute("/proj/agents/")).toEqual({ kind: "agents", flowId: null });
	});

	it("encodes ids that would otherwise add segments", () => {
		const pathname = buildHomePathname("my project", { kind: "plans", planId: "a/b c" });
		expect(pathname).toBe("/my%20project/plans/a%2Fb%20c");
		expect(parseHomeRoute(pathname)).toEqual({ kind: "plans", planId: "a/b c" });
	});

	it("has nowhere to point without a project", () => {
		expect(buildHomePathname(null, { kind: "plans", planId: "plan-7" })).toBe("/");
	});
});

describe("replaceProjectSegment", () => {
	it("swaps the project and keeps the route", () => {
		expect(replaceProjectSegment("/old/plans/plan-7", "new")).toBe("/new/plans/plan-7");
		expect(replaceProjectSegment("/old", "new")).toBe("/new");
		expect(replaceProjectSegment("/", "new")).toBe("/new");
	});

	it("preserves encoding rather than doubling it", () => {
		expect(replaceProjectSegment("/old/plans/a%2Fb", "my project")).toBe("/my%20project/plans/a%2Fb");
	});
});

describe("route projections", () => {
	it("maps each section to its own bare route and back", () => {
		for (const section of ["projects", "manager", "plans", "review", "agents"] as const) {
			expect(homeRouteSidebarSection(sectionHomeRoute(section))).toBe(section);
		}
	});

	it("keeps an opened surface on the section it came from", () => {
		expect(homeRouteSidebarSection({ kind: "plans", planId: "plan-7" })).toBe("plans");
		expect(homeRouteSidebarSection({ kind: "agents", flowId: "flow-1" })).toBe("agents");
		// A center view belongs to no list, so the sidebar stays on Projects.
		expect(homeRouteSidebarSection({ kind: "center", view: "docs" })).toBe("projects");
	});

	it("reports the center pane", () => {
		expect(homeRouteCenterView({ kind: "center", view: "understand" })).toBe("understand");
		expect(homeRouteCenterView({ kind: "plans", planId: "plan-7" })).toBe("board");
	});
});
