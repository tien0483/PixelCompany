import { describe, expect, it, vi } from "vitest";

import {
	CLAUDE_CONFIG_DIR_ENV,
	CURSOR_API_KEY_ENV,
	isManagerAccountAuthBroken,
	isManagerAccountDisabled,
	isManagerAccountDonateExhausted,
	isManagerAccountDonatePinBlocked,
	pickDefaultClaudeAccountId,
	pickDefaultCursorAccountId,
	pickLeastUsedClaudeAccountId,
	resolveManagerAccountPin,
	toManagerDonateAccount,
} from "./manager-account-pin";

describe("isManagerAccountDonateExhausted", () => {
	it("uses max(5h, 7d) against the donate limit", () => {
		expect(
			isManagerAccountDonateExhausted({
				id: 1,
				provider: "cursor",
				fiveHourPercent: 80,
				sevenDayPercent: 40,
				donateLimitPercent: 70,
			}),
		).toBe(true);
		expect(
			isManagerAccountDonateExhausted({
				id: 1,
				provider: "cursor",
				fiveHourPercent: 60,
				sevenDayPercent: 40,
				donateLimitPercent: 70,
			}),
		).toBe(false);
	});
});

describe("toManagerDonateAccount", () => {
	const snapshotAccount = {
		id: 7,
		provider: "claude" as const,
		email: "seat@example.com",
		displayName: null,
		organizationName: null,
		isActive: false,
		fiveHourPercent: 42,
		sevenDayPercent: 11,
		fiveHourResetsAt: null,
		sevenDayResetsAt: null,
		usageCachedAt: null,
		subscriptionType: null,
		donateLimitPercent: 80,
		donateLimitLocked: true,
		pressure: 0.42,
		nextRefreshAt: null,
		canAutoSwap: true,
		canTrackUsage: true,
		hasCcToken: true,
		ccNeedsAuth: false,
		isActiveForProvider: false,
		validationStatus: null,
		lastError: null,
	};

	// Every field the gate predicates read has to survive the projection; each one
	// is optional on the target, so a dropped field fails silently rather than at
	// compile time.
	it("carries every field the pin gate reads", () => {
		expect(toManagerDonateAccount(snapshotAccount)).toEqual({
			id: 7,
			provider: "claude",
			isActive: false,
			isActiveForProvider: false,
			fiveHourPercent: 42,
			sevenDayPercent: 11,
			pressure: 0.42,
			donateLimitPercent: 80,
			donateLimitLocked: true,
			ccNeedsAuth: false,
			validationStatus: null,
		});
	});

	it("keeps a revoked seat's auth-broken fields detectable after the projection", () => {
		expect(isManagerAccountAuthBroken(toManagerDonateAccount({ ...snapshotAccount, ccNeedsAuth: true }))).toBe(true);
		expect(
			isManagerAccountAuthBroken(toManagerDonateAccount({ ...snapshotAccount, validationStatus: "invalid" })),
		).toBe(true);
	});

	it("keeps a disabled seat detectable after the projection", () => {
		expect(isManagerAccountDisabled(toManagerDonateAccount(snapshotAccount))).toBe(true);
		expect(isManagerAccountDisabled(toManagerDonateAccount({ ...snapshotAccount, isActive: true }))).toBe(false);
	});
});

describe("isManagerAccountDisabled", () => {
	it("only treats an explicit false as disabled", () => {
		expect(isManagerAccountDisabled({ id: 1, provider: "claude", isActive: false })).toBe(true);
		expect(isManagerAccountDisabled({ id: 1, provider: "claude", isActive: true })).toBe(false);
		// Omitted by callers that do not carry the flag; must not read as disabled.
		expect(isManagerAccountDisabled({ id: 1, provider: "claude" })).toBe(false);
	});
});

describe("isManagerAccountDonatePinBlocked", () => {
	it("blocks a locked seat that is over its donate cap", () => {
		expect(
			isManagerAccountDonatePinBlocked({
				id: 1,
				provider: "cursor",
				fiveHourPercent: 80,
				sevenDayPercent: 40,
				donateLimitPercent: 70,
				donateLimitLocked: true,
			}),
		).toBe(true);
	});

	it("blocks an unlocked seat that is over its donate cap too (no manual override)", () => {
		expect(
			isManagerAccountDonatePinBlocked({
				id: 1,
				provider: "cursor",
				fiveHourPercent: 80,
				sevenDayPercent: 40,
				donateLimitPercent: 70,
				donateLimitLocked: false,
			}),
		).toBe(true);
	});

	it("does not block a locked seat that is under its donate cap", () => {
		expect(
			isManagerAccountDonatePinBlocked({
				id: 1,
				provider: "cursor",
				fiveHourPercent: 50,
				sevenDayPercent: 40,
				donateLimitPercent: 70,
				donateLimitLocked: true,
			}),
		).toBe(false);
	});
});

