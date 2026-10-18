import { expect, test } from '@playwright/test';
import { launchApp, settle, snap } from './fixtures';

test('customizes the tutor, persists after reload, and uses it in a session', async () => {
  const { app, page } = await launchApp();
  try {
    await page.getByRole('button', { name: 'Customize tutor' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.getByLabel('Tutor name', { exact: true }).fill('Nova');
    await page.getByRole('button', { name: 'Next Hair style', exact: true }).click();
    await page.getByRole('button', { name: 'Next Outfit', exact: true }).click();
    await page.getByRole('tab', { name: 'Body', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Next Hair style', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Skin tone 7', exact: true }).click();
    await page.getByRole('button', { name: 'Next Face style', exact: true }).click();
    await snap(page, 'avatar-body');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByTestId('avatar-celebration')).toBeVisible();
    await snap(page, 'avatar-save');
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Customize tutor' }).click();
    await expect(page.getByLabel('Tutor name', { exact: true })).toHaveValue('Nova');
    await expect(page.getByTestId('avatar-preview').locator('svg')).toHaveAttribute(
      'data-hair',
      'bob',
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1024, 680),
    );
    await expect
      .poll(() => page.evaluate(() => Math.abs(window.innerWidth - 1024)))
      .toBeLessThanOrEqual(1);
    await settle(page);
    await snap(page, 'avatar-style-small');
    await page.getByRole('button', { name: 'Reset to default' }).click();
    await expect(page.getByLabel('Tutor name', { exact: true })).toHaveValue('Ada');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page
      .getByRole('banner')
      .getByRole('button', { name: 'New session', exact: true })
      .click();
    await page.getByRole('radio', { name: 'Just talk', exact: true }).click();
    await page.getByRole('button', { name: 'Start session', exact: true }).click();
    await expect(page.getByTestId('tutor-tile')).toContainText('Nova');
    await expect(page.getByTestId('tutor-tile').locator('svg').first()).toHaveAttribute(
      'data-hair',
      'bob',
    );
  } finally {
    await app.close();
  }
});
