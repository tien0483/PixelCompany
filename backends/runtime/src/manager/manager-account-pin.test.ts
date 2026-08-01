import { describe, expect, it, vi } from "vitest";

import {
	CLAUDE_CONFIG_DIR_ENV,
	CURSOR_API_KEY_ENV,
	isManagerAccountDonateExhausted,
	pickDefaultCursorAccountId,
	resolveManagerAccountPin,
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