describe("isManagerAccountAuthBroken", () => {
	it("is broken when ccNeedsAuth is true", () => {
		expect(isManagerAccountAuthBroken({ id: 1, provider: "claude", ccNeedsAuth: true })).toBe(true);
	});

	it("is broken when validationStatus is invalid or expired", () => {
		expect(isManagerAccountAuthBroken({ id: 1, provider: "claude", validationStatus: "invalid" })).toBe(true);
		expect(isManagerAccountAuthBroken({ id: 1, provider: "claude", validationStatus: "expired" })).toBe(true);
	});

	it("treats unknown/checking/null validationStatus as healthy", () => {
		expect(isManagerAccountAuthBroken({ id: 1, provider: "claude", validationStatus: "unknown" })).toBe(false);
		expect(isManagerAccountAuthBroken({ id: 1, provider: "claude", validationStatus: "checking" })).toBe(false);
		expect(isManagerAccountAuthBroken({ id: 1, provider: "claude", validationStatus: null })).toBe(false);
	});

	it("treats an account with neither field set as healthy", () => {
		expect(isManagerAccountAuthBroken({ id: 1, provider: "claude" })).toBe(false);
	});
});

describe("pickDefaultCursorAccountId", () => {
	it("prefers the Cursor fleet active seat over Claude's global active id", () => {
		expect(
			pickDefaultCursorAccountId({
				accounts: [
					{ id: 1, provider: "claude", isActiveForProvider: true },
					{ id: 2, provider: "cursor", isActiveForProvider: false },
					{ id: 3, provider: "cursor", isActiveForProvider: true },
				],
				activeAccountId: 1,
			}),
		).toBe(3);
	});

	it("skips disabled Cursor seats for Auto pick", () => {
		expect(
			pickDefaultCursorAccountId({
				accounts: [
					{ id: 1, provider: "cursor", isActive: false, isActiveForProvider: true },
					{ id: 2, provider: "cursor", isActive: true, isActiveForProvider: false },
				],
				activeAccountId: 1,
			}),
		).toBe(2);
	});

	it("falls back to the first Cursor account when Claude is globally active", () => {
		expect(
			pickDefaultCursorAccountId({
				accounts: [
					{ id: 1, provider: "claude" },
					{ id: 2, provider: "cursor" },
					{ id: 3, provider: "cursor" },
				],
				activeAccountId: 1,
			}),
		).toBe(2);
	});

	it("skips over-donate Cursor seats for Auto pick", () => {
		expect(
			pickDefaultCursorAccountId({
				accounts: [
					{
						id: 2,
						provider: "cursor",
						isActiveForProvider: true,
						fiveHourPercent: 90,
						sevenDayPercent: 10,
						donateLimitPercent: 70,
					},
					{
						id: 3,
						provider: "cursor",
						isActiveForProvider: false,
						fiveHourPercent: 20,
						sevenDayPercent: 10,
						donateLimitPercent: 70,
					},
				],
				activeAccountId: null,
			}),
		).toBe(3);
	});

	it("returns null when no Cursor accounts exist", () => {
		expect(
			pickDefaultCursorAccountId({
				accounts: [{ id: 1, provider: "claude" }],
				activeAccountId: 1,
			}),
		).toBeNull();
	});

	it("prefers the healthy Cursor seat with the lowest 5h usage", () => {
		expect(
			pickDefaultCursorAccountId({
				accounts: [
					{ id: 1, provider: "cursor", fiveHourPercent: 40 },
					{ id: 2, provider: "cursor", fiveHourPercent: 10 },
				],
				activeAccountId: null,
			}),
		).toBe(2);
	});
});

