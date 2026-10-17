import { expect, test } from '@playwright/test';
import { launchApp, snap } from './fixtures';

test('launches securely with the bridge', async () => {
  const { app, page } = await launchApp();
  await expect(page).toHaveTitle('Tassel');
  expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe(
    'undefined',
  );
  expect(await page.evaluate(() => window.tassel.platform)).toBe(process.platform);
  expect(await page.evaluate(() => location.protocol)).toBe('app:');
  await snap(page, 'p1-shell');
  await app.close();
});

test('keeps the renderer on its own origin', async () => {
  const { app, page } = await launchApp();
  // The bridge reaches the main process, which reads the launch settings.
  expect(await page.evaluate(() => window.tassel.getConfig())).toMatchObject({
    serverUrl: 'http://127.0.0.1:8799',
    fakeSpeed: 20,
  });
  // The CSP refuses inline scripts.
  const inlineScriptRan = await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'document.body.dataset.inline = "ran"';
    document.head.append(script);
    return document.body.dataset.inline === 'ran';
  });
  expect(inlineScriptRan).toBe(false);
  // New windows and navigation away from app://tassel are refused.
  expect(await page.evaluate(() => window.open('http://127.0.0.1:1/') === null)).toBe(true);
  const navigated = page.waitForEvent('framenavigated', { timeout: 1_000 }).then(
    () => true,
    () => false,
  );
  await page.evaluate(() => {
    location.href = 'http://127.0.0.1:1/';
  });
  expect(await navigated).toBe(false);
  expect(page.url()).toBe('app://tassel/index.html');
  expect(app.windows()).toHaveLength(1);
  await app.close();
});
