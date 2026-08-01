import { describe, expect, it } from "vitest";

import { isCreditLimitError, isUsageLimitError } from "../../../src/cline-sdk/cline-session-state";

describe("isUsageLimitError", () => {
	it("matches Claude usage-limit / rate-limit phrasings", () => {
		for (const message of [
			"Claude usage limit reached",
			"You've reached your usage limit",
			"5-hour limit reached — resets at 5:00 PM",
			"429 rate limit exceeded, try again later",
			"Weekly limit reached",
		]) {
			expect(isUsageLimitError(message)).toBe(true);
		}
	});

	it("does not match a null / empty / unrelated message", () => {
		expect(isUsageLimitError(null)).toBe(false);
		expect(isUsageLimitError("")).toBe(false);
		expect(isUsageLimitError("connection reset by peer")).toBe(false);
	});

	it("never classifies a credit/balance exhaustion as a (resettable) usage limit", () => {
		for (const message of ["Insufficient balance", "credits exhausted", "402 payment required", "out of credits"]) {
			expect(isCreditLimitError(message)).toBe(true);
			expect(isUsageLimitError(message)).toBe(false);
		}
	});
});
