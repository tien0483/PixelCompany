import { describe, expect, it, vi } from "vitest";

import {
	createAuthSession,
	pollAuthCode,
	resolveVercelAuthBaseUrl,
	VercelAuthSessionError,
} from "@/manager/vercel-auth-session";

describe("resolveVercelAuthBaseUrl", () => {
	it("strips trailing slashes from env override", () => {
		expect(resolveVercelAuthBaseUrl("https://example.vercel.app/")).toBe(
			"https://example.vercel.app",
		);
	});

	it("falls back to the default deployment when env is empty", () => {
		expect(resolveVercelAuthBaseUrl("")).toContain("vercel.app");
		expect(resolveVercelAuthBaseUrl(undefined)).toContain("vercel.app");
	});
});

describe("createAuthSession", () => {
	it("posts sessionId + authLink and returns formUrl", async () => {
		const fetchImpl = vi.fn(async () =>
			Response.json({
				success: true,
				sessionId: "sess-1",
				formUrl: "https://example.vercel.app/?sessionId=sess-1",
			}),
		);
		const result = await createAuthSession("https://claude.ai/oauth", {
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
				body: JSON.stringify({
					sessionId: "sess-1",
					authLink: "https://claude.ai/oauth",
				}),
			}),
		);
	});

	it("throws when the response is not ok", async () => {
		const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
		await expect(
			createAuthSession("https://claude.ai/oauth", {
				baseUrl: "https://example.vercel.app",
				fetchImpl: fetchImpl as unknown as typeof fetch,
			}),
		).rejects.toBeInstanceOf(VercelAuthSessionError);
	});
});

describe("pollAuthCode", () => {
	it("returns auth code and percentage on 200", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(new Response("{}", { status: 202 }))
			.mockResolvedValueOnce(
				Response.json({
					success: true,
					authCode: "abc#xyz",
					percentage: "40",
					submittedAt: 1,
				}),
			);
		const result = await pollAuthCode("sess-1", {
			baseUrl: "https://example.vercel.app",
			fetchImpl: fetchImpl as unknown as typeof fetch,
			pollMs: 1,
			sleep: async () => undefined,
		});
		expect(result).toEqual({
			authCode: "abc#xyz",
			percentage: 40,
			submittedAt: 1,
		});
	});

	it("returns null when cancelled before the next poll", async () => {
		let calls = 0;
		const fetchImpl = vi.fn(async () => {
			calls += 1;
			return new Response("{}", { status: 202 });
		});
		const result = await pollAuthCode("sess-1", {
			baseUrl: "https://example.vercel.app",
			fetchImpl: fetchImpl as unknown as typeof fetch,
			pollMs: 1,
			maxPolls: 5,
			shouldContinue: () => calls < 1,
			sleep: async () => undefined,
		});
		expect(result).toBeNull();
	});

	it("throws on expired session", async () => {
		const fetchImpl = vi.fn(async () => new Response("{}", { status: 404 }));
		await expect(
			pollAuthCode("sess-1", {
				baseUrl: "https://example.vercel.app",
				fetchImpl: fetchImpl as unknown as typeof fetch,
				pollMs: 1,
				sleep: async () => undefined,
			}),
		).rejects.toBeInstanceOf(VercelAuthSessionError);
	});
});
