import { describe, expect, it } from "vitest";

import { isSessionPausedLive, isSessionPausedOffline, pausedOfflineBadgeLabel } from "@/runtime/session-status";

describe("isSessionPausedOffline", () => {
	it.each([
		{ pausedAt: 100, pid: null, expected: true },
		{ pausedAt: 100, pid: 4242, expected: false },
		{ pausedAt: null, pid: null, expected: false },
		{ pausedAt: null, pid: 4242, expected: false },
	])("pausedAt=$pausedAt pid=$pid -> $expected", ({ pausedAt, pid, expected }) => {
		expect(isSessionPausedOffline({ pausedAt, pid, agentId: "codex" })).toBe(expected);
	});
});

describe("isSessionPausedLive", () => {
	it.each([
		{ pausedAt: 100, pid: 4242, expected: true },
		{ pausedAt: 100, pid: null, expected: false },
		{ pausedAt: null, pid: 4242, expected: false },
		{ pausedAt: null, pid: null, expected: false },
	])("pausedAt=$pausedAt pid=$pid -> $expected", ({ pausedAt, pid, expected }) => {
		expect(isSessionPausedLive({ pausedAt, pid, agentId: "codex" })).toBe(expected);
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
			const withAgentId = { ...summary, agentId: "codex" as const };
			const offline = isSessionPausedOffline(withAgentId);
			const live = isSessionPausedLive(withAgentId);
			expect(offline && live).toBe(false);
			if (withAgentId.pausedAt == null) {
				expect(offline).toBe(false);
				expect(live).toBe(false);
			} else {
				expect(offline || live).toBe(true);
			}
		}
	});
});

describe("Cline sessions (no PTY/pid — never offline)", () => {
	it.each([
		{ pausedAt: 100, pid: null, expectedOffline: false, expectedLive: true },
		{ pausedAt: null, pid: null, expectedOffline: false, expectedLive: false },
	])("pausedAt=$pausedAt -> offline=$expectedOffline live=$expectedLive", ({ pausedAt, pid, expectedOffline, expectedLive }) => {
		const summary = { pausedAt, pid, agentId: "cline" as const };
		expect(isSessionPausedOffline(summary)).toBe(expectedOffline);
		expect(isSessionPausedLive(summary)).toBe(expectedLive);
	});
});

describe("pausedOfflineBadgeLabel", () => {
	it("returns the paused-offline badge copy", () => {
		expect(pausedOfflineBadgeLabel()).toBe("Paused — session ended");
	});
});
