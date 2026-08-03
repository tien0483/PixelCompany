import { describe, expect, it, vi } from "vitest";

import {
	CLAUDE_CONFIG_DIR_ENV,
	CURSOR_API_KEY_ENV,
	isManagerAccountDisabled,
	isManagerAccountDonateExhausted,
	isManagerAccountDonatePinBlocked,
	pickDefaultCursorAccountId,
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
		});
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

	it("does not block an unlocked seat that is over its donate cap (soft)", () => {
		expect(
			isManagerAccountDonatePinBlocked({
				id: 1,
				provider: "cursor",
				fiveHourPercent: 80,
				sevenDayPercent: 40,
				donateLimitPercent: 70,
				donateLimitLocked: false,
			}),
		).toBe(false);
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

	it("warns when pinning is used with Claude Code and Cursor Agent only", async () => {
		const pin = await resolveManagerAccountPin({
			agentId: "gemini",
			managerAccountId: 9,
			getAccountLaunchDir: vi.fn(),
		});

		expect(pin.warning).toContain("Claude Code and Cursor Agent");
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
		expect(pin.warning).toContain("locked donate cap");
		expect(getPinnedAccount).toHaveBeenCalledWith(8);
		expect(getAccountLaunchDir).not.toHaveBeenCalled();
	});

	it("allows an unpinned Claude launch when the active seat is over cap but unlocked (soft)", async () => {
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

		expect(pin.blocked).toBeUndefined();
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
		expect(pin.warning).toContain("locked donate cap");
		expect(getAccountLaunchDir).not.toHaveBeenCalled();
	});

	it("allows a pin on an unlocked seat that is over its donate cap (soft)", async () => {
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

		expect(pin.blocked).toBeUndefined();
		expect(pin.env).toEqual({ [CLAUDE_CONFIG_DIR_ENV]: "/home/u/.claude/accounts/6" });
		expect(pin.accountId).toBe(6);
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
