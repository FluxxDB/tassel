import { expect, type Page, test } from '@playwright/test';
import { E2E_SERVER_URL, launchApp, settle, snap } from '../fixtures';
import { hasTldrawKey } from './tldraw-key';

// tldraw's license ping, the one request it may make off the app's origin (P5-R2).
const LICENSE_PING = 'https://cdn.tldraw.com/5.5.2/watermarks/watermark-track.svg';

/** Starts a new session from the library's empty state, through the sheet's defaults. */
async function startSession(page: Page): Promise<void> {
  await expect(page.getByRole('region', { name: 'No sessions yet' })).toBeVisible();
  await page.getByRole('banner').getByRole('button', { name: 'New session' }).click();
  await page
    .getByRole('dialog', { name: 'New session' })
    .getByRole('button', { name: 'Start session' })
    .click();
  await expect(page.getByTestId('stage')).toBeVisible();
}

/** Paper pinned, Split pinned, then Board pinned (R17). */
async function pinBoard(page: Page): Promise<void> {
  for (let press = 0; press < 3; press++) await page.keyboard.press('b');
  await expect(page.getByRole('button', { name: 'Board: Board, pinned' })).toBeVisible();
}

/** A request the board may make: the app's own origin, its blobs and data, the API, the ping. */
function isAllowed(url: string): boolean {
  return (
    ['app://', 'blob:', 'data:', `${E2E_SERVER_URL}/`].some((prefix) => url.startsWith(prefix)) ||
    url === LICENSE_PING ||
    url.startsWith(`${LICENSE_PING}?`)
  );
}

/**
 * Whether BoardPanel has loaded tldraw's lazy chunk: loading it adds the chunk's stylesheet. (The
 * request list can't tell: with the ping intercepted, Playwright reports no app:// requests.)
 */
const tldrawLoaded = (page: Page) =>
  page.evaluate(() => document.querySelector('link[href*="TldrawCanvas-"]') !== null);

const tldraw = (page: Page) => page.locator('[data-testid="board-canvas"] .tl-container');

test('mounts self-hosted and quiet', async () => {
  const { app, page } = await launchApp();
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  // The ping is best-effort analytics: answer it here, so the spec never depends on the network.
  await app.context().route(
    (url) => url.href.startsWith(LICENSE_PING),
    (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg/>' }),
  );

  await startSession(page);
  // Paper pinned. Ada asks for the board (27.6 s into her script), but it stays away, so
  // tldraw isn't even loaded.
  await page.keyboard.press('b');
  await expect(page.getByText('Ada asks: Paper and board')).toBeVisible({ timeout: 10_000 });
  expect(await tldrawLoaded(page)).toBe(false);

  // Listen before the board shows: tldraw's fonts, icons and translations must all pass the CSP.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { cspViolations: string[] }).cspViolations = seen;
    document.addEventListener('securitypolicyviolation', (event) =>
      seen.push(`${event.effectiveDirective} ${event.blockedURI}`),
    );
  });
  // Split pinned, then Board pinned.
  await page.keyboard.press('b');
  await page.keyboard.press('b');
  await expect(page.getByRole('button', { name: 'Board: Board, pinned' })).toBeVisible();

  // tldraw loads and mounts inside the board panel within its license window.
  await expect(tldraw(page)).toBeVisible({ timeout: 5_000 });
  expect(await tldrawLoaded(page)).toBe(true);

  // After a click on the canvas, P1's shortcuts still work: C toggles the captions.
  await page.locator('[data-testid="board-canvas"] .tl-canvas').click();
  const captions = page.getByRole('button', { name: 'Captions', exact: true });
  await expect(captions).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('c');
  await expect(captions).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('c');
  await expect(captions).toHaveAttribute('aria-pressed', 'true');

  await settle(page);
  await snap(page, 'p5-board-canvas-1440');

  expect(requests.filter((url) => !isAllowed(url))).toEqual([]);
  expect(problems).toEqual([]);
  expect(
    await page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations),
  ).toEqual([]);
  await app.close();
});

test('stays alive past the license window', async () => {
  test.skip(!hasTldrawKey(), 'needs TLDRAW_LICENSE_KEY (P5-R2)');
  const { app, page } = await launchApp();
  await startSession(page);
  await pinBoard(page);
  await expect(tldraw(page)).toBeVisible({ timeout: 5_000 });
  // Past tldraw's 5 s window: a key that doesn't cover app://tassel would blank the board now.
  await page.waitForTimeout(6_000);
  await expect(tldraw(page)).toBeVisible();
  await expect(page.getByTestId('tl-license-expired')).toHaveCount(0);
  await app.close();
});
