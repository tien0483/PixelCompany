import { describe, expect, it } from "vitest";

import { isCreditLimitError, isRetryableApiSeatError, isUsageLimitError } from "../../../src/cline-sdk/cline-session-state";

describe("isUsageLimitError", () => {
	it("matches Claude usage-limit / rate-limit phrasings", () => {
		for (const message of [
			"Claude usage limit reached",
			"You've reached your usage limit",
			"5-hour limit reached — resets at 5:00 PM",
			"429 rate limit exceeded, try again later",
			"Weekly limit reached",
			"429 Too Many Requests",
			"Error: too many requests, please slow down",
		]) {
			expect(isUsageLimitError(message)).toBe(true);
		}
	});

	it("does not match a null / empty / unrelated message", () => {
		expect(isUsageLimitError(null)).toBe(false);
		expect(isUsageLimitError("")).toBe(false);
		expect(isUsageLimitError("connection reset by peer")).toBe(false);
		// A bare "429" with no request/throughput wording should not false-positive
		// (e.g. a port number or line number showing up in unrelated error text).
		expect(isUsageLimitError("listen EADDRINUSE: address already in use :::429")).toBe(false);
	});

	it("never classifies a credit/balance exhaustion as a (resettable) usage limit", () => {
		for (const message of ["Insufficient balance", "credits exhausted", "402 payment required", "out of credits"]) {
			expect(isCreditLimitError(message)).toBe(true);
			expect(isUsageLimitError(message)).toBe(false);
		}
	});
});

describe("isRetryableApiSeatError", () => {
	it("matches rate-limit wording (via isUsageLimitError)", () => {
		expect(isRetryableApiSeatError("429 Too Many Requests")).toBe(true);
	});

	it("matches 5xx / gateway / overload wording", () => {
		for (const message of [
			"502 Bad Gateway",
			"503 Service Unavailable",
			"504 Gateway Timeout",
			"Error: the model is currently overloaded",
		]) {
			expect(isRetryableApiSeatError(message)).toBe(true);
		}
	});

	it("matches network blips", () => {
		for (const message of ["ECONNRESET", "socket hang up", "fetch failed", "connect ETIMEDOUT"]) {
			expect(isRetryableApiSeatError(message)).toBe(true);
		}
	});

	it("retries a short, unrecognized error message", () => {
		expect(isRetryableApiSeatError("upstream closed the connection")).toBe(true);
	});

	it("does not retry a long, unrecognized error message", () => {
		const longMessage =
			"This is a very long and unusual error message that does not match any known transient pattern " +
			"and should not be blindly retried just because it is unrecognized, since it is far longer than " +
			"the short-message threshold.";
		expect(isRetryableApiSeatError(longMessage)).toBe(false);
	});

	it("does not retry a permanent auth/config error even if short", () => {
		for (const message of ["401 Unauthorized", "403 Forbidden", "Invalid API key"]) {
			expect(isRetryableApiSeatError(message)).toBe(false);
		}
	});

	it("never retries a credit/balance exhaustion", () => {
		expect(isRetryableApiSeatError("Insufficient balance — out of credits")).toBe(false);
	});

	it("does not match a null / empty message", () => {
		expect(isRetryableApiSeatError(null)).toBe(false);
		expect(isRetryableApiSeatError("")).toBe(false);
	});
});
