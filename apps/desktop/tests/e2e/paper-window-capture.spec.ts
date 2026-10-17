// Window capture (Task 13): with TASSEL_FAKE_DISPLAY=self, getDisplayMedia shares the app's own
// window, with no picker and no OS permission (Task 1's check T), so her paper panel goes live on
// a window, under the window tag.
import { expect, type Page, test } from '@playwright/test';
import { launchApp, settle, snap, startPaperSession, watchPaperConsole } from './fixtures';

const LIVE_RED = 'rgb(229, 72, 77)';

const videoSize = (page: Page) =>
  page
    .getByTestId('paper-video')
    .evaluate((video: HTMLVideoElement) => [video.videoWidth, video.videoHeight]);

test('a shared window goes live under its own tag', async () => {
  const { app, page } = await launchApp({
    TASSEL_PAPER_SOURCE: 'window-capture',
    TASSEL_FAKE_DISPLAY: 'self',
  });
  const problems = watchPaperConsole(page);
  await startPaperSession(page);

  const region = page.getByRole('region', { name: 'Your paper · Desk View window' });
  await expect(region.getByTestId('paper-video')).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await videoSize(page))[0] ?? 0).toBeGreaterThan(0);
  await expect(region.getByText('Your paper · Desk View window', { exact: true })).toBeVisible();
  const live = page.getByRole('banner').getByText('Desk View · Live', { exact: true });
  await expect(live.locator('span[aria-hidden="true"]')).toHaveCSS('background-color', LIVE_RED);
  await settle(page);
  await snap(page, 'p3-paper-window-1440');
  await app.close();
  expect(problems).toEqual([]);
});
