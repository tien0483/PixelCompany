import { describe, expect, it } from "vitest";

import {
	formatResetHint,
	formatUsageCacheAge,
	isDonateExhausted,
	usagePressurePercent,
} from "@/manager/manager-format";

describe("usagePressurePercent / isDonateExhausted", () => {
	it("takes the tighter of 5h and 7d", () => {
		expect(usagePressurePercent({ fiveHourPercent: 40, sevenDayPercent: 80 })).toBe(80);
		expect(
			isDonateExhausted({
				fiveHourPercent: 80,
				sevenDayPercent: 40,
				donateLimitPercent: 70,
			}),
		).toBe(true);
		expect(
			isDonateExhausted({
				fiveHourPercent: 60,
				sevenDayPercent: 40,
				donateLimitPercent: 70,
			}),
		).toBe(false);
	});
});

describe("formatResetHint", () => {
	it("returns a short resets caption for future timestamps", () => {
		const now = Date.parse("2026-08-01T12:00:00Z");
		const hint = formatResetHint("2026-08-01T15:30:00Z", now);
		expect(hint).toMatch(/^resets /);
	});

	it("labels past windows", () => {
		expect(formatResetHint("2020-01-01T00:00:00Z", Date.parse("2026-08-01T12:00:00Z"))).toBe(
			"no active window",
		);
	});
});

describe("formatUsageCacheAge", () => {
	it("formats never / minutes / hours", () => {
		expect(formatUsageCacheAge(null)).toBe("never");
		const nowMs = 1_700_000_000_000;
		expect(formatUsageCacheAge(1_700_000_000 - 120, nowMs)).toBe("2m ago");
		expect(formatUsageCacheAge(1_700_000_000 - 7_200, nowMs)).toBe("2h ago");
	});
});
