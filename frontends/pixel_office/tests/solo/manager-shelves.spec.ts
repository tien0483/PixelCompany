import { expect, type Page, test } from "@playwright/test";

import { stubTrpc } from "./trpc-stub";

/**
 * Manager's staffing surfaces: Staff / Playbooks / Training / Handbook.
 *
 * All four are slices of the same feature list the runtime streams in the jacked
 * snapshot. The office e2e harness (`?officeE2e=1`) supplies that snapshot as a prop,
 * so these specs read the harness fixture and only stub the calls that genuinely go
 * over tRPC — the toggles (which would otherwise write into the user's global
 * ~/.claude) and the pack list.
 */
const PACKS = {
	npxAvailable: true,
	packs: [
		{
			name: "marketing",
			displayName: "Marketing Skills",
			description: "Curated marketing skills.",
			source: "coreyhaines31/marketingskills",
			homepage: "https://github.com/coreyhaines31/marketingskills",
			skillCount: 20,
			installedCount: 0,
			enabled: false,
			isDefault: true,
			explicit: false,
		},
	],
};

async function openManager(page: Page, route: string) {
	await page.goto("/?officeE2e=1");
	await expect(page.getByTestId("office-e2e-harness")).toBeVisible();
	await page.getByTestId("sidebar-jacked-tab").click();
	await page.getByRole("button", { name: route, exact: true }).click();
}

async function stubManager(page: Page, overrides: Record<string, (input: unknown) => unknown> = {}) {
	return await stubTrpc(page, {
		"manager.activeSessions": () => ({ sessions: [] }),
		"manager.swapLog": () => ({ swaps: [] }),
		"manager.packs": () => PACKS,
		...overrides,
	});
}

test("the sidebar tab reads Manager and lists the staffing routes", async ({ page }) => {
	await stubManager(page);
	await page.goto("/?officeE2e=1");
	await page.getByTestId("sidebar-jacked-tab").click();

	await expect(page.getByTestId("sidebar-jacked-tab")).toHaveText("Manager");
	for (const route of ["Staff", "Playbooks", "Training", "Handbook"]) {
		await expect(page.getByRole("button", { name: route, exact: true })).toBeVisible();
	}
});

test("Staff lists subagents and hiring one calls setFeatureEnabled", async ({ page }) => {
	const stub = await stubManager(page, { "manager.setFeatureEnabled": () => ({ ok: true }) });
	await openManager(page, "Staff");

	const shelf = page.getByTestId("manager-shelf-staff");
	await expect(shelf).toBeVisible();
	// Fixture has three subagents, two of them already hired.
	await expect(shelf).toContainText("2/3");
	await expect(shelf.getByTestId("manager-shelf-staff-row-code-simplicity-reviewer")).toBeVisible();

	await shelf.getByRole("button", { name: "Install code-simplicity-reviewer" }).click();
	expect((await stub.waitForCall("manager.setFeatureEnabled")).input).toEqual({
		category: "agents",
		name: "code-simplicity-reviewer",
		enabled: true,
	});
});

test("each shelf shows only its own slice of the feature list", async ({ page }) => {
	await stubManager(page);

	await openManager(page, "Playbooks");
	const playbooks = page.getByTestId("manager-shelf-playbooks");
	await expect(playbooks.getByTestId("manager-shelf-playbooks-row-release")).toBeVisible();
	await expect(playbooks.getByTestId("manager-shelf-playbooks-row-rules")).toHaveCount(0);

	await page.getByRole("button", { name: "Handbook", exact: true }).click();
	const handbook = page.getByTestId("manager-shelf-handbook");
	await expect(handbook.getByTestId("manager-shelf-handbook-row-rules")).toBeVisible();
	// Skills live in the same jacked category but belong to Training.
	await expect(handbook.getByTestId("manager-shelf-handbook-row-skill_apple-design")).toHaveCount(0);

	await page.getByRole("button", { name: "Training", exact: true }).click();
	const training = page.getByTestId("manager-shelf-training");
	await expect(training.getByTestId("manager-shelf-training-row-skill_apple-design")).toBeVisible();
	await expect(training.getByTestId("manager-shelf-training-row-rules")).toHaveCount(0);
});

test("filtering narrows a shelf", async ({ page }) => {
	await stubManager(page);
	await openManager(page, "Staff");

	const shelf = page.getByTestId("manager-shelf-staff");
	// Matching is fuzzy (Fzf, the same as the git-refs panel), so the contract is
	// ranking — the best match comes first — rather than exclusion.
	await shelf.getByTestId("manager-shelf-staff-filter").fill("coverage");
	await expect(shelf.locator("li").first()).toHaveAttribute(
		"data-testid",
		"manager-shelf-staff-row-test-coverage-engineer",
	);

	await shelf.getByTestId("manager-shelf-staff-filter").fill("zzzqqq");
	await expect(shelf.getByText("No matches.")).toBeVisible();
	await expect(shelf.locator("li")).toHaveCount(0);
});

test("Training hosts skill packs and toggling one calls setPackEnabled", async ({ page }) => {
	const stub = await stubManager(page, { "manager.setPackEnabled": () => ({ ok: true }) });
	await openManager(page, "Training");

	const packs = page.getByTestId("training-packs-panel");
	await expect(packs).toBeVisible();
	await expect(packs.getByTestId("training-pack-marketing")).toContainText("Marketing Skills");
	// A pack is a set, so install state reads as a count.
	await expect(packs.getByTestId("training-pack-marketing")).toContainText("0/20");

	await packs.getByRole("button", { name: "Install Marketing Skills" }).click();
	expect((await stub.waitForCall("manager.setPackEnabled")).input).toEqual({
		name: "marketing",
		enabled: true,
	});
});
