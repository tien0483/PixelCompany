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

	it("forwards authType and the sender identity, dropping blanks", async () => {
		mutate.mockResolvedValue({
			sessionId: "sess-1",
			formUrl: "https://example.vercel.app/?sessionId=sess-1",
			authType: "cc",
			sender: "alice@akselos.com",
			receiver: null,
		});
		await createAuthSession("https://claude.ai/oauth", {
			sessionId: "sess-1",
			authType: "cc",
			sender: " alice@akselos.com ",
			receiver: "   ",
			accountName: "Alice",
		});
		expect(mutate).toHaveBeenCalledWith({
			authLink: "https://claude.ai/oauth",
			sessionId: "sess-1",
			authType: "cc",
			sender: "alice@akselos.com",
			accountName: "Alice",
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
				authType: "authorize",
				accountName: "Alice",
				sender: "alice@akselos.com",
				receiver: "bob@akselos.com",
			});
		const result = await pollAuthCode("sess-1", {
			pollMs: 1,
			sleep: async () => undefined,
		});
		expect(result).toEqual({
			authCode: "abc#xyz",
			percentage: 40,
			submittedAt: 1,
			authType: "authorize",
			accountName: "Alice",
			sender: "alice@akselos.com",
			receiver: "bob@akselos.com",
		});
	});

	it("tolerates a cc submission with no percentage", async () => {
		query.mockResolvedValueOnce({
			status: "ready",
			authCode: "abc#xyz",
			percentage: null,
			submittedAt: 1,
			error: null,
			authType: "cc",
			accountName: null,
			sender: "alice@akselos.com",
			receiver: null,
		});
		const result = await pollAuthCode("sess-1", {
			pollMs: 1,
			sleep: async () => undefined,
		});
		expect(result?.percentage).toBeNull();
		expect(result?.authType).toBe("cc");
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
