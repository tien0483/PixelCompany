import { describe, expect, it } from "vitest";

import { isSessionPausedLive, isSessionPausedOffline, pausedOfflineBadgeLabel } from "@/runtime/session-status";

describe("isSessionPausedOffline", () => {
	it.each([
		{ pausedAt: 100, pid: null, expected: true },
		{ pausedAt: 100, pid: 4242, expected: false },
		{ pausedAt: null, pid: null, expected: false },
		{ pausedAt: null, pid: 4242, expected: false },
	])("pausedAt=$pausedAt pid=$pid -> $expected", ({ pausedAt, pid, expected }) => {
		expect(isSessionPausedOffline({ pausedAt, pid })).toBe(expected);
	});
});

describe("isSessionPausedLive", () => {
	it.each([
		{ pausedAt: 100, pid: 4242, expected: true },
		{ pausedAt: 100, pid: null, expected: false },
		{ pausedAt: null, pid: 4242, expected: false },
		{ pausedAt: null, pid: null, expected: false },
	])("pausedAt=$pausedAt pid=$pid -> $expected", ({ pausedAt, pid, expected }) => {
		expect(isSessionPausedLive({ pausedAt, pid })).toBe(expected);
	});
});

describe("isSessionPausedOffline / isSessionPausedLive", () => {
	it("are mutually exclusive for every paused combination and both false when not paused", () => {
		const combinations = [
			{ pausedAt: 100, pid: null },
			{ pausedAt: 100, pid: 4242 },
			{ pausedAt: null, pid: null },
			{ pausedAt: null, pid: 4242 },
		];
		for (const summary of combinations) {
			const offline = isSessionPausedOffline(summary);
			const live = isSessionPausedLive(summary);
			expect(offline && live).toBe(false);
			if (summary.pausedAt == null) {
				expect(offline).toBe(false);
				expect(live).toBe(false);
			} else {
				expect(offline || live).toBe(true);
			}
		}
	});
});

describe("pausedOfflineBadgeLabel", () => {
	it("returns the paused-offline badge copy", () => {
		expect(pausedOfflineBadgeLabel()).toBe("Paused — session ended");
	});
});
