import { describe, expect, it } from "vitest";

import { buildFlowiseCanvasPath, buildFlowiseStudioUrl } from "./flowise-studio-url";

describe("buildFlowiseCanvasPath", () => {
	it("routes each flow kind to its own canvas", () => {
		expect(buildFlowiseCanvasPath({ id: "a", type: "CHATFLOW" })).toBe("/canvas/a");
		expect(buildFlowiseCanvasPath({ id: "b", type: "MULTIAGENT" })).toBe("/agentcanvas/b");
		expect(buildFlowiseCanvasPath({ id: "c", type: "AGENTFLOW" })).toBe("/v2/agentcanvas/c");
	});

	it("treats an unknown or missing kind as a classic chatflow", () => {
		expect(buildFlowiseCanvasPath({ id: "d" })).toBe("/canvas/d");
		expect(buildFlowiseCanvasPath({ id: "e", type: "SOMETHING_NEW" })).toBe("/canvas/e");
	});

	it("omits the id for a blank canvas", () => {
		expect(buildFlowiseCanvasPath(null)).toBe("/canvas");
	});
});

describe("buildFlowiseStudioUrl", () => {
	it("appends the embed flag so the studio hides its own chrome", () => {
		expect(buildFlowiseStudioUrl("http://127.0.0.1:3010", { id: "a", type: "AGENTFLOW" })).toBe(
			"http://127.0.0.1:3010/v2/agentcanvas/a?embed=1",
		);
	});

	it("tolerates a trailing slash on the base URL", () => {
		expect(buildFlowiseStudioUrl("http://127.0.0.1:3010/", null)).toBe("http://127.0.0.1:3010/canvas?embed=1");
	});

	it("returns an empty string when there is no base URL to frame", () => {
		expect(buildFlowiseStudioUrl("", null)).toBe("");
	});
});
