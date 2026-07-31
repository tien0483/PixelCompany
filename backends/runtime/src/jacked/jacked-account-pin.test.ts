import { describe, expect, it, vi } from "vitest";

import { CLAUDE_CONFIG_DIR_ENV, resolveJackedAccountPin } from "./jacked-account-pin";

describe("resolveJackedAccountPin", () => {
	it("returns no env when the card is unpinned", async () => {
		const getAccountLaunchDir = vi.fn();

		const pin = await resolveJackedAccountPin({
			agentId: "claude",
			jackedAccountId: undefined,
			getAccountLaunchDir,
		});

		expect(pin).toEqual({ env: {}, accountId: null, warning: null });
		expect(getAccountLaunchDir).not.toHaveBeenCalled();
	});

	it("points CLAUDE_CONFIG_DIR at the account's credential dir", async () => {
		const getAccountLaunchDir = vi.fn().mockResolvedValue({ configDir: "/home/u/.claude/accounts/7" });

		const pin = await resolveJackedAccountPin({
			agentId: "claude",
			jackedAccountId: 7,
			getAccountLaunchDir,
		});

		expect(pin.env).toEqual({ [CLAUDE_CONFIG_DIR_ENV]: "/home/u/.claude/accounts/7" });
		expect(pin.accountId).toBe(7);
		expect(pin.warning).toBeNull();
		expect(getAccountLaunchDir).toHaveBeenCalledWith(7);
	});

	it("ignores the pin for agents that do not read CLAUDE_CONFIG_DIR", async () => {
		const getAccountLaunchDir = vi.fn();

		const pin = await resolveJackedAccountPin({
			agentId: "codex",
			jackedAccountId: 7,
			getAccountLaunchDir,
		});

		expect(pin.env).toEqual({});
		expect(pin.accountId).toBeNull();
		expect(pin.warning).toContain("Claude Code");
		expect(getAccountLaunchDir).not.toHaveBeenCalled();
	});

	it("falls back to the active account when jacked cannot prepare the dir", async () => {
		const pin = await resolveJackedAccountPin({
			agentId: "claude",
			jackedAccountId: 3,
			getAccountLaunchDir: async () => null,
		});

		expect(pin.env).toEqual({});
		expect(pin.accountId).toBeNull();
		expect(pin.warning).toContain("account 3");
	});

	it("treats a blank config dir as unusable", async () => {
		const pin = await resolveJackedAccountPin({
			agentId: "claude",
			jackedAccountId: 3,
			getAccountLaunchDir: async () => ({ configDir: "   " }),
		});

		expect(pin.env).toEqual({});
		expect(pin.accountId).toBeNull();
		expect(pin.warning).not.toBeNull();
	});

	it("never fails the launch when jacked throws", async () => {
		const pin = await resolveJackedAccountPin({
			agentId: "claude",
			jackedAccountId: 9,
			getAccountLaunchDir: async () => {
				throw new Error("ECONNREFUSED");
			},
		});

		expect(pin.env).toEqual({});
		expect(pin.accountId).toBeNull();
		expect(pin.warning).toContain("ECONNREFUSED");
	});
});
