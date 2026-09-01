import { describe, expect, it } from "vitest";

import type { RuntimeManagerAccount, RuntimeManagerPacing, RuntimeManagerSnapshot } from "../../../src/core/api-contract";
import { classifyUsageFailover, isUsageLimitedExit } from "../../../src/jacked/usage-failover";

function makeAccount(partial: Partial<RuntimeManagerAccount> & { id: number }): RuntimeManagerAccount {
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
		usageCachedAt: null,
		subscriptionType: null,
		donateLimitPercent: 100,
		pressure: 0,
		nextRefreshAt: null,
		canAutoSwap: true,
		canTrackUsage: true,
		hasCcToken: true,
		ccNeedsAuth: false,
		donateLimitLocked: false,
		isActiveForProvider: true,
		validationStatus: null,
		lastError: null,
		...partial,
	};
}

function makeSnapshot(accounts: RuntimeManagerAccount[], pacing: RuntimeManagerPacing | null): RuntimeManagerSnapshot {
	return {
		version: null,
		accounts,
		activeAccountId: accounts[0]?.id ?? null,
		pressure: 0,
		swapPausedUntil: null,
		autoSwapEnabled: true,
		pacing,
		features: [],
		latestSwap: null,
		lessonsActive: null,
		fetchedAt: Date.now(),
		stale: false,
	};
}

describe("isUsageLimitedExit", () => {
	it("detects a walled pinned account", () => {
		expect(
			isUsageLimitedExit({
				managerAccountId: 1,
				snapshot: makeSnapshot([makeAccount({ id: 1, fiveHourPercent: 95 })], null),
				errorText: null,
			}),
		).toBe(true);
	});

	it("detects usage error text without jacked data", () => {
		expect(
			isUsageLimitedExit({
				managerAccountId: 1,
				snapshot: null,
				errorText: "You've hit your usage limit",
			}),
		).toBe(true);
	});
});

describe("classifyUsageFailover", () => {
	it("returns the next healthy seat when failover is enabled", () => {
		const next = classifyUsageFailover({
			autoFailoverOnUsageLimit: true,
			agentId: "claude",
			managerAccountId: 1,
			snapshot: makeSnapshot(
				[makeAccount({ id: 1, fiveHourPercent: 95 }), makeAccount({ id: 2, fiveHourPercent: 20 })],
				{ pauseUntil: null, worstWindowPct: 10, allExhausted: false },
			),
			errorText: null,
		});
		expect(next).toBe(2);
	});

	it("returns null when failover is disabled", () => {
		expect(
			classifyUsageFailover({
				autoFailoverOnUsageLimit: false,
				agentId: "claude",
				managerAccountId: 1,
				snapshot: makeSnapshot(
					[makeAccount({ id: 1, fiveHourPercent: 95 }), makeAccount({ id: 2, fiveHourPercent: 20 })],
					{ pauseUntil: null, worstWindowPct: 10, allExhausted: false },
				),
				errorText: null,
			}),
		).toBeNull();
	});

	it("returns null for non-Claude agents", () => {
		expect(
			classifyUsageFailover({
				autoFailoverOnUsageLimit: true,
				agentId: "codex",
				managerAccountId: 1,
				snapshot: makeSnapshot(
					[makeAccount({ id: 1, fiveHourPercent: 95 }), makeAccount({ id: 2, fiveHourPercent: 20 })],
					{ pauseUntil: null, worstWindowPct: 10, allExhausted: false },
				),
				errorText: null,
			}),
		).toBeNull();
	});

	it("returns null when the fleet is fully exhausted", () => {
		expect(
			classifyUsageFailover({
				autoFailoverOnUsageLimit: true,
				agentId: "claude",
				managerAccountId: 1,
				snapshot: makeSnapshot([makeAccount({ id: 1, fiveHourPercent: 95 })], {
					pauseUntil: Date.now() + 60_000,
					worstWindowPct: 99,
					allExhausted: true,
				}),
				errorText: "You've hit your usage limit",
			}),
		).toBeNull();
	});
});
