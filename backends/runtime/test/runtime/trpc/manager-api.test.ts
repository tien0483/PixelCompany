import { describe, expect, it, vi } from "vitest";

import type { RuntimeManagerSnapshot } from "../../../src/core/api-contract";
import { createManagerApi } from "../../../src/trpc/manager-api";

function sampleSnapshot(overrides: Partial<RuntimeManagerSnapshot> = {}): RuntimeManagerSnapshot {
	return {
		version: "1.0.0",
		accounts: [
			{
				id: 1,
				provider: "claude",
				email: "claude@example.com",
				displayName: null,
				organizationName: null,
				isActive: true,
				fiveHourPercent: 10,
				sevenDayPercent: 5,
				fiveHourResetsAt: null,
				sevenDayResetsAt: null,
				usageCachedAt: null,
				subscriptionType: null,
				donateLimitPercent: 100,
				pressure: 0.1,
				nextRefreshAt: null,
				canAutoSwap: true,
				canTrackUsage: true,
				hasCcToken: true,
				isActiveForProvider: true,
				validationStatus: "valid",
				lastError: null,
			},
			{
				id: 3,
				provider: "cursor",
				email: "cursor@example.com",
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
				canAutoSwap: false,
				canTrackUsage: true,
				hasCcToken: false,
				isActiveForProvider: true,
				validationStatus: "valid",
				lastError: null,
			},
		],
		activeAccountId: 1,
		pressure: 0.1,
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

function createDeps() {
	const monitor = {
		getState: vi.fn(() => sampleSnapshot()),
		refresh: vi.fn(async () => sampleSnapshot()),
	};
	const client = {
		reimportCursorAccount: vi.fn(async () => ({
			ok: true,
			accountId: 3,
			email: "cursor@example.com",
		})),
		startAccountReauth: vi.fn(),
		startAccountAuthorizeCc: vi.fn(),
	};
	return { monitor, client, api: createManagerApi({ monitor: monitor as never, client: client as never }) };
}

describe("createManagerApi reimportCursorAccount", () => {
	it("reimports a Cursor account and refreshes the monitor", async () => {
		const { api, client, monitor } = createDeps();

		const result = await api.reimportCursorAccount({ accountId: 3 });

		expect(result).toEqual({
			ok: true,
			accountId: 3,
			email: "cursor@example.com",
		});
		expect(client.reimportCursorAccount).toHaveBeenCalledWith(3);
		expect(monitor.refresh).toHaveBeenCalledTimes(1);
	});

	it("refuses re-import for Claude accounts", async () => {
		const { api, client, monitor } = createDeps();

		const result = await api.reimportCursorAccount({ accountId: 1 });

		expect(result).toEqual({
			ok: false,
			error: "Only Cursor accounts support this action.",
		});
		expect(client.reimportCursorAccount).not.toHaveBeenCalled();
		expect(monitor.refresh).not.toHaveBeenCalled();
	});

	it("refuses Claude-only reauth for Cursor accounts", async () => {
		const { api, client } = createDeps();

		const result = await api.startAccountReauth({ accountId: 3 });

		expect(result).toEqual({
			ok: false,
			error: "Only Claude accounts support this action.",
		});
		expect(client.startAccountReauth).not.toHaveBeenCalled();
	});

	it("refuses Claude-only authorize-cc for Cursor accounts", async () => {
		const { api, client } = createDeps();

		const result = await api.startAccountAuthorizeCc({ accountId: 3 });

		expect(result).toEqual({
			ok: false,
			error: "Only Claude accounts support this action.",
		});
		expect(client.startAccountAuthorizeCc).not.toHaveBeenCalled();
	});
});
