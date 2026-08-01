import { describe, expect, it } from "vitest";

import type { RuntimeJackedAccount, RuntimeJackedPacing, RuntimeJackedSnapshot } from "../../../src/core/api-contract";
import { classifyUsagePause, UNKNOWN_WAKE_BACKOFF_MS } from "../../../src/jacked/usage-pause";

const NOW = 1_000_000_000_000;
const FUTURE = NOW + 3 * 60 * 60 * 1000; // 3h out
const PAST = NOW - 60_000;

function makeAccount(partial: Partial<RuntimeJackedAccount> & { id: number }): RuntimeJackedAccount {
	return {
		provider: "claude",
		email: `acct${partial.id}@x.com`,
		displayName: null,
		organizationName: null,
		isActive: true,
		fiveHourPercent: null,
		sevenDayPercent: null,
		fiveHourResetsAt: null,
		sevenDayResetsAt: null,
		pressure: 0,
		nextRefreshAt: null,
		canAutoSwap: true,
		canTrackUsage: true,
		hasCcToken: true,
		...partial,
	};
}

function makeSnapshot(accounts: RuntimeJackedAccount[], pacing: RuntimeJackedPacing | null): RuntimeJackedSnapshot {
	return {
		version: null,
		accounts,
		activeAccountId: null,
		pressure: 0,
		swapPausedUntil: null,
		autoSwapEnabled: true,
		pacing,
		features: [],
		latestSwap: null,
		lessonsActive: null,
		fetchedAt: NOW,
		stale: false,
	};
}

describe("classifyUsagePause", () => {
	it("returns null when the task did not opt in", () => {
		const snapshot = makeSnapshot([], { pauseUntil: FUTURE, worstWindowPct: 99, allExhausted: true });
		expect(
			classifyUsagePause({
				autoResumeOnUsageLimit: false,
				jackedAccountId: null,
				snapshot,
				errorText: "usage limit reached",
				now: NOW,
			}),
		).toBeNull();
	});

	describe("unpinned (fleet)", () => {
		it("wakes at the fleet pause_until when all accounts are exhausted", () => {
			const snapshot = makeSnapshot([], { pauseUntil: FUTURE, worstWindowPct: 99, allExhausted: true });
			expect(
				classifyUsagePause({
					autoResumeOnUsageLimit: true,
					jackedAccountId: null,
					snapshot,
					errorText: null,
					now: NOW,
				}),
			).toEqual({ resumeAt: FUTURE, source: "reset" });
		});

		it("backs off when exhausted but pause_until is unknown", () => {
			const snapshot = makeSnapshot([], { pauseUntil: null, worstWindowPct: 99, allExhausted: true });
			expect(
				classifyUsagePause({
					autoResumeOnUsageLimit: true,
					jackedAccountId: null,
					snapshot,
					errorText: null,
					now: NOW,
				}),
			).toEqual({ resumeAt: NOW + UNKNOWN_WAKE_BACKOFF_MS, source: "backoff" });
		});

		it("does not pause when the fleet has headroom and there is no error signal", () => {
			const snapshot = makeSnapshot([], { pauseUntil: null, worstWindowPct: 20, allExhausted: false });
			expect(
				classifyUsagePause({
					autoResumeOnUsageLimit: true,
					jackedAccountId: null,
					snapshot,
					errorText: null,
					now: NOW,
				}),
			).toBeNull();
		});

		it("pauses on an error string alone when the snapshot looks clear (cold-snapshot race)", () => {
			const snapshot = makeSnapshot([], { pauseUntil: null, worstWindowPct: 20, allExhausted: false });
			expect(
				classifyUsagePause({
					autoResumeOnUsageLimit: true,
					jackedAccountId: null,
					snapshot,
					errorText: "Claude usage limit reached · resets at 5pm",
					now: NOW,
				}),
			).toEqual({ resumeAt: NOW + UNKNOWN_WAKE_BACKOFF_MS, source: "backoff" });
		});

		it("treats a credit/balance error as NOT a usage pause", () => {
			const snapshot = makeSnapshot([], { pauseUntil: null, worstWindowPct: 20, allExhausted: false });
			expect(
				classifyUsagePause({
					autoResumeOnUsageLimit: true,
					jackedAccountId: null,
					snapshot,
					errorText: "Insufficient balance — out of credits",
					now: NOW,
				}),
			).toBeNull();
		});
	});

	describe("pinned account", () => {
		it("wakes at the pinned account's constrained window reset (even if the fleet has headroom)", () => {
			const walled = makeAccount({ id: 7, sevenDayPercent: 97, sevenDayResetsAt: FUTURE });
			const spare = makeAccount({ id: 8, fiveHourPercent: 5 });
			const snapshot = makeSnapshot([walled, spare], { pauseUntil: null, worstWindowPct: 5, allExhausted: false });
			expect(
				classifyUsagePause({
					autoResumeOnUsageLimit: true,
					jackedAccountId: 7,
					snapshot,
					errorText: null,
					now: NOW,
				}),
			).toEqual({ resumeAt: FUTURE, source: "reset" });
		});

		it("takes the LATEST reset among multiple constrained windows", () => {
			const later = FUTURE + 60 * 60 * 1000;
			const walled = makeAccount({
				id: 7,
				fiveHourPercent: 95,
				fiveHourResetsAt: FUTURE,
				sevenDayPercent: 98,
				sevenDayResetsAt: later,
			});
			const snapshot = makeSnapshot([walled], null);
			expect(
				classifyUsagePause({
					autoResumeOnUsageLimit: true,
					jackedAccountId: 7,
					snapshot,
					errorText: null,
					now: NOW,
				}),
			).toEqual({ resumeAt: later, source: "reset" });
		});

		it("backs off when walled but the reset is in the past / unknown", () => {
			const walled = makeAccount({ id: 7, sevenDayPercent: 97, sevenDayResetsAt: PAST });
			const snapshot = makeSnapshot([walled], null);
			expect(
				classifyUsagePause({
					autoResumeOnUsageLimit: true,
					jackedAccountId: 7,
					snapshot,
					errorText: null,
					now: NOW,
				}),
			).toEqual({ resumeAt: NOW + UNKNOWN_WAKE_BACKOFF_MS, source: "backoff" });
		});

		it("does not pause a pinned task whose account has headroom", () => {
			const spare = makeAccount({ id: 7, fiveHourPercent: 40, sevenDayPercent: 55 });
			const snapshot = makeSnapshot([spare], { pauseUntil: FUTURE, worstWindowPct: 99, allExhausted: true });
			expect(
				classifyUsagePause({
					autoResumeOnUsageLimit: true,
					jackedAccountId: 7,
					snapshot,
					errorText: null,
					now: NOW,
				}),
			).toBeNull();
		});

		it("falls back to the error string when the pinned account is absent from the snapshot", () => {
			const snapshot = makeSnapshot([makeAccount({ id: 99 })], null);
			expect(
				classifyUsagePause({
					autoResumeOnUsageLimit: true,
					jackedAccountId: 7,
					snapshot,
					errorText: "rate limit exceeded, try again later",
					now: NOW,
				}),
			).toEqual({ resumeAt: NOW + UNKNOWN_WAKE_BACKOFF_MS, source: "backoff" });
		});
	});
});
