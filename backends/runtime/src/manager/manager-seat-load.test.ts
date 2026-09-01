import { describe, expect, it } from "vitest";

import { buildClaudeSeatLoadFromSummaries } from "./manager-seat-load";

describe("buildClaudeSeatLoadFromSummaries", () => {
	it("counts only running Claude sessions with a pinned seat", () => {
		expect(
			buildClaudeSeatLoadFromSummaries([
				{ agentId: "claude", managerAccountId: 1, state: "running" },
				{ agentId: "claude", managerAccountId: 1, state: "running" },
				{ agentId: "claude", managerAccountId: 2, state: "awaiting_review" },
				{ agentId: "cursor", managerAccountId: 3, state: "running" },
				{ agentId: "claude", managerAccountId: null, state: "running" },
			]),
		).toEqual({ 1: 2 });
	});
});
