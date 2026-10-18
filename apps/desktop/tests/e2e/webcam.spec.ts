import { expect, test } from '@playwright/test';
import { framesOf, latestSession, launchApp, snap } from './fixtures';

test('webcam paper uploads through the detector and stops when the session ends', async () => {
  test.setTimeout(90_000);
  // The webcam implementation, with Chromium forced onto the synthetic video and microphone.
  const { app, page } = await launchApp({ TASSEL_PAPER_SOURCE: 'webcam', TASSEL_PAPER_DEBUG: '1' });
  page.on('console', (message) => {
    if (message.text().includes('[paper')) console.log(message.text());
  });
  page.on('pageerror', (error) => console.log(error.message));
  page.on('response', (response) => {
    if (response.url().includes('/frames') && response.status() >= 400)
      console.log(`frame HTTP ${response.status()}`);
  });
  try {
    await page.getByRole('banner').getByRole('button', { name: 'New session' }).click();
    const sheet = page.getByRole('dialog', { name: 'New session' });
    await sheet.getByRole('radio', { name: 'Paper · Camera' }).click();
    await sheet.getByRole('button', { name: 'Start session' }).click();
    const video = page.getByTestId('paper-video');
    await expect(video).toBeVisible();
    await video.evaluate((element: HTMLVideoElement) => {
      (window as unknown as { __webcamTrack: MediaStreamTrack }).__webcamTrack = (
        element.srcObject as MediaStream
      ).getVideoTracks()[0] as MediaStreamTrack;
    });
    await expect(page.getByRole('banner').getByText('Camera · Live')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Paper camera' })).toBeVisible();
    const session = await latestSession(page);
    await expect
      .poll(
        async () => (await framesOf(page, session.id)).filter((f) => f.source === 'webcam').length,
        { timeout: 35_000 },
      )
      .toBeGreaterThan(0);
    const [first] = await framesOf(page, session.id);
    expect(first).toMatchObject({ source: 'webcam', reason: 'ink', page_found: true });
    await snap(page, 'windows-webcam-synthetic');
    await page.getByRole('button', { name: 'End session', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'End this session?' })
      .getByRole('button', { name: 'End session', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Your sessions' })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __webcamTrack?: MediaStreamTrack }).__webcamTrack?.readyState,
        ),
      )
      .toBe('ended');
  } catch (error) {
    console.log(await page.locator('body').innerText());
    await snap(page, 'webcam-failure');
    throw error;
  } finally {
    await app.close();
  }
});
