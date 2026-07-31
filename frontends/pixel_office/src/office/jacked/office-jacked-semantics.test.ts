import { describe, expect, it } from "vitest";
import type { RuntimeJackedSnapshot } from "@/runtime/types";
import { deriveOfficeJackedSemantics } from "./office-jacked-semantics";

function snapshot(partial: Partial<RuntimeJackedSnapshot> = {}): RuntimeJackedSnapshot {
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
	};
}

describe("deriveOfficeJackedSemantics", () => {
	it("returns empty semantics when jacked is offline", () => {
		const semantics = deriveOfficeJackedSemantics(null);
		expect(semantics.meters).toEqual([]);
		expect(semantics.pressure).toBe(0);
	});

	it("builds Claude-only meters and ignores other providers", () => {
		const semantics = deriveOfficeJackedSemantics(
			snapshot({
				pressure: 0.8,
				activeAccountId: 1,
				accounts: [
					{
						id: 1,
						provider: "claude",
						email: "c@x.com",
						displayName: null,
						organizationName: null,
						isActive: true,
						fiveHourPercent: 80,
						sevenDayPercent: 20,
						pressure: 0.8,
						nextRefreshAt: null,
						canAutoSwap: true,
						canTrackUsage: true,
						hasCcToken: true,
					},
					{
						id: 2,
						provider: "cursor",
						email: "u@cursor.com",
						displayName: null,
						organizationName: null,
						isActive: true,
						fiveHourPercent: 10,
						sevenDayPercent: null,
						pressure: 0.1,
						nextRefreshAt: null,
						canAutoSwap: false,
						canTrackUsage: true,
						hasCcToken: true,
					},
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
		expect(semantics.meters).toHaveLength(1);
		expect(semantics.meters[0]?.provider).toBe("claude");
		expect(semantics.meters[0]?.canAutoSwap).toBe(true);
		expect(semantics.reviewers).toHaveLength(1);
		expect(semantics.memoryVault.enabled).toBe(true);
		expect(semantics.memoryVault.lessonsActive).toBe(4);
	});
});
