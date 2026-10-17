import { expect, type Page, test } from '@playwright/test';
import { E2E_SERVER_URL, launchApp, settle, setWindowSize, snap } from './fixtures';

const cardsOf = (page: Page) =>
  page.getByRole('list', { name: 'Your sessions' }).getByRole('listitem');

/** The learner's sessions, straight from the API with the app's own device token. */
async function listSessions(page: Page): Promise<Array<Record<string, unknown>>> {
  const token = await page.evaluate(() => window.tassel.getToken());
  const response = await fetch(`${E2E_SERVER_URL}/v1/sessions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return ((await response.json()) as { items: Array<Record<string, unknown>> }).items;
}

test('starts a session from the sheet and comes back to its card', async () => {
  // The tutor at its own pace names the session only after 4.5 s; this flow ends well before.
  const { app, page } = await launchApp({ TASSEL_FAKE_SPEED: '1' });
  await expect(page.getByRole('region', { name: 'No sessions yet' })).toBeVisible();

  await page.getByRole('banner').getByRole('button', { name: 'New session' }).click();
  const sheet = page.getByRole('dialog', { name: 'New session' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('radio', { name: 'Homework' }).click();
  await sheet.getByRole('radio', { name: 'English' }).click();
  await sheet.getByRole('radio', { name: 'Paper · Desk View' }).click();
  await settle(page);
  await snap(page, 'p1-new-session');

  await sheet.getByRole('button', { name: 'Start session' }).click();
  await expect(page.getByRole('heading', { name: 'Untitled Session' })).toBeVisible();
  expect(await listSessions(page)).toMatchObject([
    { type: 'homework', language: 'en', source: 'paper', title: null },
  ]);

  // End session, confirmed through the sheet, is the only way back (R18).
  await page.getByRole('button', { name: 'End session' }).click();
  await page
    .getByRole('dialog', { name: 'End this session?' })
    .getByRole('button', { name: 'End session' })
    .click();
  await expect(cardsOf(page)).toHaveCount(1);
  await expect(cardsOf(page).first()).toContainText('Untitled Session');
  await expect(cardsOf(page).first()).toContainText('Homework');
  await app.close();
});

test('closes without creating anything, and gives focus back to the button that opened it', async () => {
  const { app, page } = await launchApp();
  const empty = page.getByRole('region', { name: 'No sessions yet' });
  const cta = empty.getByRole('button', { name: 'New session' });
  await cta.click();
  const sheet = page.getByRole('dialog', { name: 'New session' });
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(cta).toBeFocused();

  // The keyboard path: open with Enter, close with Cancel.
  await page.keyboard.press('Enter');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toBeHidden();
  await expect(cta).toBeFocused();
  expect(await listSessions(page)).toEqual([]);
  await app.close();
});

test('fits the sheet in Spanish at the smallest window', async () => {
  const { app, page } = await launchApp({ TASSEL_UI_LANG: 'es' });
  await setWindowSize(app, page, 1024, 680);
  await page.getByRole('banner').getByRole('button', { name: 'Nueva sesión' }).click();
  const sheet = page.getByRole('dialog', { name: 'Nueva sesión' });
  await expect(sheet).toBeVisible();
  // Spanish is the UI language, so it's the default language.
  await expect(sheet.getByRole('radio', { name: 'Español' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await settle(page);
  // The whole sheet shows: no inner scroll, and no option label is cut short.
  expect(await sheet.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
  for (const option of await sheet.getByRole('radio').all()) {
    expect(await option.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await snap(page, 'p1-new-session-es-1024');
  await app.close();
});

test('says so inside the sheet when the server is down, and stays open', async () => {
  const { app, page } = await launchApp({ TASSEL_SERVER_URL: 'http://127.0.0.1:1' });
  await expect(page.getByRole('alert')).toContainText("Couldn't reach Tassel's server");
  await page.getByRole('banner').getByRole('button', { name: 'New session' }).click();
  const sheet = page.getByRole('dialog', { name: 'New session' });
  await sheet.getByRole('button', { name: 'Start session' }).click();
  await expect(sheet.getByRole('alert')).toHaveText(
    "Can't reach the server. Check your connection and try again.",
  );
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Start session' })).toBeVisible();
  await settle(page);
  await snap(page, 'p1-new-session-error');
  await app.close();
});
