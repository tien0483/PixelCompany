import { describe, expect, it, vi } from "vitest";
import type { RuntimeJackedSnapshot } from "../core/api-contract";
import { createJackedMonitor, resolveJackedMonitorState } from "./jacked-monitor";

function sampleSnapshot(overrides: Partial<RuntimeJackedSnapshot> = {}): RuntimeJackedSnapshot {
	return {
		version: "1.0.0",
		accounts: [],
		activeAccountId: null,
		pressure: 0.2,
		swapPausedUntil: null,
		autoSwapEnabled: true,
		features: [],
		latestSwap: null,
		lessonsActive: 0,
		fetchedAt: 1_000,
		stale: false,
		lastSuccessAt: 1_000,
		...overrides,
	};
}

describe("resolveJackedMonitorState", () => {
	it("keeps last-known-good and marks stale when fetch returns null", () => {
		const prior = sampleSnapshot();
		const next = resolveJackedMonitorState(prior, null);
		expect(next).not.toBeNull();
		expect(next?.stale).toBe(true);
		expect(next?.pressure).toBe(0.2);
		expect(next?.lastSuccessAt).toBe(1_000);
	});

	it("stays null when there was never a successful fetch", () => {
		expect(resolveJackedMonitorState(null, null)).toBeNull();
	});

	it("clears stale on a successful fetch", () => {
		const prior = sampleSnapshot({ stale: true, lastSuccessAt: 500 });
		const fresh = sampleSnapshot({ fetchedAt: 2_000, pressure: 0.5 });
		const next = resolveJackedMonitorState(prior, fresh);
		expect(next?.stale).toBe(false);
		expect(next?.pressure).toBe(0.5);
		expect(next?.lastSuccessAt).toBe(2_000);
	});
});

describe("createJackedMonitor LKG", () => {
	it("does not wipe cached state when refresh fails after success", async () => {
		const good = sampleSnapshot({ pressure: 0.4 });
		let calls = 0;
		const client = {
			fetchSnapshot: vi.fn(async () => {
				calls += 1;
				return calls === 1 ? good : null;
			}),
			subscribe: () => () => {},
			close: vi.fn(),
			setFeatureEnabled: vi.fn(),
			pauseSwap: vi.fn(),
			resumeSwap: vi.fn(),
		};
		const onStateUpdated = vi.fn();
		const monitor = createJackedMonitor({
			client: client as never,
			onStateUpdated,
		});
		monitor.connect();
		const first = await monitor.refresh();
		expect(first?.stale).toBe(false);
		const second = await monitor.refresh();
		expect(second?.stale).toBe(true);
		expect(second?.pressure).toBe(0.4);
		monitor.close();
	});
});
