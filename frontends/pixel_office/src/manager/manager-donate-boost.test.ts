import { beforeEach, describe, expect, it } from "vitest";

import {
	type DonateBoostAccount,
	type DonateBoostRecord,
	clearDonateBoost,
	isDonateBoostEligible,
	planDonateBoost,
	planDonateRestore,
	readDonateBoost,
	writeDonateBoost,
} from "@/manager/manager-donate-boost";
import { LocalStorageKey } from "@/storage/local-storage-store";

function seat(overrides: Partial<DonateBoostAccount> & { id: number }): DonateBoostAccount {
	return {
		provider: "claude",
		donateLimitPercent: 70,
		donateLimitLocked: false,
		isActive: true,
		hasCcToken: true,
		ccNeedsAuth: false,
		...overrides,
	};
}

function boosted(prior: Record<string, number>): DonateBoostRecord {
	return { v: 1, active: true, prior };
}

describe("isDonateBoostEligible", () => {
	it("accepts a healthy, enabled Claude seat", () => {
		expect(isDonateBoostEligible(seat({ id: 1 }))).toBe(true);
	});

	it("refuses locked, deactivated and CC-auth-pending seats", () => {
		expect(isDonateBoostEligible(seat({ id: 1, donateLimitLocked: true }))).toBe(false);
		expect(isDonateBoostEligible(seat({ id: 2, isActive: false }))).toBe(false);
		expect(isDonateBoostEligible(seat({ id: 3, hasCcToken: false }))).toBe(false);
		expect(isDonateBoostEligible(seat({ id: 4, ccNeedsAuth: true }))).toBe(false);
	});

	it("does not require CC tokens from a Cursor seat", () => {
		expect(
			isDonateBoostEligible(
				seat({ id: 5, provider: "cursor", hasCcToken: false, ccNeedsAuth: true }),
			),
		).toBe(true);
	});
});

describe("planDonateBoost", () => {
	it("patches every eligible seat to 100 and counts the rest as skipped", () => {
		const plan = planDonateBoost([
			seat({ id: 1, donateLimitPercent: 40 }),
			seat({ id: 2, donateLimitPercent: 70 }),
			seat({ id: 3, donateLimitPercent: 30, donateLimitLocked: true }),
			seat({ id: 4, donateLimitPercent: 50, isActive: false }),
		]);
		expect(plan.patches).toEqual([
			{ accountId: 1, percent: 100 },
			{ accountId: 2, percent: 100 },
		]);
		expect(plan.skipped).toBe(2);
	});

	it("remembers an already-maxed seat without patching it", () => {
		const plan = planDonateBoost([
			seat({ id: 1, donateLimitPercent: 100 }),
			seat({ id: 2, donateLimitPercent: 60 }),
		]);
		expect(plan.patches).toEqual([{ accountId: 2, percent: 100 }]);
		expect(plan.prior).toEqual({ "1": 100, "2": 60 });
	});
});

describe("planDonateRestore", () => {
	it("puts remembered seats back", () => {
		const plan = planDonateRestore(
			[seat({ id: 1, donateLimitPercent: 100 }), seat({ id: 2, donateLimitPercent: 100 })],
			boosted({ "1": 40, "2": 70 }),
		);
		expect(plan.patches).toEqual([
			{ accountId: 1, percent: 40 },
			{ accountId: 2, percent: 70 },
		]);
		expect(plan.skipped).toBe(0);
	});

	it("leaves a seat the user moved by hand alone", () => {
		const plan = planDonateRestore(
			[seat({ id: 1, donateLimitPercent: 40 })],
			boosted({ "1": 70 }),
		);
		expect(plan.patches).toEqual([]);
		expect(plan.skipped).toBe(1);
	});

	it("skips seats that disappeared or stopped being eligible", () => {
		const plan = planDonateRestore(
			[seat({ id: 2, donateLimitPercent: 100, isActive: false })],
			boosted({ "1": 40, "2": 50 }),
		);
		expect(plan.patches).toEqual([]);
		expect(plan.skipped).toBe(2);
	});

	it("does not patch a seat that started out maxed", () => {
		const plan = planDonateRestore(
			[seat({ id: 1, donateLimitPercent: 100 })],
			boosted({ "1": 100 }),
		);
		expect(plan.patches).toEqual([]);
		expect(plan.skipped).toBe(0);
	});
});

describe("donate boost record storage", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("round-trips through localStorage", () => {
		writeDonateBoost(boosted({ "1": 40 }));
		expect(readDonateBoost()).toEqual({ v: 1, active: true, prior: { "1": 40 } });
		clearDonateBoost();
		expect(readDonateBoost().active).toBe(false);
	});

	it("reads corrupt or foreign payloads as not boosted", () => {
		window.localStorage.setItem(LocalStorageKey.ManagerDonateBoost, "{not json");
		expect(readDonateBoost()).toEqual({ v: 1, active: false, prior: {} });
		window.localStorage.setItem(LocalStorageKey.ManagerDonateBoost, JSON.stringify({ v: 2, active: true }));
		expect(readDonateBoost().active).toBe(false);
	});

	it("drops non-numeric prior entries and clamps the rest", () => {
		window.localStorage.setItem(
			LocalStorageKey.ManagerDonateBoost,
			JSON.stringify({ v: 1, active: true, prior: { "1": "nope", "2": 140, "3": -5 } }),
		);
		expect(readDonateBoost().prior).toEqual({ "2": 100, "3": 0 });
	});
});
