import { expect, test } from '@playwright/test';
import { E2E_SERVER_URL, launchApp, snap } from './fixtures';

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

test('exposes the paper bridge, with every fake off by default', async () => {
  const { app, page } = await launchApp();
  expect(await page.evaluate(() => Object.keys(window.tassel.paper).sort())).toEqual([
    'cameraAccess',
    'getConfig',
    'openCameraSettings',
    'requestCameraAccess',
    'startHelper',
    'stopHelper',
  ]);
  // Only the config: nothing here starts the helper or reads the camera.
  expect(await page.evaluate(() => window.tassel.paper.getConfig())).toEqual({
    source: 'auto',
    debug: false,
    helperClip: false,
    fakeClip: false,
    params: {},
  });
  await app.close();
});

test('keeps the renderer on its own origin', async () => {
  const { app, page } = await launchApp();
  // The bridge reaches the main process, which reads the launch settings.
  expect(await page.evaluate(() => window.tassel.getConfig())).toMatchObject({
    serverUrl: E2E_SERVER_URL,
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

test('boots the renderer in the UI language with the design system', async () => {
  const { app, page } = await launchApp({ TASSEL_UI_LANG: 'ko' });
  await expect(page.getByRole('heading', { name: '내 세션' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('ko');
  // The shared fonts ship inside the app (font-src 'self'): Geist for Latin, Pretendard for Hangul.
  const fontStatus = () =>
    page.evaluate(async () => {
      await document.fonts.ready;
      return Object.fromEntries([...document.fonts].map((font) => [font.family, font.status]));
    });
  await expect.poll(fontStatus).toMatchObject({ Geist: 'loaded', 'Pretendard Variable': 'loaded' });
  // The title strip drags the window.
  const strip = page.getByRole('banner');
  await expect(strip).toHaveCSS('height', '52px');
  expect(await strip.evaluate((el) => getComputedStyle(el).getPropertyValue('app-region'))).toBe(
    'drag',
  );
  // The strip's first item starts 18px past the macOS traffic lights, which end at x 80.
  const first = await strip.locator(':scope > *').first().boundingBox();
  expect(first?.x).toBe(process.platform === 'darwin' ? 98 : 20);
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 249, 243)');
  await app.close();
});
