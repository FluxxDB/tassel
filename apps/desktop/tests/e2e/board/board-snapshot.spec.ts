// The board snapshot the voice server asks for on a board turn (its board-snapshot request): the
// fake tutor's board-snapshot script draws a small DFA on the board, asks for the board, hides it
// behind the paper and asks again. Each time the app posts the board as a base64 PNG (at most
// about 1280 px on its long side, a small board at twice its size) to the E2E server, which checks it is a PNG under 2 MiB and answers 204. The
// script runs at speed 1, so both requests land inside tldraw's 5 s license window in a build
// without a key (board-demo.spec.ts). The PNGs go to test-results/screens to look at.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { launchApp, settle, snap } from '../fixtures';

const LICENSE_PING = 'https://cdn.tldraw.com/5.5.2/watermarks/watermark-track.svg';
const screens = join(__dirname, '..', '..', '..', 'test-results', 'screens');

interface Posted {
  status: number;
  png: Buffer;
}

async function startSession(page: Page): Promise<void> {
  await expect(page.getByRole('region', { name: 'No sessions yet' })).toBeVisible();
  await page.getByRole('banner').getByRole('button', { name: 'New session' }).click();
  await page
    .getByRole('dialog', { name: 'New session' })
    .getByRole('button', { name: 'Start session' })
    .click();
  await expect(page.getByTestId('stage')).toBeVisible();
}

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

test("posts Ada's board as a PNG on the server's request, shown or hidden", async () => {
  test.setTimeout(60_000);
  const { app, page } = await launchApp({
    TASSEL_FAKE_SCRIPT: 'board-snapshot',
    TASSEL_FAKE_SPEED: '1',
  });
  await app.context().route(
    (url) => url.href.startsWith(LICENSE_PING),
    (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg/>' }),
  );
  const posted: Posted[] = [];
  page.on('response', (response) => {
    const request = response.request();
    if (request.method() !== 'POST' || !/\/board\/snapshot$/.test(request.url())) return;
    const { image_png } = request.postDataJSON() as { image_png: string };
    posted.push({ status: response.status(), png: Buffer.from(image_png, 'base64') });
  });
  try {
    await startSession(page);
    // Ada's DFA is on the board, which shows.
    await expect(page.getByRole('region', { name: "Ada's board" })).toBeVisible({ timeout: 5_000 });
    await expect.poll(() => posted.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
    await snap(page, 'board-snapshot-shown');
    // Then the paper takes the stage, and the board, hidden, still answers.
    await expect(page.getByRole('region', { name: "Ada's board" })).toBeHidden({ timeout: 5_000 });
    await expect.poll(() => posted.length, { timeout: 10_000 }).toBe(2);
    await settle(page);
    await snap(page, 'board-snapshot-hidden');

    for (const [i, { status, png }] of posted.entries()) {
      expect(status).toBe(204);
      expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]));
      expect(png.length).toBeLessThan(1.8 * 1024 * 1024);
      const { width, height } = pngSize(png);
      // About 1280 px at most; this small DFA stops at twice its size, crisp and legible.
      expect(Math.max(width, height)).toBeGreaterThan(400);
      expect(Math.max(width, height)).toBeLessThanOrEqual(1300);
      writeFileSync(join(screens, `board-snapshot-png-${i + 1}.png`), png);
    }
  } finally {
    await app.close();
  }
});
