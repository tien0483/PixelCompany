import { expect, type Page, test } from "@playwright/test";

/**
 * Proves the "start only the kanban" goal: one process, one origin, everything on it.
 *
 * The server under test is `scripts/solo.mjs` — the Kanban runtime serving the built
 * UI, the board, PTY sessions and the Jacked bridge, with jacked spawned headless as
 * its own child. Nothing here talks to a Vite dev server or the raw jacked dashboard.
 *
 * Board-specific checks need a registered project. Rather than writing a project into
 * the user's real `~/.cline/kanban` config, they skip unless `PIXELOFFICE_E2E_PROJECT`
 * names one that is already open.
 */
const requiresProject = process.env.PIXELOFFICE_E2E_PROJECT !== undefined;

async function dismissOnboarding(page: Page) {
	// A fresh runtime opens the "Get started" carousel over the board.
	const dialog = page.getByRole("dialog").filter({ hasText: "Get started" });
	if ((await dialog.count()) > 0) {
		await page.keyboard.press("Escape");
		await expect(dialog).toHaveCount(0);
	}
}

async function hasBoard(page: Page): Promise<boolean> {
	return (await page.locator('[data-column-id="backlog"]').count()) > 0;
}

test("the whole product is served from the single runtime origin", async ({ page, baseURL }) => {
	const appOrigin = new URL(baseURL ?? "http://127.0.0.1:3499").origin;
	const crossOrigin: string[] = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (url.protocol.startsWith("http") && url.origin !== appOrigin) {
			crossOrigin.push(request.url());
		}
	});

	await page.goto("/");
	await expect(page).toHaveTitle(/Kanban/);
	await dismissOnboarding(page);

	// Shell served by the runtime itself: sidebar tabs, settings, Jacked config strip.
	await expect(page.getByRole("button", { name: "Projects" })).toBeVisible();
	await expect(page.getByTestId("sidebar-jacked-tab")).toBeVisible();
	await expect(page.getByTestId("open-settings-button")).toBeVisible();

	// Neither the Vite dev server nor the raw companion dashboards may be contacted.
	expect(crossOrigin.filter((url) => url.includes(":8321"))).toEqual([]);
	expect(crossOrigin.filter((url) => url.includes(":8322"))).toEqual([]);
	expect(crossOrigin.filter((url) => url.includes(":5173"))).toEqual([]);
	await expect(page.locator('iframe[src*="8321"]')).toHaveCount(0);
	await expect(page.locator('iframe[src*="8322"]')).toHaveCount(0);
});

test("the Jacked bridge answers on the same origin", async ({ page, baseURL }) => {
	await page.goto("/");

	// Same-origin tRPC: proves the Python service is reachable only through the runtime.
	const state = await page.request.get(
		`${baseURL}/api/trpc/manager.state?batch=1&input=${encodeURIComponent("{}")}`,
	);
	expect(state.status()).toBe(200);
	const payload = (await state.json()) as Array<{ result?: { data?: { accounts?: unknown[] } } }>;
	expect(Array.isArray(payload[0]?.result?.data?.accounts)).toBe(true);

	const sessions = await page.request.get(
		`${baseURL}/api/trpc/manager.activeSessions?batch=1&input=${encodeURIComponent("{}")}`,
	);
	expect(sessions.status()).toBe(200);

	const health = await page.request.get(`${baseURL}/api/manager-proxy/api/health`);
	expect(health.status()).toBe(200);
});

test("Claude Code is the only agent offered", async ({ page }) => {
	await page.goto("/");
	await dismissOnboarding(page);
	await page.getByTestId("open-settings-button").click();
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByText("Settings", { exact: true })).toBeVisible();

	await expect(dialog.getByText("Claude Code", { exact: false }).first()).toBeVisible();
	// Cline is gated out of the launch catalog, so neither the agent list nor the
	// Cline settings section may appear.
	await expect(dialog.getByRole("button", { name: "Cline", exact: true })).toHaveCount(0);
	await expect(dialog.getByText("OpenAI Codex", { exact: true })).toHaveCount(0);
});

test("board columns render and a task persists through the runtime", async ({ page }) => {
	await page.goto("/");
	await dismissOnboarding(page);
	test.skip(
		!(await hasBoard(page)) && !requiresProject,
		"No project open in this runtime — open one (or set PIXELOFFICE_E2E_PROJECT) to exercise the board.",
	);

	await expect(page.getByText("Backlog", { exact: true })).toBeVisible();
	await expect(page.getByText("In Progress", { exact: true })).toBeVisible();
	await expect(page.getByText("Review", { exact: true })).toBeVisible();

	const taskTitle = `solo-${Date.now()}`;
	const backlog = page.locator('[data-column-id="backlog"]').first();
	await backlog.getByRole("button", { name: "Create task" }).click();
	const prompt = page.getByPlaceholder("Describe the task");
	await prompt.fill(taskTitle);
	await prompt.press("Control+Enter");
	await expect(page.locator("[data-task-id]").filter({ hasText: taskTitle }).first()).toBeVisible();

	// A reload proves the runtime persisted it rather than the browser holding state.
	await page.reload();
	await dismissOnboarding(page);
	await expect(page.locator("[data-task-id]").filter({ hasText: taskTitle }).first()).toBeVisible();
});

test("Claude Accounts and the docked office share the right column", async ({ page }) => {
	await page.goto("/");
	await dismissOnboarding(page);
	test.skip(
		!(await hasBoard(page)) && !requiresProject,
		"The right column only mounts with a project open.",
	);

	if ((await page.getByTestId("home-right-column").count()) === 0) {
		await page.getByTestId("toggle-office-button").click();
	}
	await expect(page.getByTestId("home-triple-pane")).toBeVisible();
	await expect(page.getByTestId("home-right-column")).toBeVisible();
	await expect(page.getByTestId("manager-accounts-view")).toBeVisible();
	// The office is docked natively — no jacked iframe panel.
	await expect(page.getByTestId("office-jacked-side-panel")).toHaveCount(0);
});
