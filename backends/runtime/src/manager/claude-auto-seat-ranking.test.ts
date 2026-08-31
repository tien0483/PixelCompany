import { describe, expect, it } from "vitest";

import {
	type ClaudeAutoSeatRankingInput,
	FIVE_HOUR_SATURATED_PERCENT,
	isFiveHourSaturated,
	NO_SEVEN_DAY_DATA_TIER,
	pickBestClaudeAutoSeat,
	sevenDayResetTier,
} from "./claude-auto-seat-ranking";

const NOW = Date.parse("2026-08-31T12:00:00Z");

function inHours(hours: number): string {
	return new Date(NOW + hours * 3_600_000).toISOString();
}

function inMinutes(minutes: number): string {
	return new Date(NOW + minutes * 60_000).toISOString();
}

interface Seat extends ClaudeAutoSeatRankingInput {
	id: number;
}

function seat(id: number, overrides: ClaudeAutoSeatRankingInput = {}): Seat {
	return { id, fiveHourPercent: 0, sevenDayPercent: 0, ...overrides };
}

describe("sevenDayResetTier", () => {
	it("buckets by hours of runway, boundaries belonging to the less urgent tier", () => {
		expect(sevenDayResetTier(seat(1, { sevenDayResetsAt: inHours(1) }), NOW)).toBe(0);
		expect(sevenDayResetTier(seat(1, { sevenDayResetsAt: inHours(23.9) }), NOW)).toBe(0);
		expect(sevenDayResetTier(seat(1, { sevenDayResetsAt: inHours(24) }), NOW)).toBe(1);
		expect(sevenDayResetTier(seat(1, { sevenDayResetsAt: inHours(48) }), NOW)).toBe(2);
		expect(sevenDayResetTier(seat(1, { sevenDayResetsAt: inHours(96) }), NOW)).toBe(3);
		expect(sevenDayResetTier(seat(1, { sevenDayResetsAt: inHours(167) }), NOW)).toBe(3);
	});

	it("treats missing, unparseable and already-past resets as no data", () => {
		expect(sevenDayResetTier(seat(1), NOW)).toBe(NO_SEVEN_DAY_DATA_TIER);
		expect(sevenDayResetTier(seat(1, { sevenDayResetsAt: null }), NOW)).toBe(NO_SEVEN_DAY_DATA_TIER);
		expect(sevenDayResetTier(seat(1, { sevenDayResetsAt: "not a date" }), NOW)).toBe(NO_SEVEN_DAY_DATA_TIER);
		expect(sevenDayResetTier(seat(1, { sevenDayResetsAt: inHours(-1) }), NOW)).toBe(NO_SEVEN_DAY_DATA_TIER);
	});
});

describe("isFiveHourSaturated", () => {
	it("is false below the saturation threshold whatever the reset says", () => {
		const account = seat(1, {
			fiveHourPercent: FIVE_HOUR_SATURATED_PERCENT - 1,
			fiveHourResetsAt: inHours(4),
		});
		expect(isFiveHourSaturated(account, NOW)).toBe(false);
	});

	it("is true at the threshold when the reset is far off", () => {
		const account = seat(1, { fiveHourPercent: 95, fiveHourResetsAt: inHours(4) });
		expect(isFiveHourSaturated(account, NOW)).toBe(true);
	});

	it("is false when the reset is imminent — the room comes back right away", () => {
		const account = seat(1, { fiveHourPercent: 95, fiveHourResetsAt: inMinutes(10) });
		expect(isFiveHourSaturated(account, NOW)).toBe(false);
	});

	it("is false when the reset already passed — the cached percent is stale", () => {
		const account = seat(1, { fiveHourPercent: 98, fiveHourResetsAt: inHours(-1) });
		expect(isFiveHourSaturated(account, NOW)).toBe(false);
	});

	it("is true when saturated with no reset published — no evidence relief is coming", () => {
		expect(isFiveHourSaturated(seat(1, { fiveHourPercent: 98 }), NOW)).toBe(true);
	});
});

