import { describe, expect, it, vi } from "vitest";

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		manager: {
			gitIdentity: { query: vi.fn() },
			createUsageAuthSession: { mutate: vi.fn() },
		},
	}),
}));

import {
	isValidSenderEmail,
	type PendingInviteFlow,
	resolveAuthType,
} from "@/manager/use-claude-invite-session";

function flow(overrides: Partial<PendingInviteFlow>): PendingInviteFlow {
	return {
		authUrl: "https://claude.ai/oauth",
		flowId: "flow-1",
		generation: 1,
		flowKind: "account",
		applyFormDonate: false,
		...overrides,
	};
}

describe("resolveAuthType", () => {
	it("asks for a usage percentage only on Add Account", () => {
		expect(
			resolveAuthType(flow({ flowKind: "account", applyFormDonate: true })),
		).toBe("authorize");
	});

	it("uses the two-step form for re-auth", () => {
		expect(
			resolveAuthType(flow({ flowKind: "account", applyFormDonate: false })),
		).toBe("cc");
	});

	it("uses the two-step form for CC", () => {
		expect(resolveAuthType(flow({ flowKind: "cc" }))).toBe("cc");
		// A CC flow never applies the form donate %, but guard the combination anyway.
		expect(resolveAuthType(flow({ flowKind: "cc", applyFormDonate: true }))).toBe(
			"cc",
		);
	});
});

describe("isValidSenderEmail", () => {
	it("accepts a plain address, ignoring surrounding space", () => {
		expect(isValidSenderEmail("  alice@akselos.com ")).toBe(true);
	});

	it("rejects blanks and obvious typos", () => {
		expect(isValidSenderEmail("")).toBe(false);
		expect(isValidSenderEmail("   ")).toBe(false);
		expect(isValidSenderEmail("alice")).toBe(false);
		expect(isValidSenderEmail("alice@akselos")).toBe(false);
		expect(isValidSenderEmail("alice @akselos.com")).toBe(false);
	});
});
