import { describe, expect, it, vi } from "vitest";

import { createClaudeUsageReader } from "./claude-usage";

/**
 * Shaped like the real `GET /api/oauth/usage` body — see the manager's fixtures in
 * `backends/manager/tests/unit/test_usage_per_model.py`. Only the two window objects
 * matter here; everything else upstream sends is ignored on purpose.
 */
const USAGE_BODY = {
	five_hour: { utilization: 96, resets_at: "2026-07-03T18:00:00+00:00" },
	seven_day: { utilization: 52, resets_at: "2026-07-06T05:00:00Z" },
	seven_day_opus: null,
	limits: [{ kind: "session", group: "session", percent: 96, severity: "critical" }],
};

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("createClaudeUsageReader", () => {
	it("reports no-credentials without touching the network", async () => {
		const fetchImpl = vi.fn();
		const reader = createClaudeUsageReader({
			readAccessToken: async () => null,
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		expect(await reader.get()).toEqual({ available: false, reason: "no-credentials" });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("maps the upstream windows onto the manager's field names", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse(200, USAGE_BODY));
		const reader = createClaudeUsageReader({
			readAccessToken: async () => "token-abc",
			fetchImpl: fetchImpl as unknown as typeof fetch,
			now: () => 1_800_000_000_000,
		});

		expect(await reader.get()).toEqual({
			available: true,
			fiveHourPercent: 96,
			sevenDayPercent: 52,
			fiveHourResetsAt: "2026-07-03T18:00:00+00:00",
			sevenDayResetsAt: "2026-07-06T05:00:00Z",
			fetchedAt: 1_800_000_000,
		});

		const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe("https://api.anthropic.com/api/oauth/usage");
		expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-abc");
		expect((init.headers as Record<string, string>)["anthropic-beta"]).toBe("oauth-2025-04-20");
	});

	it("nulls out a window the upstream omits", async () => {
		const reader = createClaudeUsageReader({
			readAccessToken: async () => "token-abc",
			fetchImpl: (async () => jsonResponse(200, { five_hour: { utilization: 12 } })) as unknown as typeof fetch,
			now: () => 0,
		});

		expect(await reader.get()).toEqual({
			available: true,
			fiveHourPercent: 12,
			sevenDayPercent: null,
			fiveHourResetsAt: null,
			sevenDayResetsAt: null,
			fetchedAt: 0,
		});
	});

	it("reports unauthorized on 401 and never retries with a refreshed token", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse(401, { error: "unauthorized" }));
		const reader = createClaudeUsageReader({
			readAccessToken: async () => "token-abc",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		expect(await reader.get()).toEqual({ available: false, reason: "unauthorized" });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("reports unreachable when the request throws", async () => {
		const reader = createClaudeUsageReader({
			readAccessToken: async () => "token-abc",
			fetchImpl: (async () => {
				throw new Error("ECONNREFUSED");
			}) as unknown as typeof fetch,
		});

		expect(await reader.get()).toEqual({ available: false, reason: "unreachable" });
	});

	it("serves repeat calls inside the TTL from cache, then refetches after it expires", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse(200, USAGE_BODY));
		let nowMs = 1_000_000;
		const reader = createClaudeUsageReader({
			readAccessToken: async () => "token-abc",
			fetchImpl: fetchImpl as unknown as typeof fetch,
			now: () => nowMs,
			cacheTtlMs: 60_000,
		});

		await reader.get();
		nowMs += 59_000;
		await reader.get();
		expect(fetchImpl).toHaveBeenCalledTimes(1);

		nowMs += 2_000;
		await reader.get();
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("collapses concurrent callers into a single upstream request", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse(200, USAGE_BODY));
		const reader = createClaudeUsageReader({
			readAccessToken: async () => "token-abc",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		const [first, second] = await Promise.all([reader.get(), reader.get()]);

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(first).toEqual(second);
	});
});
