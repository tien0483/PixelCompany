import { expect, test } from '../../fixtures/standalone';

const ASSET_RELOAD_TIMEOUT_MS = 15_000;

test.describe('Standalone / Custom Assets', () => {
  test('saving a custom asset triggers asset reload and makes it placeable @area:standalone', async ({
    page,
    standalone,
  }) => {
    await standalone.drainMessages();

    // 1. Enter edit mode
    await page.getByTitle('Edit office layout').click();
    await page.getByRole('button', { name: 'Furniture' }).click();

    // 2. Click the Draw button to open the pixel editor
    await page.getByTitle('Draw a custom pixel art asset').click();

    // 3. Wait for the modal to open
    await expect(page.getByText('Create Custom Asset')).toBeVisible();

    // 4. Fill in the asset name
    await page.getByLabel('Name').fill('E2E Test Desk');

    // 5. Draw a few pixels so it is not completely empty
    const canvas = page.locator('canvas').first();
    await canvas.click({ position: { x: 50, y: 50 } });
    await canvas.click({ position: { x: 60, y: 50 } });

    // 6. Click "Save to Office"
    await page.getByRole('button', { name: 'Save to Office' }).click();

    // 7. The modal should close
    await expect(page.getByText('Create Custom Asset')).toBeHidden();

    // 8. A furnitureAssetsLoaded message should eventually arrive
    await expect
      .poll(
        async () => {
          const messages = await standalone.drainMessages();
          return messages.some((message) => message.type === 'furnitureAssetsLoaded');
        },
        { timeout: ASSET_RELOAD_TIMEOUT_MS },
      )
      .toBe(true);

    // 9. Assert that the item appears in the catalog
    await expect(page.getByTitle('E2E Test Desk', { exact: true })).toBeVisible({ timeout: 5000 });
  });
});
