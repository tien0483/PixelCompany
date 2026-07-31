import { expect, type Page, test } from "@playwright/test";

const NO_RUNTIME =
	"Kanban runtime is not on :3484 — this Vite config only starts the dev server. " +
	"Run `npm start` in another shell, or use `npm run test:e2e:solo` for a self-contained run.";
const NO_PROJECT = "No project open in this runtime — the board does not mount.";

/** Vite proxies /api to the runtime, so this fails fast when only Vite is up. */
async function runtimeIsReachable(page: Page): Promise<boolean> {
	try {
		const response = await page.request.get("/api/trpc/projects.list?batch=1&input=%7B%7D", {
			timeout: 5_000,
		});
		return response.status() === 200;
	} catch {
		return false;
	}
}

/** A fresh runtime opens the "Get started" carousel over the board. */
async function dismissOnboarding(page: Page) {
	const dialog = page.getByRole("dialog").filter({ hasText: "Get started" });
	if ((await dialog.count()) > 0) {
		await page.keyboard.press("Escape");
		await expect(dialog).toHaveCount(0);
	}
}

/**
 * Loads the app and reports whether the board is usable.
 *
 * Skips rather than fails on the two environmental preconditions these specs cannot
 * create for themselves: a running runtime, and a registered project (which would
 * otherwise mean writing into the user's real ~/.cline/kanban config).
 */
async function openBoard(page: Page): Promise<boolean> {
	await page.goto("/");
	test.skip(!(await runtimeIsReachable(page)), NO_RUNTIME);
	await dismissOnboarding(page);
	return (await page.locator('[data-column-id="backlog"]').count()) > 0;
}

async function createTaskFromBacklog(page: Page, title: string) {
	const backlogColumn = page.locator('[data-column-id="backlog"]').first();
	await backlogColumn.getByRole("button", { name: "Create task" }).click();
	const prompt = page.getByPlaceholder("Describe the task");
	await prompt.fill(title);
	await prompt.press("Control+Enter");
}

async function openTaskFromBoard(page: Page, title: string) {
	const card = page.locator("[data-task-id]").filter({ hasText: title }).first();
	await expect(card).toBeVisible();
	await card.click();
}

test("renders kanban top bar and columns", async ({ page }) => {
	const hasBoard = await openBoard(page);
	await expect(page).toHaveTitle(/Kanban/);
	await expect(page.getByRole("button", { name: "Projects" })).toBeVisible();
	test.skip(!hasBoard, NO_PROJECT);
	await expect(page.getByRole("button", { name: "Agent" })).toBeVisible();
	await expect(page.getByText("Backlog", { exact: true })).toBeVisible();
	await expect(page.getByText("In Progress", { exact: true })).toBeVisible();
	await expect(page.getByText("Review", { exact: true })).toBeVisible();
	await expect(page.getByText("Trash", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Create task" })).toBeVisible();
});

test("creating and opening a backlog task shows the inline editor", async ({ page }) => {
	test.skip(!(await openBoard(page)), NO_PROJECT);
	const taskTitle = `smoke-${Date.now()}`;
	await createTaskFromBacklog(page, taskTitle);
	await openTaskFromBoard(page, taskTitle);
	await expect(page.getByPlaceholder("Describe the task")).toHaveValue(taskTitle);
	await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
});

test("escape key closes the backlog inline editor", async ({ page }) => {
	test.skip(!(await openBoard(page)), NO_PROJECT);
	const taskTitle = `escape-${Date.now()}`;
	await createTaskFromBacklog(page, taskTitle);
	await openTaskFromBoard(page, taskTitle);
	await expect(page.getByPlaceholder("Describe the task")).toHaveValue(taskTitle);
	await page.keyboard.press("Escape");
	await expect(page.getByPlaceholder("Describe the task")).toHaveCount(0);
	await expect(page.getByText("Backlog", { exact: true })).toBeVisible();
	await expect(page.locator("[data-task-id]").filter({ hasText: taskTitle }).first()).toBeVisible();
});

test("settings button opens runtime settings dialog", async ({ page }) => {
	await openBoard(page);
	await page.getByTestId("open-settings-button").click();
	await expect(page.getByRole("dialog").getByText("Settings", { exact: true })).toBeVisible();
});
