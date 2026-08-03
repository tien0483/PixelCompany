import { describe, expect, it, vi } from "vitest";

import {
	createUsageAuthSession,
	lookupUsageAuthCode,
	resolveUsageAuthBaseUrl,
} from "./vercel-auth-proxy.js";

describe("resolveUsageAuthBaseUrl", () => {
	it("strips trailing slashes from env override", () => {
		expect(resolveUsageAuthBaseUrl("https://example.vercel.app/")).toBe(
			"https://example.vercel.app",
		);
	});

	it("falls back to the default deployment when env is empty", () => {
		expect(resolveUsageAuthBaseUrl("")).toContain("vercel.app");
		expect(resolveUsageAuthBaseUrl(undefined)).toContain("vercel.app");
	});
});

describe("createUsageAuthSession", () => {
	it("posts sessionId + authLink and returns formUrl", async () => {
		const fetchImpl = vi.fn(async () =>
			Response.json({
				success: true,
				sessionId: "sess-1",
				formUrl: "https://example.vercel.app/?sessionId=sess-1",
			}),
		);
		const result = await createUsageAuthSession("https://claude.ai/oauth", {
			baseUrl: "https://example.vercel.app",
			sessionId: "sess-1",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		expect(result).toEqual({
			sessionId: "sess-1",
			formUrl: "https://example.vercel.app/?sessionId=sess-1",
		});
		expect(fetchImpl).toHaveBeenCalledWith(
			"https://example.vercel.app/api/session/create",
			expect.objectContaining({
				method: "POST",
				redirect: "follow",
			}),
		);
	});

	it("rewrites localhost formUrl to the public base URL", async () => {
		const fetchImpl = vi.fn(async () =>
			Response.json({
				sessionId: "sess-1",
				formUrl: "http://localhost:3000?sessionId=sess-1",
			}),
		);
		const result = await createUsageAuthSession("https://claude.ai/oauth", {
			baseUrl: "https://pixel-office-usage.vercel.app",
			sessionId: "sess-1",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		expect(result.formUrl).toBe(
			"https://pixel-office-usage.vercel.app/?sessionId=sess-1",
		);
	});

	it("sends the Vercel protection bypass header when configured", async () => {
		const fetchImpl = vi.fn(async () =>
			Response.json({
				sessionId: "sess-1",
				formUrl: "https://example.vercel.app/?sessionId=sess-1",
			}),
		);
		await createUsageAuthSession("https://claude.ai/oauth", {
			baseUrl: "https://example.vercel.app",
			sessionId: "sess-1",
			bypassSecret: "bypass-secret",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		expect(fetchImpl).toHaveBeenCalledWith(
			"https://example.vercel.app/api/session/create",
			expect.objectContaining({
				headers: expect.objectContaining({
					"x-vercel-protection-bypass": "bypass-secret",
				}),
			}),
		);
	});

	it("explains 401 deployment protection failures", async () => {
		const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
		await expect(
			createUsageAuthSession("https://claude.ai/oauth", {
				baseUrl: "https://example.vercel.app",
				fetchImpl: fetchImpl as unknown as typeof fetch,
			}),
		).rejects.toThrow(/Deployment Protection|PIXEL_OFFICE_USAGE_BYPASS_SECRET/);
	});
});

describe("lookupUsageAuthCode", () => {
	it("maps 202 to pending and 200 to ready", async () => {
		const pending = await lookupUsageAuthCode("sess-1", {
			baseUrl: "https://example.vercel.app",
			fetchImpl: vi.fn(async () => new Response("{}", { status: 202 })) as unknown as typeof fetch,
		});
		expect(pending.status).toBe("pending");

		const ready = await lookupUsageAuthCode("sess-1", {
			baseUrl: "https://example.vercel.app",
			fetchImpl: vi.fn(async () =>
				Response.json({
					authCode: "abc#xyz",
					percentage: "40",
					submittedAt: 1,
				}),
			) as unknown as typeof fetch,
		});
		expect(ready).toEqual({
			status: "ready",
			authCode: "abc#xyz",
			percentage: 40,
			submittedAt: 1,
			error: null,
		});
	});

	it("maps 404 to expired", async () => {
		const result = await lookupUsageAuthCode("sess-1", {
			baseUrl: "https://example.vercel.app",
			fetchImpl: vi.fn(async () => new Response("{}", { status: 404 })) as unknown as typeof fetch,
		});
		expect(result.status).toBe("expired");
	});
});
