// The student's image on the stage: the fake tutor's image-demo shows a synthetic photo of her
// working (drawn on a canvas, never a camera frame) in the paper panel's slot and marks it up
// as her paper: a step, a washed circle, a callout, an arrow, an underline and a check. The
// marks must sit on the image's own ink at 1440×900 and at 1024×680, clear of the top line
// and Ada's tile, and Back to paper brings her paper back.
import { expect, type Page, test } from '@playwright/test';
import { FIXTURE_IMAGE } from '../../../src/renderer/src/board/marks/fixture-image';
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

/** The element's box on screen; a flat line (an underline) has one, 0 px tall. */
async function boxOf(page: Page, selector: string): Promise<Box> {
  const locator = page.locator(selector).first();
  await expect(locator).toBeAttached();
  return locator.evaluate((el) => {
    const { x, y, width, height } = el.getBoundingClientRect();
    return { x, y, width, height };
  });
}

const markOf = (page: Page, testId: string) => boxOf(page, `[data-testid="${testId}"]`);

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

/** Where a detected box of the image lands on screen, through the image's fit. */
async function inkOf(page: Page, id: string): Promise<Box> {
  const item = FIXTURE_IMAGE.detected.items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`the fixture image has no ${id}`);
  const image = await markOf(page, 'stage-image');
  const scale = image.width / FIXTURE_IMAGE.w;
  return {
    x: image.x + item.box.x * scale,
    y: image.y + item.box.y * scale,
    width: item.box.w * scale,
    height: item.box.h * scale,
  };
}

/** The circle mark's box holds the second line's ink, and the underline runs under the last. */
async function expectMarksOnTheInk(page: Page): Promise<void> {
  const ring = await markOf(page, 'mark-circle-circle');
  const line2 = await inkOf(page, 'm2');
  expect(ring.x).toBeLessThanOrEqual(line2.x);
  expect(ring.y).toBeLessThanOrEqual(line2.y);
  expect(ring.x + ring.width).toBeGreaterThanOrEqual(line2.x + line2.width);
  expect(ring.y + ring.height).toBeGreaterThanOrEqual(line2.y + line2.height);
  const underline = await markOf(page, 'mark-underline-underline');
  const line4 = await inkOf(page, 'm3');
  expect(underline.y).toBeGreaterThanOrEqual(line4.y + line4.height - 1);
  expect(underline.x).toBeLessThanOrEqual(line4.x + 1);
  expect(underline.x + underline.width).toBeGreaterThanOrEqual(line4.x + line4.width - 1);
  // The step dot is beside the first line, on the image.
  const dot = await markOf(page, 'mark-step-s1');
  const image = await markOf(page, 'stage-image');
  expect(overlaps(dot, image)).toBe(true);
}

/** The top line's pills and the marks stay clear of Ada's tile; the callout clears the top line. */
async function expectNothingCovered(page: Page): Promise<void> {
  const tile = await markOf(page, 'tutor-tile');
  // The tile keeps clear of the top line's controls, the pills, not of its full-width row.
  const pills = page.getByRole('region', { name: 'Your image' }).locator('[data-top-line] > *');
  const count = await pills.count();
  expect(count).toBeGreaterThanOrEqual(2);
  for (let i = 0; i < count; i += 1) {
    const pill = await pills.nth(i).evaluate((el) => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return { x, y, width, height };
    });
    if (pill.width === 0 || pill.height === 0) continue;
    expect(overlaps(tile, pill), `pill ${i} under Ada's tile`).toBe(false);
  }
  for (const id of ['image-tag', 'mark-callout-callout', 'mark-circle-circle', 'mark-step-s1']) {
    expect(overlaps(tile, await markOf(page, id)), `${id} under Ada's tile`).toBe(false);
  }
  const topLine = await boxOf(page, '[data-top-line]');
  const callout = await markOf(page, 'mark-callout-callout');
  expect(callout.y).toBeGreaterThanOrEqual(topLine.y + topLine.height);
}

test("Ada shows the student's image and marks it up", async () => {
  const { app, page } = await launchApp({ TASSEL_FAKE_SCRIPT: 'image-demo' });
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  await startSession(page);

  // 1. Her image takes the paper panel, tagged as hers, with Back to paper.
  const image = page.getByTestId('stage-image');
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBe(FIXTURE_IMAGE.w);
  const panel = page.getByRole('region', { name: 'Your image' });
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-top-line]')).toContainText('Your image');
  await expect(page.getByRole('button', { name: 'Back to paper' })).toBeVisible();
  await expect(page.getByTestId('snapshot-tag')).toHaveCount(0);

  // 2. Every mark lands, on the image's ink.
  await expect(page.getByTestId('mark-step-s1')).toHaveText('1');
  await expect(page.getByTestId('mark-callout-callout')).toHaveText(
    'x = 4 checks out: 2 × 4 + 3 = 11',
  );
  for (const id of ['circle', 'arrow', 'check']) {
    await expect(page.getByTestId(`mark-${id}-${id}`)).toBeVisible();
  }
  // A flat line has no height for Playwright's "visible": its box is checked below.
  await expect(page.getByTestId('mark-underline-underline')).toBeAttached();
  await settle(page);
  await expectMarksOnTheInk(page);
  await expectNothingCovered(page);
  await snap(page, 'chat-image-stage-1440');

  // 3. A smaller window refits the image, and the marks stay on its ink.
  await setWindowSize(app, page, 1024, 680);
  await settle(page);
  await expectMarksOnTheInk(page);
  await expectNothingCovered(page);
  await snap(page, 'chat-image-stage-1024');

  // Beside the board (B pins Paper, then Split), after the stage's reflow: still on the ink.
  await page.keyboard.press('b');
  await page.keyboard.press('b');
  await expect(page.getByRole('region', { name: "Ada's board" })).toBeVisible();
  await settle(page);
  await expectMarksOnTheInk(page);
  await expectNothingCovered(page);
  await snap(page, 'chat-image-stage-1024-split');

  // 4. Back to paper brings her paper back, and the image's pill goes with it.
  await page.getByRole('button', { name: 'Back to paper' }).click();
  await expect(image).toHaveCount(0);
  await expect(page.getByTestId('image-tag')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Your paper · Desk View' })).toBeVisible();
  await snap(page, 'chat-image-stage-back-to-paper');

  expect(problems).toEqual([]);
  await app.close();
});
