// Beats keep Ada's marks in time with her words (Task 8): marks-demo at its own pace, where each
// mark waits for the word it's anchored to. When things appear is recorded in the page by a
// MutationObserver, because polling from the test could notice the caption late.
import { expect, type Page, test } from '@playwright/test';
import { launchApp, settle, snap } from '../fixtures';

/** Starts a session through the new session sheet's defaults: a paper session on macOS. */
async function startSession(page: Page): Promise<void> {
  await expect(page.getByRole('region', { name: 'No sessions yet' })).toBeVisible();
  await page.getByRole('banner').getByRole('button', { name: 'New session' }).click();
  await page
    .getByRole('dialog', { name: 'New session' })
    .getByRole('button', { name: 'Start session' })
    .click();
  await expect(page.getByTestId('stage')).toBeVisible();
}

type Seen = Record<'caption' | 's1' | 'circle' | 'callout', number>;

/** Records, on the page's clock, when each of these first shows. */
async function recordAppearances(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: Record<string, number> = {};
    const shows: Record<string, () => boolean> = {
      caption: () =>
        document
          .querySelector('[data-testid="captions"]')
          ?.textContent?.includes('First a 1, which keeps you on q0') ?? false,
      s1: () => document.querySelector('[data-testid="mark-step-s1"]') !== null,
      circle: () => document.querySelector('[data-testid="mark-circle-circle"]') !== null,
      callout: () => document.querySelector('[data-testid="mark-callout-callout"]') !== null,
    };
    const check = () => {
      for (const [name, isShown] of Object.entries(shows)) {
        if (!(name in seen) && isShown()) seen[name] = performance.now();
      }
    };
    new MutationObserver(check).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    Object.assign(window, { __seen: seen });
  });
}

test('marks arrive with the words they are anchored to', async () => {
  // At its own pace, marks-demo runs about 15 s.
  test.setTimeout(60_000);
  const { app, page } = await launchApp({
    TASSEL_FAKE_SCRIPT: 'marks-demo',
    TASSEL_FAKE_SPEED: '1',
  });
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  await recordAppearances(page);
  await startSession(page);

  // The second line's caption, then its first step a moment later, on "which".
  const captions = page.getByTestId('captions');
  await expect(captions).toContainText('First a 1, which keeps you on q0', { timeout: 15_000 });
  await expect(page.getByTestId('mark-step-s1')).toBeVisible({ timeout: 2_000 });
  // Mid-line: the caption up, and only the step her words have reached.
  await snap(page, 'p5-beats-s1');
  await expect(page.getByTestId('mark-callout-callout')).toBeVisible({ timeout: 15_000 });

  const seen = (await page.evaluate(() => (window as unknown as { __seen: Seen }).__seen)) as Seen;
  // When the caption appears, step 1 isn't there yet: it waits for "which", 0.955 s into the
  // line, and comes within 2 s.
  expect(seen.s1 - seen.caption).toBeGreaterThanOrEqual(500);
  expect(seen.s1 - seen.caption).toBeLessThanOrEqual(2_000);
  // The callout comes only after the circle.
  expect(seen.callout).toBeGreaterThan(seen.circle);
  console.log(
    `[beats] step 1 came ${Math.round(seen.s1 - seen.caption)} ms after its caption; ` +
      `the callout ${Math.round(seen.callout - seen.circle)} ms after the circle`,
  );
  await settle(page);
  await snap(page, 'p5-beats-done');

  expect(problems).toEqual([]);
  await app.close();
});
