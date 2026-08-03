import { beforeEach, describe, expect, it, vi } from "vitest";

const mutate = vi.fn();
const query = vi.fn();

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		manager: {
			createUsageAuthSession: { mutate },
			getUsageAuthCode: { query },
		},
	}),
}));

import {
	createAuthSession,
	pollAuthCode,
	VercelAuthSessionError,
} from "@/manager/vercel-auth-session";

describe("createAuthSession", () => {
	beforeEach(() => {
		mutate.mockReset();
		query.mockReset();
	});

	it("creates a session via runtime tRPC", async () => {
		mutate.mockResolvedValue({
			sessionId: "sess-1",
			formUrl: "https://example.vercel.app/?sessionId=sess-1",
		});
		const result = await createAuthSession("https://claude.ai/oauth", {
			sessionId: "sess-1",
		});
		expect(result.formUrl).toContain("sessionId=sess-1");
		expect(mutate).toHaveBeenCalledWith({
			authLink: "https://claude.ai/oauth",
			sessionId: "sess-1",
		});
	});
});

describe("pollAuthCode", () => {
	beforeEach(() => {
		mutate.mockReset();
		query.mockReset();
	});

	it("returns auth code when the form is ready", async () => {
		query
			.mockResolvedValueOnce({
				status: "pending",
				authCode: null,
				percentage: null,
				submittedAt: null,
				error: null,
			})
			.mockResolvedValueOnce({
				status: "ready",
				authCode: "abc#xyz",
				percentage: 40,
				submittedAt: 1,
				error: null,
			});
		const result = await pollAuthCode("sess-1", {
			pollMs: 1,
			sleep: async () => undefined,
		});
		expect(result).toEqual({
			authCode: "abc#xyz",
			percentage: 40,
			submittedAt: 1,
		});
	});

	it("returns null when cancelled", async () => {
		query.mockResolvedValue({
			status: "pending",
			authCode: null,
			percentage: null,
			submittedAt: null,
			error: null,
		});
		let calls = 0;
		const result = await pollAuthCode("sess-1", {
			pollMs: 1,
			maxPolls: 5,
			shouldContinue: () => {
				calls += 1;
				return calls < 2;
			},
			sleep: async () => undefined,
		});
		expect(result).toBeNull();
	});

	it("throws on expired session", async () => {
		query.mockResolvedValue({
			status: "expired",
			authCode: null,
			percentage: null,
			submittedAt: null,
			error: "expired",
		});
		await expect(
			pollAuthCode("sess-1", {
				pollMs: 1,
				sleep: async () => undefined,
			}),
		).rejects.toBeInstanceOf(VercelAuthSessionError);
	});
});
