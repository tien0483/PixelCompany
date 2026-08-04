import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const currentDir = dirname(fileURLToPath(import.meta.url));
const screenshotDir = join(currentDir, "screenshots");

async function waitForOfficeCanvas(page: import("@playwright/test").Page) {
	await page.goto("/?officeE2e=1");
	await expect(page.getByTestId("office-e2e-harness")).toBeVisible();
	const canvas = page.locator("canvas").first();
	await expect(canvas).toBeVisible({ timeout: 30_000 });
	// Assets decode asynchronously; wait until the canvas has a non-zero paint size.
	await expect
		.poll(async () => {
			return await canvas.evaluate((node) => {
				const element = node as HTMLCanvasElement;
				return element.width * element.height;
			});
		})
		.toBeGreaterThan(0);
	// Give agents a beat to settle at desks before clipping the floor.
	await page.waitForTimeout(800);
	return canvas;
}

test.beforeAll(async () => {
	await mkdir(screenshotDir, { recursive: true });
});

test("office harness captures overview and desks", async ({ page }) => {
	const canvas = await waitForOfficeCanvas(page);

	await expect(page.getByTestId("office-e2e-kanban-shell")).toBeVisible();
	await expect(page.getByTestId("office-e2e-topbar")).toBeVisible();
	await expect(page.getByText("npx kanban · e2e shell")).toBeVisible();
	await expect(page.getByTestId("toggle-office-button")).toBeVisible();
	await expect(page.getByTestId("office-floor")).toBeVisible();
	await expect(page.getByTestId("office-meter-wall")).toHaveCount(0);
	await expect(page.getByTestId("office-intake-cta")).toHaveCount(0);

	await page.screenshot({
		path: join(screenshotDir, "office-overview.png"),
		fullPage: true,
	});
	await canvas.screenshot({
		path: join(screenshotDir, "office-canvas.png"),
	});
	await page.getByTestId("office-canvas").screenshot({
		path: join(screenshotDir, "office-agents-desks.png"),
	});
	await page.getByTestId("office-e2e-chrome").screenshot({
		path: join(screenshotDir, "office-pressure-slider.png"),
	});
	await page.getByTestId("office-e2e-topbar").screenshot({
		path: join(screenshotDir, "office-kanban-topbar.png"),
	});
});

test("select sample task updates selection chrome", async ({ page }) => {
	await waitForOfficeCanvas(page);
	await expect(page.getByTestId("office-e2e-selected-task")).toHaveText("selected: none");

	await page.getByTestId("office-e2e-select-sample").click();
	await expect(page.getByTestId("office-e2e-selected-task")).toHaveText(
		"selected: e2e-task-claude",
	);
	await page.getByTestId("office-e2e-chrome").screenshot({
		path: join(screenshotDir, "office-selected-create-ui.png"),
	});
});

test("high usage pressure dims the office atmosphere", async ({ page }) => {
	await waitForOfficeCanvas(page);

	await page.getByTestId("office-e2e-pressure").fill("92");
	await expect(page.getByTestId("office-e2e-pressure-value")).toHaveText("92%");
	await expect(page.getByTestId("office-atmosphere")).toBeVisible();

	await page.screenshot({
		path: join(screenshotDir, "office-high-pressure.png"),
		fullPage: true,
	});
	await page.screenshot({
		path: join(screenshotDir, "office-night-shift.png"),
		fullPage: true,
	});
});

test("low usage pressure keeps atmosphere clear", async ({ page }) => {
	await waitForOfficeCanvas(page);

	await page.getByTestId("office-e2e-pressure").fill("20");
	await expect(page.getByTestId("office-e2e-pressure-value")).toHaveText("20%");
	await expect(page.getByTestId("office-atmosphere")).toHaveCount(0);

	await page.screenshot({
		path: join(screenshotDir, "office-low-pressure.png"),
		fullPage: true,
	});
});

test("empty floor vs staffed desks", async ({ page }) => {
	await waitForOfficeCanvas(page);

	await page.getByTestId("office-canvas").screenshot({
		path: join(screenshotDir, "office-floor-staffed.png"),
	});

	await page.getByTestId("office-e2e-floor-mode").selectOption("empty");
	await page.waitForTimeout(800);
	await page.getByTestId("office-canvas").screenshot({
		path: join(screenshotDir, "office-floor-empty.png"),
	});
});

test("jacked accounts view and docked office are visible in the right column chrome", async ({ page }) => {
	await waitForOfficeCanvas(page);
	await expect(page.getByTestId("home-triple-pane")).toBeVisible();
	await expect(page.getByTestId("home-right-column")).toBeVisible();
	await expect(page.getByTestId("manager-accounts-view")).toBeVisible();
	await expect(page.getByTestId("jacked-account-1")).toBeVisible();
	await expect(page.getByTestId("jacked-accounts-swap-history")).toBeVisible();
	await expect(page.getByTestId("office-floor")).toBeVisible();
	await expect(page.getByTestId("office-jacked-panel-toggle")).toHaveCount(0);
	await expect(page.getByTestId("office-jacked-side-panel")).toHaveCount(0);
	await page.getByTestId("home-right-column").screenshot({
		path: join(screenshotDir, "office-right-column.png"),
	});
});
