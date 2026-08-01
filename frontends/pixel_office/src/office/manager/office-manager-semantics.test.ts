import { describe, expect, it } from "vitest";
import type { RuntimeManagerAccount, RuntimeManagerSnapshot } from "@/runtime/types";
import { deriveOfficeManagerSemantics } from "./office-manager-semantics";

function account(partial: Partial<RuntimeManagerAccount> & Pick<RuntimeManagerAccount, "id" | "provider" | "email">): RuntimeManagerAccount {
	return {
		displayName: null,
		organizationName: null,
		isActive: true,
		fiveHourPercent: 0,
		sevenDayPercent: 0,
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
		isActiveForProvider: false,
		validationStatus: "valid",
		lastError: null,
		...partial,
	};
}

function snapshot(partial: Partial<RuntimeManagerSnapshot> = {}): RuntimeManagerSnapshot {
	return {
		version: "1",
		accounts: [],
		activeAccountId: null,
		pressure: 0,
		swapPausedUntil: null,
		autoSwapEnabled: true,
		features: [],
		latestSwap: null,
		lessonsActive: null,
		fetchedAt: Date.now(),
		...partial,
	} as RuntimeManagerSnapshot;
}

describe("deriveOfficeManagerSemantics", () => {
	it("returns empty semantics when Manager is offline", () => {
		const semantics = deriveOfficeManagerSemantics(null);
		expect(semantics.meters).toEqual([]);
		expect(semantics.pressure).toBe(0);
	});

	it("builds Claude and Cursor meters and ignores other providers", () => {
		const semantics = deriveOfficeManagerSemantics(
			snapshot({
				pressure: 0.8,
				activeAccountId: 1,
				accounts: [
					account({
						id: 1,
						provider: "claude",
						email: "c@x.com",
						fiveHourPercent: 80,
						sevenDayPercent: 20,
						pressure: 0.8,
						isActiveForProvider: true,
					}),
					account({
						id: 2,
						provider: "cursor",
						email: "u@cursor.com",
						fiveHourPercent: 10,
						sevenDayPercent: null,
						pressure: 0.1,
						canAutoSwap: false,
					}),
				],
				features: [
					{
						category: "agents",
						name: "security-reviewer",
						displayName: "Security",
						description: "",
						installed: true,
					},
					{
						category: "hooks",
						name: "memory_capture",
						displayName: "Memory",
						description: "",
						installed: true,
					},
				],
				lessonsActive: 4,
			}),
		);
		expect(semantics.meters).toHaveLength(2);
		expect(semantics.meters[0]?.provider).toBe("claude");
		expect(semantics.meters[0]?.canAutoSwap).toBe(true);
		expect(semantics.meters[1]?.provider).toBe("cursor");
		expect(semantics.meters[1]?.canAutoSwap).toBe(false);
		expect(semantics.reviewers).toHaveLength(1);
		expect(semantics.memoryVault.enabled).toBe(true);
		expect(semantics.memoryVault.lessonsActive).toBe(4);
	});

	it("meters the active account, not the worst pressure across all accounts", () => {
		const semantics = deriveOfficeManagerSemantics(
			snapshot({
				activeAccountId: 1,
				accounts: [
					account({
						id: 1,
						provider: "claude",
						email: "trongphuoc.huynh@akselos.com",
						displayName: "Trong Phuoc",
						fiveHourPercent: 10,
						sevenDayPercent: 5,
						pressure: 0.1,
						isActiveForProvider: true,
					}),
					account({
						id: 2,
						provider: "claude",
						email: "hoangtien.nguyen@akselos.com",
						fiveHourPercent: 95,
						sevenDayPercent: 90,
						pressure: 0.95,
					}),
				],
			}),
		);
		expect(semantics.meters).toHaveLength(1);
		expect(semantics.meters[0]?.pressure).toBe(0.1);
		expect(semantics.meters[0]?.accountLabel).toBe("Trong Phuoc");
		expect(semantics.meters[0]?.activeEmail).toBe("trongphuoc.huynh@akselos.com");
	});
});
