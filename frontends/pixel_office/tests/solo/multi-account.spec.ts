import { expect, test } from "@playwright/test";

import { stubTrpc } from "./trpc-stub";

/**
 * Multi-account manager behaviour, driven from the single solo URL.
 *
 * The `?officeE2e=1` harness mounts the real `JackedAccountsView` over a fixed
 * Claude + Cursor snapshot, so the pane renders without a live jacked service.
 * Account mutations are stubbed at the tRPC boundary on purpose: the real calls
 * rewrite credential files, which must never happen from a test run. What is
 * asserted is the wiring — that each control invokes the right jacked procedure
 * with the right account id.
 */
const OK = { ok: true };

async function openAccountsPane(page: import("@playwright/test").Page) {
	await page.goto("/?officeE2e=1");
	await expect(page.getByTestId("jacked-accounts-view")).toBeVisible();
	await expect(page.getByTestId("jacked-account-1")).toBeVisible();
	await expect(page.getByTestId("jacked-account-2")).toBeVisible();
}

test("Cursor account shows Re-import and hides Claude OAuth controls", async ({ page }) => {
	const stub = await stubTrpc(page, {
		"jacked.reimportCursorAccount": () => OK,
		"jacked.activeSessions": () => ({ sessions: [] }),
		"jacked.swapLog": () => ({ swaps: [] }),
	});
	await openAccountsPane(page);

	const cursorRow = page.getByTestId("jacked-account-3");
	await expect(cursorRow).toBeVisible();
	await expect(cursorRow).toContainText("Cursor");
	await expect(cursorRow).toContainText("in IDE");

	const cursorActions = page.getByTestId("jacked-account-actions-3");
	await expect(cursorActions.getByRole("button", { name: /^Re-import/ })).toBeVisible();
	await expect(cursorActions.getByRole("button", { name: /^Re-authenticate/ })).toHaveCount(0);
	await expect(cursorActions.getByRole("button", { name: /^Authorize Claude Code/ })).toHaveCount(0);
	await expect(cursorActions.getByRole("button", { name: /^Raise auto-swap priority/ })).toHaveCount(0);

	await cursorActions.getByRole("button", { name: /^Re-import/ }).click();
	expect((await stub.waitForCall("jacked.reimportCursorAccount")).input).toEqual({ accountId: 3 });
});

test("the Seats pane carries the Manager theme, not the vendor name", async ({ page }) => {
	await stubTrpc(page, {
		"jacked.activeSessions": () => ({ sessions: [] }),
		"jacked.swapLog": () => ({ swaps: [] }),
	});
	await openAccountsPane(page);

	await expect(page.getByText("Seats", { exact: true })).toBeVisible();
	// Internals still say jacked (test ids, tRPC); nothing a user reads should.
	await expect(page.getByText("Claude Accounts", { exact: true })).toHaveCount(0);
	await expect(page.getByText(/\bJacked\b/)).toHaveCount(0);
});

test("lists several Claude accounts with meters and an active marker", async ({ page }) => {
	await stubTrpc(page, {
		"jacked.activeSessions": () => ({ sessions: [] }),
		"jacked.swapLog": () => ({ swaps: [] }),
	});
	await openAccountsPane(page);

	await expect(page.getByText("Seats", { exact: true })).toBeVisible();
	const first = page.getByTestId("jacked-account-1");
	const second = page.getByTestId("jacked-account-2");
	await expect(first).toContainText("claude");
	await expect(first).toContainText("active");
	await expect(first).toContainText("5h");
	await expect(second).toContainText("claude-spare");
	// Only the non-active account can be switched to.
	await expect(second.getByRole("button", { name: "Use Account" })).toBeEnabled();
	await expect(first.getByRole("button", { name: "Use Account" })).toBeDisabled();
});

test("switching the active account calls jacked.useAccount for that account", async ({ page }) => {
	const stub = await stubTrpc(page, {
		"jacked.useAccount": () => OK,
		"jacked.activeSessions": () => ({ sessions: [] }),
		"jacked.swapLog": () => ({ swaps: [] }),
	});
	await openAccountsPane(page);

	await page.getByTestId("jacked-account-2").getByRole("button", { name: "Use Account" }).click();

	const call = await stub.waitForCall("jacked.useAccount");
	expect(call.input).toEqual({ accountId: 2 });
});

test("per-account management actions reach the right jacked procedures", async ({ page }) => {
	const stub = await stubTrpc(page, {
		"jacked.validateAccount": () => OK,
		"jacked.updateAccount": () => OK,
		"jacked.reorderAccounts": () => OK,
		"jacked.activeSessions": () => ({ sessions: [] }),
		"jacked.swapLog": () => ({ swaps: [] }),
	});
	await openAccountsPane(page);

	const secondActions = page.getByTestId("jacked-account-actions-2");
	await secondActions.getByRole("button", { name: /^Validate/ }).click();
	expect((await stub.waitForCall("jacked.validateAccount")).input).toEqual({ accountId: 2 });

	await secondActions.getByRole("button", { name: /^Disable/ }).click();
	expect((await stub.waitForCall("jacked.updateAccount")).input).toEqual({
		accountId: 2,
		isActive: false,
	});

	// Raising the second account swaps it ahead of the first in swap priority.
	await secondActions.getByRole("button", { name: /^Raise auto-swap priority/ }).click();
	expect((await stub.waitForCall("jacked.reorderAccounts")).input).toEqual({ accountIds: [2, 1, 3] });
});

