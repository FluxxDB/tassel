// Her paper on the fake clip (Task 13): launchApp plays the generated dfa-short clip as a camera,
// so a paper session goes live in the session screen, the change detector runs in its worker
// with OpenCV, and the clip's first stroke (at 11.5 s) uploads one ink frame. Screenshots show
// only the synthetic clip.
import { type ElectronApplication, expect, type Locator, type Page, test } from '@playwright/test';
import {
  frameImage,
  framesOf,
  latestSession,
  launchApp,
  settle,
  setWindowSize,
  snap,
  startPaperSession,
  watchPaperConsole,
} from './fixtures';

test.setTimeout(90_000);

// The tokens' live red and smoke, as computed colors.
const LIVE_RED = 'rgb(229, 72, 77)';
const SMOKE = 'rgb(122, 120, 118)';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (inner: Box, outer: Box) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("The element isn't on screen");
  return box;
}

/** The paper video's native size: [videoWidth, videoHeight]. */
const videoSize = (page: Page) =>
  page
    .getByTestId('paper-video')
    .evaluate((video: HTMLVideoElement) => [video.videoWidth, video.videoHeight]);

/** The title strip's source label (its text) and its dot. */
function sourceLabel(page: Page, text: RegExp) {
  const label = page.getByRole('banner').getByText(text);
  return { label, dot: label.locator('span[aria-hidden="true"]') };
}

async function close(app: ElectronApplication, problems: string[]): Promise<void> {
  await app.close();
  expect(problems).toEqual([]);
}

test('her paper goes live on the fake clip, uploads its first stroke, and follows the camera', async () => {
  const { app, page } = await launchApp({ TASSEL_PAPER_DEBUG: '1' });
  const problems = watchPaperConsole(page);
  await startPaperSession(page);

  // 1. Live within 10 s, at the clip's size.
  await expect.poll(() => videoSize(page), { timeout: 10_000 }).toEqual([960, 720]);
  const liveAt = Date.now();

  // 2. The dot is red beside "Desk View · Live"; the fake clip stands in for Desk View.
  const live = sourceLabel(page, /^Desk View · Live$/);
  await expect(live.label).toBeVisible();
  await expect(live.dot).toHaveCSS('background-color', LIVE_RED);
  const region = page.getByRole('region', { name: 'Your paper · Desk View' });
  await expect(region.getByTestId('paper-video')).toBeVisible();

  // 3. The clip's first stroke goes out: the debug pill counts it.
  await expect(region.getByText(/· 1 sent$/)).toBeVisible({ timeout: 25_000 });
  expect(Date.now() - liveAt).toBeLessThan(25_000);

  // 4. The server has it: an ink frame from the fake clip, cropped, with the page found by
  // OpenCV in the worker. A later frame may follow, since the clip loops at 20 s.
  const session = await latestSession(page);
  expect(session).toMatchObject({ source: 'paper' });
  const [first] = await framesOf(page, session.id);
  expect(first).toMatchObject({
    seq: 1,
    reason: 'ink',
    source: 'fake-clip',
    width: 960,
    height: 720,
    has_crop: true,
    page_found: true,
  });
  const jpeg = await frameImage(page, session.id, first?.id ?? '');
  expect([...jpeg.subarray(0, 2)]).toEqual([0xff, 0xd8]);

  // 5. With the heatmap on.
  await region.getByRole('button', { name: 'Heatmap' }).click();
  await expect(region.getByTestId('paper-heatmap')).toBeVisible();
  await settle(page);
  await snap(page, 'p3-paper-live-1440');

  // 6. The dock's Camera button turns it off, and on again.
  const camera = page.getByRole('group', { name: 'Session controls' }).getByRole('button', {
    name: 'Camera',
  });
  await camera.click();
  await expect(region.getByRole('status')).toContainText('Camera is off');
  const neutral = sourceLabel(page, /^Desk View$/);
  await expect(neutral.label).toBeVisible();
  await expect(neutral.dot).toHaveCSS('background-color', SMOKE);
  await camera.click();
  await expect.poll(() => videoSize(page), { timeout: 10_000 }).toEqual([960, 720]);
  await expect(live.dot).toHaveCSS('background-color', LIVE_RED);
  await close(app, problems);
});

test('her paper fits beside the board at 1024×680 in Spanish', async () => {
  const { app, page } = await launchApp({ TASSEL_UI_LANG: 'es' });
  const problems = watchPaperConsole(page);
  await startPaperSession(page, { uiLang: 'es', language: 'es' });
  await setWindowSize(app, page, 1024, 680);
  await expect.poll(() => videoSize(page), { timeout: 10_000 }).toEqual([960, 720]);
  // B twice pins split, as P1's layout spec does.
  await page.keyboard.press('b');
  await page.keyboard.press('b');
  const paper = page.getByRole('region', { name: 'Tu papel · Desk View' });
  const board = page.getByRole('region', { name: 'La pizarra de Ada' });
  await expect(paper).toBeVisible();
  await expect(board).toBeVisible();
  await settle(page);

  const panel = await boxOf(paper);
  const tile = await boxOf(page.getByTestId('tutor-tile'));
  const tag = await boxOf(paper.getByText('Tu papel · Desk View', { exact: true }));
  // The whole pill: its label, then Unpin.
  const pin = await boxOf(paper.getByText(/^Fijado · /).locator('..'));
  for (const box of [tag, pin]) {
    expect(inside(box, panel)).toBe(true);
    expect(intersects(box, tile)).toBe(false);
  }
  await snap(page, 'p3-paper-split-1024-es');
  await close(app, problems);
});
