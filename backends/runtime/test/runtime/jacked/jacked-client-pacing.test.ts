import { describe, expect, it } from "vitest";

import { parsePacing } from "../../../src/manager/manager-client";

describe("parsePacing", () => {
	it("maps a constrained summary to allExhausted with the reset in epoch ms", () => {
		const result = parsePacing({
			best_account_worst_window_pct: 96,
			pause_until: "2099-01-05T00:00:00+00:00",
		});
		expect(result).not.toBeNull();
		expect(result?.worstWindowPct).toBe(96);
		expect(result?.allExhausted).toBe(true);
		expect(result?.pauseUntil).toBe(Date.parse("2099-01-05T00:00:00+00:00"));
	});

	it("treats a headroom summary as not exhausted with a null pause target", () => {
		const result = parsePacing({ best_account_worst_window_pct: 12, pause_until: null });
		expect(result).toEqual({ pauseUntil: null, worstWindowPct: 12, allExhausted: false });
	});

	it("holds allExhausted false just below the constrained threshold and true at it", () => {
		expect(parsePacing({ best_account_worst_window_pct: 89 })?.allExhausted).toBe(false);
		expect(parsePacing({ best_account_worst_window_pct: 90 })?.allExhausted).toBe(true);
	});

	it("returns null for a non-object payload (jacked offline / 503)", () => {
		expect(parsePacing(null)).toBeNull();
		expect(parsePacing("nope")).toBeNull();
	});

	it("tolerates an unparseable pause_until by leaving it null", () => {
		const result = parsePacing({ best_account_worst_window_pct: 99, pause_until: "not-a-date" });
		expect(result?.pauseUntil).toBeNull();
		expect(result?.allExhausted).toBe(true);
	});
});
