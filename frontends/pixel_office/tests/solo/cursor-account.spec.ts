import { expect, test } from "@playwright/test";

import { stubTrpc } from "./trpc-stub";

const OK = { ok: true };

async function openAccountsPane(page: import("@playwright/test").Page) {
	await page.goto("/?officeE2e=1");
	await expect(page.getByTestId("manager-accounts-view")).toBeVisible();
}

test("Cursor row uses Use Account and Claude fleet auto-swap footer copy", async ({ page }) => {
	await stubTrpc(page, {
		"manager.activeSessions": () => ({ sessions: [] }),
		"manager.swapLog": () => ({ swaps: [] }),
	});
	await openAccountsPane(page);

	const cursorRow = page.getByTestId("jacked-account-3");
	await expect(cursorRow.getByRole("button", { name: "Use Account" })).toBeVisible();
	await expect(cursorRow).toContainText("Kanban: pin this account on a Cursor task");
	await expect(cursorRow).toContainText("in IDE");
	await expect(page.getByTestId("jacked-account-1")).toContainText("active");
	await expect(page.getByText("Claude fleet only")).toBeVisible();
});

test("Add Account import Cursor calls manager.importCursorAccount", async ({ page }) => {
	const stub = await stubTrpc(page, {
		"manager.importCursorAccount": () => OK,
		"manager.activeSessions": () => ({ sessions: [] }),
		"manager.swapLog": () => ({ swaps: [] }),
	});
	await openAccountsPane(page);

	await page.getByRole("button", { name: "Add Account" }).click();
	await page.getByTestId("jacked-add-account-provider-cursor").click();
	await page.getByTestId("jacked-add-account-import-cursor").click();

	expect((await stub.waitForCall("manager.importCursorAccount")).input).toBeUndefined();
});

test("Claude rows still expose OAuth controls while Cursor rows do not", async ({ page }) => {
	await stubTrpc(page, {
		"manager.activeSessions": () => ({ sessions: [] }),
		"manager.swapLog": () => ({ swaps: [] }),
	});
	await openAccountsPane(page);

	const claudeActions = page.getByTestId("manager-account-actions-1");
	await expect(claudeActions.getByRole("button", { name: /^Re-authenticate/ })).toBeVisible();
	await expect(claudeActions.getByRole("button", { name: /^Authorize Claude Code/ })).toBeVisible();
	await expect(claudeActions.getByRole("button", { name: /^Raise auto-swap priority/ })).toBeVisible();

	const cursorActions = page.getByTestId("manager-account-actions-3");
	await expect(cursorActions.getByRole("button", { name: /^Re-import/ })).toBeVisible();
	await expect(cursorActions.getByRole("button", { name: /^Re-authenticate/ })).toHaveCount(0);
});