describe("pickBestClaudeAutoSeat", () => {
	it("returns null for an empty pool", () => {
		expect(pickBestClaudeAutoSeat([], NOW)).toBeNull();
	});

	it("prefers the seat whose 7d window expires soonest, even at higher usage", () => {
		const expiringSoon = seat(1, { sevenDayPercent: 60, sevenDayResetsAt: inHours(20) });
		const plentyOfRunway = seat(2, { sevenDayPercent: 10, sevenDayResetsAt: inHours(120) });
		expect(pickBestClaudeAutoSeat([plentyOfRunway, expiringSoon], NOW)?.id).toBe(1);
	});

	it("prefers the least-used seat within one tier, even when its reset is later", () => {
		const heavier = seat(1, { sevenDayPercent: 60, sevenDayResetsAt: inHours(18) });
		const lighter = seat(2, { sevenDayPercent: 20, sevenDayResetsAt: inHours(22) });
		expect(pickBestClaudeAutoSeat([heavier, lighter], NOW)?.id).toBe(2);
	});

	it("ranks 5h usage into the same score as 7d — max of the two windows", () => {
		const heavyFiveHour = seat(1, {
			fiveHourPercent: 70,
			sevenDayPercent: 10,
			sevenDayResetsAt: inHours(20),
		});
		const evenlyLoaded = seat(2, {
			fiveHourPercent: 30,
			sevenDayPercent: 30,
			sevenDayResetsAt: inHours(20),
		});
		expect(pickBestClaudeAutoSeat([heavyFiveHour, evenlyLoaded], NOW)?.id).toBe(2);
	});

	it("sinks a 5h-saturated seat below a usable one despite a nearer deadline", () => {
		const saturated = seat(1, {
			fiveHourPercent: 95,
			sevenDayPercent: 20,
			fiveHourResetsAt: inHours(4),
			sevenDayResetsAt: inHours(10),
		});
		const usable = seat(2, { sevenDayPercent: 50, sevenDayResetsAt: inHours(150) });
		expect(pickBestClaudeAutoSeat([saturated, usable], NOW)?.id).toBe(2);
	});

	it("still returns a 5h-saturated seat when it is the only candidate", () => {
		const saturated = seat(1, { fiveHourPercent: 99, sevenDayResetsAt: inHours(10) });
		expect(pickBestClaudeAutoSeat([saturated], NOW)?.id).toBe(1);
	});

	it("does not demote a saturated seat whose 5h window resets within the half hour", () => {
		const aboutToReset = seat(1, {
			fiveHourPercent: 95,
			sevenDayPercent: 20,
			fiveHourResetsAt: inMinutes(10),
			sevenDayResetsAt: inHours(20),
		});
		const usable = seat(2, { sevenDayPercent: 20, sevenDayResetsAt: inHours(150) });
		expect(pickBestClaudeAutoSeat([usable, aboutToReset], NOW)?.id).toBe(1);
	});

	it("ranks a seat with no 7d data last, but still picks it when nothing else qualifies", () => {
		const noData = seat(1, { sevenDayPercent: 0 });
		const known = seat(2, { sevenDayPercent: 80, sevenDayResetsAt: inHours(150) });
		expect(pickBestClaudeAutoSeat([noData, known], NOW)?.id).toBe(2);
		expect(pickBestClaudeAutoSeat([noData], NOW)?.id).toBe(1);
	});

	it("breaks ties chronologically across mixed Z and offset timestamps", () => {
		// Lexicographically "2026-09-01T02:00:00+04:00" sorts after "2026-09-01T00:00:00Z",
		// but it is the earlier instant (22:00Z on Aug 31).
		const offsetForm = seat(1, { sevenDayResetsAt: "2026-09-01T02:00:00+04:00" });
		const zForm = seat(2, { sevenDayResetsAt: "2026-09-01T00:00:00Z" });
		expect(pickBestClaudeAutoSeat([zForm, offsetForm], NOW)?.id).toBe(1);
	});

	it("keeps the first candidate on a full tie", () => {
		const first = seat(1, { sevenDayPercent: 30, sevenDayResetsAt: inHours(20) });
		const second = seat(2, { sevenDayPercent: 30, sevenDayResetsAt: inHours(20) });
		expect(pickBestClaudeAutoSeat([first, second], NOW)?.id).toBe(1);
		expect(pickBestClaudeAutoSeat([second, first], NOW)?.id).toBe(2);
	});
});