test("deleting an account asks for confirmation first", async ({ page }) => {
	const stub = await stubTrpc(page, {
		"jacked.deleteAccount": () => OK,
		"jacked.activeSessions": () => ({ sessions: [] }),
		"jacked.swapLog": () => ({ swaps: [] }),
	});
	await openAccountsPane(page);

	await page.getByTestId("jacked-account-actions-2").getByRole("button", { name: /^Delete/ }).click();
	await expect(page.getByRole("alertdialog")).toContainText("Remove");
	expect(stub.callsTo("jacked.deleteAccount")).toEqual([]);

	await page.getByRole("button", { name: "Remove account" }).click();
	expect((await stub.waitForCall("jacked.deleteAccount")).input).toEqual({ accountId: 2 });
});

test("concurrent sessions are attributed per account", async ({ page }) => {
	// Two accounts each running a session is the observable outcome of pinning two
	// board tasks to different accounts (each gets its own CLAUDE_CONFIG_DIR).
	await stubTrpc(page, {
		"jacked.activeSessions": () => ({
			sessions: [
				{
					accountId: 1,
					sessionId: "aaaa1111",
					repoPath: "/tmp/one",
					lastActivityAt: null,
					isSubagent: false,
					agentType: "claude",
				},
				{
					accountId: 2,
					sessionId: "bbbb2222",
					repoPath: "/tmp/two",
					lastActivityAt: null,
					isSubagent: false,
					agentType: "claude",
				},
				{
					accountId: 2,
					sessionId: "cccc3333",
					repoPath: "/tmp/two",
					lastActivityAt: null,
					isSubagent: true,
					agentType: "reviewer",
				},
			],
		}),
		"jacked.swapLog": () => ({ swaps: [] }),
	});
	await openAccountsPane(page);

	await expect(page.getByTestId("jacked-account-sessions-1")).toHaveText("1 live");
	await expect(page.getByTestId("jacked-account-sessions-2")).toHaveText("2 live");
});

test("a pending paste-code flow can be dismissed and leaves the pane usable", async ({ page }) => {
	const stub = await stubTrpc(page, {
		// Manual mode is the flow that waits on a human-pasted code — up to 10 minutes.
		"jacked.startClaudeOAuth": () => ({
			ok: true,
			flowId: "flow-1",
			mode: "manual",
			authUrl: "https://claude.com/cai/oauth/authorize?example=1",
		}),
		"jacked.oauthFlowStatus": () => ({
			status: "pending",
			flowId: "flow-1",
			accountId: null,
			email: null,
			error: null,
			authUrl: "https://claude.com/cai/oauth/authorize?example=1",
			mode: "manual",
			submitError: null,
		}),
		"jacked.refreshAllUsage": () => OK,
		"jacked.activeSessions": () => ({ sessions: [] }),
		"jacked.swapLog": () => ({ swaps: [] }),
	});
	await openAccountsPane(page);

	await page.getByTestId("jacked-add-account-trigger").click();
	await page.getByTestId("jacked-add-account-provider-claude").click();
	await page.getByTestId("jacked-add-account-paste-code").click();
	await expect(page.getByTestId("jacked-oauth-status")).toBeVisible();
	await expect(page.getByTestId("jacked-oauth-invite-email")).toBeVisible();
	await expect(page.getByPlaceholder("Paste authorization code")).toBeVisible();

	// The rest of the pane must not be frozen while the flow waits for input.
	await expect(page.getByRole("button", { name: "Refresh all usage" })).toBeEnabled();
	await page.getByRole("button", { name: "Refresh all usage" }).click();
	await stub.waitForCall("jacked.refreshAllUsage");

	await page.getByTestId("jacked-oauth-dismiss").click();
	await expect(page.getByTestId("jacked-oauth-status")).toHaveCount(0);
	await expect(page.getByTestId("jacked-add-account-trigger")).toBeEnabled();
});

test("auto-swap can be paused and resumed from the pane", async ({ page }) => {
	const stub = await stubTrpc(page, {
		"jacked.pauseSwap": () => OK,
		"jacked.activeSessions": () => ({ sessions: [] }),
		"jacked.swapLog": () => ({ swaps: [] }),
	});
	await openAccountsPane(page);

	await page.getByRole("button", { name: "Pause auto-swap for 30 minutes" }).click();
	expect((await stub.waitForCall("jacked.pauseSwap")).input).toEqual({ minutes: 30 });
});