describe("pickDefaultClaudeAccountId", () => {
	it("skips a broken active seat for a healthy one", () => {
		expect(
			pickDefaultClaudeAccountId({
				accounts: [
					{ id: 1, provider: "claude", ccNeedsAuth: true },
					{ id: 2, provider: "claude" },
				],
				activeAccountId: 1,
			}),
		).toBe(2);
	});

	it("falls back to the wider pool when every Claude seat is auth-broken", () => {
		expect(
			pickDefaultClaudeAccountId({
				accounts: [
					{ id: 1, provider: "claude", ccNeedsAuth: true },
					{ id: 2, provider: "claude", validationStatus: "invalid" },
				],
				activeAccountId: 1,
			}),
		).toBe(1);
	});

	it("prefers a healthy seat over a lower-usage broken one", () => {
		expect(
			pickDefaultClaudeAccountId({
				accounts: [
					{ id: 1, provider: "claude", validationStatus: "expired", fiveHourPercent: 5 },
					{ id: 2, provider: "claude", fiveHourPercent: 50 },
				],
				activeAccountId: null,
			}),
		).toBe(2);
	});

	it("returns null when no Claude accounts exist", () => {
		expect(
			pickDefaultClaudeAccountId({
				accounts: [{ id: 1, provider: "cursor" }],
				activeAccountId: 1,
			}),
		).toBeNull();
	});

	it("prefers the healthy seat with the lowest 5h usage", () => {
		expect(
			pickDefaultClaudeAccountId({
				accounts: [
					{ id: 1, provider: "claude", fiveHourPercent: 40 },
					{ id: 2, provider: "claude", fiveHourPercent: 10 },
				],
				activeAccountId: null,
			}),
		).toBe(2);
	});
});

describe("pickLeastUsedClaudeAccountId", () => {
	it("ignores the active seat and takes the lowest 5h usage", () => {
		expect(
			pickLeastUsedClaudeAccountId({
				accounts: [
					{ id: 1, provider: "claude", fiveHourPercent: 80 },
					{ id: 2, provider: "claude", fiveHourPercent: 12 },
					{ id: 3, provider: "claude", fiveHourPercent: 45 },
				],
			}),
		).toBe(2);
	});

	it("skips seats disabled in Manager", () => {
		expect(
			pickLeastUsedClaudeAccountId({
				accounts: [
					{ id: 1, provider: "claude", isActive: false, fiveHourPercent: 1 },
					{ id: 2, provider: "claude", fiveHourPercent: 60 },
				],
			}),
		).toBe(2);
	});

	it("skips auth-broken seats even when they are the least used", () => {
		expect(
			pickLeastUsedClaudeAccountId({
				accounts: [
					{ id: 1, provider: "claude", ccNeedsAuth: true, fiveHourPercent: 2 },
					{ id: 2, provider: "claude", validationStatus: "expired", fiveHourPercent: 3 },
					{ id: 3, provider: "claude", fiveHourPercent: 70 },
				],
			}),
		).toBe(3);
	});

	it("skips over-donate-cap seats", () => {
		expect(
			pickLeastUsedClaudeAccountId({
				accounts: [
					{ id: 1, provider: "claude", fiveHourPercent: 95, donateLimitPercent: 90 },
					{ id: 2, provider: "claude", fiveHourPercent: 55, donateLimitPercent: 90 },
				],
			}),
		).toBe(2);
	});

	it("falls back to the least used of an exhausted fleet so the hard-block has a target", () => {
		expect(
			pickLeastUsedClaudeAccountId({
				accounts: [
					{ id: 1, provider: "claude", fiveHourPercent: 99, donateLimitPercent: 90 },
					{ id: 2, provider: "claude", fiveHourPercent: 92, donateLimitPercent: 90 },
				],
			}),
		).toBe(2);
	});

	it("ignores other providers and returns null when no Claude seat exists", () => {
		expect(
			pickLeastUsedClaudeAccountId({
				accounts: [
					{ id: 1, provider: "cursor", fiveHourPercent: 1 },
					{ id: 2, provider: "antigravity", fiveHourPercent: 2 },
				],
			}),
		).toBeNull();
	});
});

