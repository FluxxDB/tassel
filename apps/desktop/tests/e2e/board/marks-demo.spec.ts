// Ada steps through her paper (Task 7): the fake tutor's marks-demo freezes the fixture page and
// numbers 1010's path on it, circles q0's loop and explains it in a callout. The marks must sit on
// the page's own ink, at 1440×900 and at 1024×680, alone and beside the board (Review Focus 3).
import { expect, type Page, test } from '@playwright/test';
import { launchApp, settle, setWindowSize, snap } from '../fixtures';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

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

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} isn't on screen`);
  return box;
}

const inkOf = (page: Page, ref: string) => boxOf(page, `[data-ink="${ref}"]`);
const markOf = (page: Page, testId: string) => boxOf(page, `[data-testid="${testId}"]`);

/** Dot 2 sits between q0 and q1, below the q0→q1 edge's ink. */
async function expectStep2OnItsEdge(page: Page): Promise<void> {
  const dot = await markOf(page, 'mark-step-s2');
  const center = { x: dot.x + dot.width / 2, y: dot.y + dot.height / 2 };
  const q0 = await inkOf(page, 'state:q0');
  const q1 = await inkOf(page, 'state:q1');
  const edge = await inkOf(page, 'edge:q0>q1');
  expect(center.x).toBeGreaterThan(q0.x + q0.width);
  expect(center.x).toBeLessThan(q1.x);
  expect(center.y).toBeGreaterThan(edge.y + edge.height);
}

/** The circle mark's box holds the q0 loop's ink. */
async function expectCircleAroundLoop(page: Page): Promise<void> {
  const ring = await markOf(page, 'mark-circle-circle');
  const loop = await inkOf(page, 'edge:q0>q0');
  expect(ring.x).toBeLessThanOrEqual(loop.x);
  expect(ring.y).toBeLessThanOrEqual(loop.y);
  expect(ring.x + ring.width).toBeGreaterThanOrEqual(loop.x + loop.width);
  expect(ring.y + ring.height).toBeGreaterThanOrEqual(loop.y + loop.height);
}

test('Ada steps through her paper', async () => {
  const { app, page } = await launchApp({ TASSEL_FAKE_SCRIPT: 'marks-demo' });
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  await startSession(page);

  // 1. The snapshot covers her paper, tagged with the session timer's time (M1).
  const snapshot = page.getByTestId('paper-snapshot');
  await expect(snapshot).toBeVisible();
  await expect(page.getByTestId('snapshot-time')).toHaveText(/^Snapshot \d\d:\d\d$/);
  await expect(page.getByTestId('snapshot-time')).toHaveText(/^Snapshot 00:0\d$/);

  // 2. Every mark lands, on her ink.
  await expect(page.getByTestId('mark-callout-callout')).toHaveText(
    'A leading 1 loops here, so 1010 gets in',
  );
  for (const n of [1, 2, 3, 4]) {
    await expect(page.getByTestId(`mark-step-s${n}`)).toHaveText(String(n));
  }
  await settle(page);
  await expectStep2OnItsEdge(page);
  await expectCircleAroundLoop(page);
  await snap(page, 'p5-marks-1440');

  // 3. A smaller window refits the page, and the marks stay on her ink.
  await setWindowSize(app, page, 1024, 680);
  await settle(page);
  await expectStep2OnItsEdge(page);
  await expectCircleAroundLoop(page);
  await snap(page, 'p5-marks-1024');

  // The board coming in beside the paper (B pins Paper, then Split) reflows the stage over
  // 240 ms; once it's done, the marks are still on her ink.
  await page.keyboard.press('b');
  await page.keyboard.press('b');
  await expect(page.getByRole('region', { name: "Ada's board" })).toBeVisible();
  await settle(page);
  await expectStep2OnItsEdge(page);
  await expectCircleAroundLoop(page);
  await snap(page, 'p5-marks-1024-split');

  // 4. Back to live takes the snapshot away.
  await page.getByRole('button', { name: 'Back to live' }).click();
  await expect(snapshot).toHaveCount(0);
  await expect(page.getByTestId('snapshot-tag')).toHaveCount(0);

  expect(problems).toEqual([]);
  await app.close();
});
