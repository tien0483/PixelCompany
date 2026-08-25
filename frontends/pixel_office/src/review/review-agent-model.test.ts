import { beforeEach, describe, expect, it } from "vitest";

import {
	DEFAULT_REVIEW_AGENT_MODEL,
	normalizeReviewAgentModel,
	readStoredReviewAgentModel,
	writeStoredReviewAgentModel,
} from "@/review/review-agent-model";

describe("normalizeReviewAgentModel", () => {
	it("keeps a known model and trims it", () => {
		expect(normalizeReviewAgentModel("sonnet")).toBe("sonnet");
		expect(normalizeReviewAgentModel(" opus ")).toBe("opus");
	});

	it("falls back to Haiku for anything unrecognised", () => {
		expect(DEFAULT_REVIEW_AGENT_MODEL).toBe("haiku");
		expect(normalizeReviewAgentModel(null)).toBe("haiku");
		expect(normalizeReviewAgentModel("")).toBe("haiku");
		// A model that was renamed or removed must not reach the CLI as `--model`.
		expect(normalizeReviewAgentModel("claude-3-sonnet")).toBe("haiku");
	});
});

describe("stored review model", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("round-trips a chosen model", () => {
		writeStoredReviewAgentModel("opus");
		expect(readStoredReviewAgentModel()).toBe("opus");
	});

	it("reads Haiku when nothing was ever stored", () => {
		expect(readStoredReviewAgentModel()).toBe("haiku");
	});
});