describe("resolveManagerAccountPin", () => {
	it("returns no env when the card is unpinned", async () => {
		const getAccountLaunchDir = vi.fn();

		const pin = await resolveManagerAccountPin({
			agentId: "claude",
			managerAccountId: undefined,
			getAccountLaunchDir,
		});

		expect(pin).toEqual({ env: {}, accountId: null, warning: null });
		expect(getAccountLaunchDir).not.toHaveBeenCalled();
	});

	it("pins an unpinned Claude card onto the Auto-resolved seat without reading the active one", async () => {
		const getAccountLaunchDir = vi.fn(async () => ({ configDir: "/home/u/.claude/accounts/7" }));
		const resolveLiveActiveClaudeAccountId = vi.fn(async () => 1);

		const pin = await resolveManagerAccountPin({
			agentId: "claude",
			managerAccountId: undefined,
			getAccountLaunchDir,
			resolveAutoClaudeAccountId: async () => 7,
			resolveLiveActiveClaudeAccountId,
			getPinnedAccount: async (accountId) => ({ id: accountId, provider: "claude" }),
		});

		expect(getAccountLaunchDir).toHaveBeenCalledWith(7);
		expect(pin.env).toEqual({ [CLAUDE_CONFIG_DIR_ENV]: "/home/u/.claude/accounts/7" });
		expect(pin.accountId).toBe(7);
		expect(pin.blocked).toBeUndefined();
		// The global active seat is what Plans and Review use; Auto must not consult it.
		expect(resolveLiveActiveClaudeAccountId).not.toHaveBeenCalled();
	});

	it("keeps the inherit path when no Auto resolver is supplied", async () => {
		const getAccountLaunchDir = vi.fn();
		const resolveLiveActiveClaudeAccountId = vi.fn(async () => 1);

		const pin = await resolveManagerAccountPin({
			agentId: "claude",
			managerAccountId: undefined,
			getAccountLaunchDir,
			resolveLiveActiveClaudeAccountId,
			getPinnedAccount: async (accountId) => ({ id: accountId, provider: "claude" }),
		});

		expect(pin).toEqual({ env: {}, accountId: null, warning: null });
		expect(getAccountLaunchDir).not.toHaveBeenCalled();
		expect(resolveLiveActiveClaudeAccountId).toHaveBeenCalled();
	});

	it("falls back to the inherit path when the Auto resolver has no seat to offer", async () => {
		const getAccountLaunchDir = vi.fn();
		const resolveLiveActiveClaudeAccountId = vi.fn(async () => null);

		const pin = await resolveManagerAccountPin({
			agentId: "claude",
			managerAccountId: undefined,
			getAccountLaunchDir,
			resolveAutoClaudeAccountId: async () => null,
			resolveLiveActiveClaudeAccountId,
		});

		expect(pin).toEqual({ env: {}, accountId: null, warning: null });
		expect(getAccountLaunchDir).not.toHaveBeenCalled();
	});

	it("does not Auto-pin Cursor or Antigravity cards", async () => {
		const resolveAutoClaudeAccountId = vi.fn(async () => 7);

		for (const agentId of ["cursor", "gemini"] as const) {
			const getAccountLaunchDir = vi.fn();
			const pin = await resolveManagerAccountPin({
				agentId,
				managerAccountId: undefined,
				getAccountLaunchDir,
				resolveAutoClaudeAccountId,
			});

			expect(pin).toEqual({ env: {}, accountId: null, warning: null });
			expect(getAccountLaunchDir).not.toHaveBeenCalled();
		}
		expect(resolveAutoClaudeAccountId).not.toHaveBeenCalled();
	});

	it("reports an Auto-resolved block as a fleet problem, not as a pin to change", async () => {
		const pin = await resolveManagerAccountPin({
			agentId: "claude",
			managerAccountId: undefined,
			getAccountLaunchDir: vi.fn(),
			resolveAutoClaudeAccountId: async () => 7,
			getPinnedAccount: async (accountId) => ({ id: accountId, provider: "claude", ccNeedsAuth: true }),
		});

		expect(pin.blocked).toBe(true);
		expect(pin.warning).toContain("no healthy Claude seat is available");
		expect(pin.warning).not.toContain("switch this task to Auto");
	});

	it("prepares the active Claude seat when launch tags need CLAUDE_CONFIG_DIR", async () => {
		const getAccountLaunchDir = vi.fn(async () => ({ configDir: "/home/u/.claude/accounts/3" }));
		const pin = await resolveManagerAccountPin({
			agentId: "claude",
			managerAccountId: undefined,
			getAccountLaunchDir,
			needsClaudeConfigDirForLaunchTags: true,
			resolveActiveClaudeAccountId: async () => 3,
		});

		expect(getAccountLaunchDir).toHaveBeenCalledWith(3);
		expect(pin.env).toEqual({ [CLAUDE_CONFIG_DIR_ENV]: "/home/u/.claude/accounts/3" });
		expect(pin.accountId).toBe(3);
	});

	it("points CLAUDE_CONFIG_DIR at the account's credential dir", async () => {
		const getAccountLaunchDir = vi.fn().mockResolvedValue({ configDir: "/home/u/.claude/accounts/7" });

		const pin = await resolveManagerAccountPin({
			agentId: "claude",
			managerAccountId: 7,
			getAccountLaunchDir,
		});

		expect(pin.env).toEqual({ [CLAUDE_CONFIG_DIR_ENV]: "/home/u/.claude/accounts/7" });
		expect(pin.accountId).toBe(7);
		expect(pin.warning).toBeNull();
		expect(getAccountLaunchDir).toHaveBeenCalledWith(7);
	});

	it("ignores the pin for agents that do not read CLAUDE_CONFIG_DIR", async () => {
		const getAccountLaunchDir = vi.fn();

		const pin = await resolveManagerAccountPin({
			agentId: "codex",
			managerAccountId: 7,
			getAccountLaunchDir,
		});

		expect(pin.env).toEqual({});
		expect(pin.warning).toContain("codex");
		expect(getAccountLaunchDir).not.toHaveBeenCalled();
	});

	it("returns a warning when jacked cannot prepare the launch dir", async () => {
		const getAccountLaunchDir = vi.fn().mockResolvedValue(null);

		const pin = await resolveManagerAccountPin({
			agentId: "claude",
			managerAccountId: 3,
			getAccountLaunchDir,
		});

		expect(pin.env).toEqual({});
		expect(pin.accountId).toBeNull();
		expect(pin.warning).toContain("using the active account");
	});

	it("returns a warning when launch-dir throws", async () => {
		const getAccountLaunchDir = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

		const pin = await resolveManagerAccountPin({
			agentId: "claude",
			managerAccountId: 3,
			getAccountLaunchDir,
		});

		expect(pin.env).toEqual({});
		expect(pin.warning).toContain("ECONNREFUSED");
	});

	it("warns when pinning is used with an unsupported agent", async () => {
		const pin = await resolveManagerAccountPin({
			agentId: "codex",
			managerAccountId: 9,
			getAccountLaunchDir: vi.fn(),
		});

		expect(pin.warning).toContain("Claude Code, Cursor Agent, and Antigravity CLI");
	});

	it("pins an Antigravity account for gemini task", async () => {
		const pin = await resolveManagerAccountPin({
			agentId: "gemini",
			managerAccountId: 9,
			getAccountLaunchDir: vi.fn(),
			getAccountProvider: async () => "antigravity",
		});

		expect(pin.env).toEqual({});
		expect(pin.accountId).toBe(9);
		expect(pin.warning).toBeNull();
	});

	it("injects CURSOR_API_KEY for a pinned Cursor task", async () => {
		const getAccountLaunchCredential = vi.fn().mockResolvedValue({ apiKey: "cursor-key-1" });

		const pin = await resolveManagerAccountPin({
			agentId: "cursor",
			managerAccountId: 11,
			getAccountLaunchDir: vi.fn(),
			getAccountLaunchCredential,
			getAccountProvider: async () => "cursor",
		});

		expect(pin.env).toEqual({ [CURSOR_API_KEY_ENV]: "cursor-key-1" });
		expect(pin.accountId).toBe(11);
		expect(getAccountLaunchCredential).toHaveBeenCalledWith(11);
	});

	it("leaves unpinned Cursor tasks on agent CLI login (no CURSOR_API_KEY injection)", async () => {
		const getAccountLaunchCredential = vi.fn().mockResolvedValue({ apiKey: "cursor-auto-key" });
		const resolveDefaultCursorAccountId = vi.fn().mockResolvedValue(22);

		const pin = await resolveManagerAccountPin({
			agentId: "cursor",
			managerAccountId: undefined,
			getAccountLaunchDir: vi.fn(),
			getAccountLaunchCredential,
			getAccountProvider: async () => "cursor",
			resolveDefaultCursorAccountId,
		});

		expect(resolveDefaultCursorAccountId).not.toHaveBeenCalled();
		expect(getAccountLaunchCredential).not.toHaveBeenCalled();
		expect(pin.env).toEqual({});
		expect(pin.accountId).toBeNull();
	});

	it("hard-blocks an unpinned Claude launch when the active seat is locked over its donate cap", async () => {
		const getAccountLaunchDir = vi.fn();
		const resolveActiveClaudeAccountId = vi.fn().mockResolvedValue(8);
		const getPinnedAccount = vi.fn().mockResolvedValue({
			id: 8,
			provider: "claude",
			fiveHourPercent: 99,
			sevenDayPercent: 10,
			donateLimitPercent: 80,
			donateLimitLocked: true,
		});

		const pin = await resolveManagerAccountPin({
			agentId: "claude",
			managerAccountId: undefined,
			getAccountLaunchDir,
			resolveActiveClaudeAccountId,
			getPinnedAccount,
		});

		expect(pin.blocked).toBe(true);
		expect(pin.accountId).toBeNull();
		expect(pin.env).toEqual({});
		expect(pin.warning).toContain("donate cap");
		expect(getPinnedAccount).toHaveBeenCalledWith(8);
		expect(getAccountLaunchDir).not.toHaveBeenCalled();
	});

	it("hard-blocks an unpinned Claude launch when the active seat is over cap but unlocked too", async () => {
		const resolveActiveClaudeAccountId = vi.fn().mockResolvedValue(9);
		const getPinnedAccount = vi.fn().mockResolvedValue({
			id: 9,
			provider: "claude",
			fiveHourPercent: 99,
			sevenDayPercent: 10,
			donateLimitPercent: 80,
			donateLimitLocked: false,
		});

		const pin = await resolveManagerAccountPin({
			agentId: "claude",
			managerAccountId: undefined,
			getAccountLaunchDir: vi.fn(),
			resolveActiveClaudeAccountId,
			getPinnedAccount,
		});

		expect(pin.blocked).toBe(true);
		expect(pin.env).toEqual({});
		expect(pin.accountId).toBeNull();
	});

	it("does not gate unpinned Cursor launches on the default seat's donate cap", async () => {
		const resolveDefaultCursorAccountId = vi.fn().mockResolvedValue(30);
		const getPinnedAccount = vi.fn().mockResolvedValue({
			id: 30,
			provider: "cursor",
			fiveHourPercent: 99,
			sevenDayPercent: 10,
			donateLimitPercent: 80,
			donateLimitLocked: true,
		});

		const pin = await resolveManagerAccountPin({
			agentId: "cursor",
			managerAccountId: undefined,
			getAccountLaunchDir: vi.fn(),
			getAccountLaunchCredential: vi.fn(),
			getAccountProvider: async () => "cursor",
			resolveDefaultCursorAccountId,
			getPinnedAccount,
		});

		expect(pin.blocked).toBeUndefined();
		expect(getPinnedAccount).not.toHaveBeenCalled();
		expect(pin.env).toEqual({});
		expect(pin.accountId).toBeNull();
	});

	it("hard-blocks a pin on a locked seat that is over its donate cap", async () => {
		const getAccountLaunchDir = vi.fn().mockResolvedValue({ configDir: "/home/u/.claude/accounts/5" });
		const getPinnedAccount = vi.fn().mockResolvedValue({
			id: 5,
			provider: "claude",
			fiveHourPercent: 95,
			sevenDayPercent: 10,
			donateLimitPercent: 80,
			donateLimitLocked: true,
		});

		const pin = await resolveManagerAccountPin({
			agentId: "claude",
			managerAccountId: 5,
			getAccountLaunchDir,
			getPinnedAccount,
		});

		expect(pin.blocked).toBe(true);
		expect(pin.accountId).toBeNull();
		expect(pin.env).toEqual({});
		expect(pin.warning).toContain("donate cap");
		expect(getAccountLaunchDir).not.toHaveBeenCalled();
	});

	it("hard-blocks a pin on an unlocked seat that is over its donate cap too", async () => {
		const getAccountLaunchDir = vi.fn().mockResolvedValue({ configDir: "/home/u/.claude/accounts/6" });
		const getPinnedAccount = vi.fn().mockResolvedValue({
			id: 6,
			provider: "claude",
			fiveHourPercent: 95,
			sevenDayPercent: 10,
			donateLimitPercent: 80,
			donateLimitLocked: false,
		});

		const pin = await resolveManagerAccountPin({
			agentId: "claude",
			managerAccountId: 6,
			getAccountLaunchDir,
			getPinnedAccount,
		});

		expect(pin.blocked).toBe(true);
		expect(pin.env).toEqual({});
		expect(pin.accountId).toBeNull();
	});

	it("hard-blocks a Claude pin on a seat disabled in Manager", async () => {
		const getAccountLaunchDir = vi.fn().mockResolvedValue({ configDir: "/home/u/.claude/accounts/12" });
		const getPinnedAccount = vi.fn().mockResolvedValue({
			id: 12,
			provider: "claude",
			isActive: false,
			fiveHourPercent: 5,
			sevenDayPercent: 5,
			donateLimitPercent: 80,
		});

		const pin = await resolveManagerAccountPin({
			agentId: "claude",
			managerAccountId: 12,
			getAccountLaunchDir,
			getPinnedAccount,
		});

		expect(pin.blocked).toBe(true);
		expect(pin.accountId).toBeNull();
		expect(pin.env).toEqual({});
		expect(pin.warning).toContain("disabled in Manager");
		// Blocked before any credential prep — a disabled seat never gets a config dir.
		expect(getAccountLaunchDir).not.toHaveBeenCalled();
	});

	it("hard-blocks a Cursor pin on a seat disabled in Manager", async () => {
		const getAccountLaunchCredential = vi.fn().mockResolvedValue({ apiKey: "cursor-key-13" });
		const getPinnedAccount = vi.fn().mockResolvedValue({
			id: 13,
			provider: "cursor",
			isActive: false,
			fiveHourPercent: 5,
			sevenDayPercent: 5,
		});

		const pin = await resolveManagerAccountPin({
			agentId: "cursor",
			managerAccountId: 13,
			getAccountLaunchDir: vi.fn(),
			getAccountLaunchCredential,
			getAccountProvider: async () => "cursor",
			getPinnedAccount,
		});

		expect(pin.blocked).toBe(true);
		expect(pin.accountId).toBeNull();
		expect(pin.env).toEqual({});
		expect(pin.warning).toContain("disabled in Manager");
		expect(getAccountLaunchCredential).not.toHaveBeenCalled();
	});

	it("blocks a disabled seat even when it is well under its donate cap", async () => {
		const getPinnedAccount = vi.fn().mockResolvedValue({
			id: 14,
			provider: "claude",
			isActive: false,
			fiveHourPercent: 0,
			sevenDayPercent: 0,
			donateLimitPercent: 100,
			donateLimitLocked: false,
		});

		const pin = await resolveManagerAccountPin({
			agentId: "claude",
			managerAccountId: 14,
			getAccountLaunchDir: vi.fn().mockResolvedValue({ configDir: "/home/u/.claude/accounts/14" }),
			getPinnedAccount,
		});

		expect(pin.blocked).toBe(true);
		expect(pin.warning).toContain("disabled in Manager");
	});

	it("pins normally when the snapshot omits isActive (treated as enabled)", async () => {
		const getAccountLaunchDir = vi.fn().mockResolvedValue({ configDir: "/home/u/.claude/accounts/15" });
		const getPinnedAccount = vi.fn().mockResolvedValue({
			id: 15,
			provider: "claude",
			fiveHourPercent: 5,
			sevenDayPercent: 5,
		});

		const pin = await resolveManagerAccountPin({
			agentId: "claude",
			managerAccountId: 15,
			getAccountLaunchDir,
			getPinnedAccount,
		});

		expect(pin.blocked).toBeUndefined();
		expect(pin.env).toEqual({ [CLAUDE_CONFIG_DIR_ENV]: "/home/u/.claude/accounts/15" });
		expect(pin.accountId).toBe(15);
	});

	it("redirects an unpinned Claude launch to a healthy seat when the live active seat needs re-auth", async () => {
		const getAccountLaunchDir = vi.fn().mockResolvedValue({ configDir: "/home/u/.claude/accounts/2" });
		const resolveLiveActiveClaudeAccountId = vi.fn().mockResolvedValue(1);
		const resolveActiveClaudeAccountId = vi.fn().mockResolvedValue(2);
		const getPinnedAccount = vi.fn().mockResolvedValue({ id: 1, provider: "claude", ccNeedsAuth: true });

		const pin = await resolveManagerAccountPin({
			agentId: "claude",
			managerAccountId: undefined,
			getAccountLaunchDir,
			resolveLiveActiveClaudeAccountId,
			resolveActiveClaudeAccountId,
			getPinnedAccount,
		});

		expect(pin.blocked).toBeUndefined();
		expect(pin.accountId).toBe(2);
		expect(pin.env).toEqual({ [CLAUDE_CONFIG_DIR_ENV]: "/home/u/.claude/accounts/2" });
		expect(pin.warning).toBe("The active seat (account 1) needs re-auth; launched on account 2 instead.");
		expect(getPinnedAccount).toHaveBeenCalledWith(1);
		expect(getAccountLaunchDir).toHaveBeenCalledWith(2);
	});

	it("hard-blocks an unpinned Claude launch when every seat needs re-auth", async () => {
		const resolveLiveActiveClaudeAccountId = vi.fn().mockResolvedValue(1);
		const resolveActiveClaudeAccountId = vi.fn().mockResolvedValue(1);
		const getPinnedAccount = vi.fn().mockResolvedValue({ id: 1, provider: "claude", ccNeedsAuth: true });

		const pin = await resolveManagerAccountPin({
			agentId: "claude",
			managerAccountId: undefined,
			getAccountLaunchDir: vi.fn(),
			resolveLiveActiveClaudeAccountId,
			resolveActiveClaudeAccountId,
			getPinnedAccount,
		});

		expect(pin.blocked).toBe(true);
		expect(pin.accountId).toBeNull();
		expect(pin.env).toEqual({});
		expect(pin.warning).toContain("needs re-auth");
	});

	it("blocks (not falls back) an unpinned redirect when the healthy target's credentials cannot be prepared", async () => {
		const getAccountLaunchDir = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
		const resolveLiveActiveClaudeAccountId = vi.fn().mockResolvedValue(1);
		const resolveActiveClaudeAccountId = vi.fn().mockResolvedValue(2);
		const getPinnedAccount = vi.fn().mockResolvedValue({ id: 1, provider: "claude", ccNeedsAuth: true });

		const pin = await resolveManagerAccountPin({
			agentId: "claude",
			managerAccountId: undefined,
			getAccountLaunchDir,
			resolveLiveActiveClaudeAccountId,
			resolveActiveClaudeAccountId,
			getPinnedAccount,
		});

		expect(pin.blocked).toBe(true);
		expect(pin.accountId).toBeNull();
		expect(pin.env).toEqual({});
	});

	it("does not redirect when the live active seat is healthy", async () => {
		const getAccountLaunchDir = vi.fn();
		const resolveLiveActiveClaudeAccountId = vi.fn().mockResolvedValue(1);
		const resolveActiveClaudeAccountId = vi.fn().mockResolvedValue(1);
		const getPinnedAccount = vi.fn().mockResolvedValue({ id: 1, provider: "claude" });

		const pin = await resolveManagerAccountPin({
			agentId: "claude",
			managerAccountId: undefined,
			getAccountLaunchDir,
			resolveLiveActiveClaudeAccountId,
			resolveActiveClaudeAccountId,
			getPinnedAccount,
		});

		expect(pin.blocked).toBeUndefined();
		expect(pin.accountId).toBeNull();
		expect(pin.env).toEqual({});
		expect(getAccountLaunchDir).not.toHaveBeenCalled();
	});

	it("hard-blocks an explicit Claude pin on a seat that needs re-auth", async () => {
		const getAccountLaunchDir = vi.fn().mockResolvedValue({ configDir: "/home/u/.claude/accounts/16" });
		const getPinnedAccount = vi.fn().mockResolvedValue({ id: 16, provider: "claude", validationStatus: "invalid" });

		const pin = await resolveManagerAccountPin({
			agentId: "claude",
			managerAccountId: 16,
			getAccountLaunchDir,
			getPinnedAccount,
		});

		expect(pin.blocked).toBe(true);
		expect(pin.accountId).toBeNull();
		expect(pin.env).toEqual({});
		expect(pin.warning).toContain("re-auth");
		expect(getAccountLaunchDir).not.toHaveBeenCalled();
	});

	it("ignores a Claude pin on a Cursor task and does not force a Seats key", async () => {
		const getAccountLaunchCredential = vi.fn().mockResolvedValue({ apiKey: "cursor-auto-key" });
		const resolveDefaultCursorAccountId = vi.fn().mockResolvedValue(22);

		const pin = await resolveManagerAccountPin({
			agentId: "cursor",
			managerAccountId: 4,
			getAccountLaunchDir: vi.fn(),
			getAccountLaunchCredential,
			getAccountProvider: async () => "claude",
			resolveDefaultCursorAccountId,
		});

		expect(resolveDefaultCursorAccountId).not.toHaveBeenCalled();
		expect(getAccountLaunchCredential).not.toHaveBeenCalled();
		expect(pin.env).toEqual({});
		expect(pin.accountId).toBeNull();
		expect(pin.warning).toContain("claude account");
	});
});
