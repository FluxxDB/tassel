// Ada's board in the running app (Task 5): the fake tutor's board-demo draws the reference DFA for
// "starts with 010" (CORRECT) a piece at a time from 2.7 s, pulses qd at 6 s, highlights it at
// 7.8 s and listens at 8.4 s (speed-1 times). Every spec first checks what the board store made,
// which needs no tldraw and holds past its license window (P5-R6, I10), then tldraw's drawing.
//
// tldraw's license: a production build on app://tassel blanks the board 5 s after tldraw mounts
// unless the build's key validates there, so in a build every check of tldraw's drawing runs
// inside that window. Set TASSEL_E2E_RENDERER_URL to Vite's dev server (`electron-vite dev
// --rendererOnly` in apps/desktop serves http://localhost:5173) to run the same specs on the dev
// path, `pnpm dev`'s, where tldraw needs no key, at the brief's speed 1 throughout.
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { layoutWithViz } from '../../../src/renderer/src/board/layout/viz';
import { CORRECT } from '../../unit/board/fixtures';
import { launchApp, settle, setWindowSize, snap } from '../fixtures';
import { hasTldrawKey } from './tldraw-key';

const DEV_RENDERER = process.env.TASSEL_E2E_RENDERER_URL;

/** tldraw's license ping, answered here so no spec needs the network (Task 4). */
const LICENSE_PING = 'https://cdn.tldraw.com/5.5.2/watermarks/watermark-track.svg';

/** Whether tldraw's drawing can be checked: on the dev path always, in a build with a key. */
const NO_TLDRAW = 'needs TLDRAW_LICENSE_KEY (P5-R2), or TASSEL_E2E_RENDERER_URL';
const seesTldraw = () => DEV_RENDERER !== undefined || hasTldrawKey();

/** Everything Ada draws, as the board's description list reads it once she's done. */
const WHOLE_BOARD = [
  'States: q0, q1, q2, q3, qd',
  'Start: q0',
  'Accepting: q3',
  'q0 to q1 on 0',
  'q1 to q2 on 1',
  'q2 to q3 on 0',
  'q3 to q3 on 0, 1',
  'q0 to qd on 1',
  'q1 to qd on 0',
  'q2 to qd on 1',
  'qd to qd on 0, 1',
];

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The app with the board demo, on Vite's dev server when TASSEL_E2E_RENDERER_URL says so. */
async function launchDemo(
  env: Record<string, string> = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  const launched = await launchApp({
    TASSEL_FAKE_SCRIPT: 'board-demo',
    ...(DEV_RENDERER && { ELECTRON_RENDERER_URL: DEV_RENDERER }),
    ...env,
  });
  await launched.app.context().route(
    (url) => url.href.startsWith(LICENSE_PING),
    (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg/>' }),
  );
  return launched;
}

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

/**
 * The board's description list, read from the DOM: it's the store's account of the board, and
 * holds while the board is hidden and past tldraw's license window (P5-R6, I10).
 */
const described = (page: Page) =>
  page
    .locator('[data-testid="board-canvas"] ul[aria-label="What\'s on Ada\'s board"] li')
    .allTextContents();

/** Collects console errors and warnings, and uncaught errors. */
function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  return problems;
}

const boardRegion = (page: Page) => page.getByRole('region', { name: "Ada's board" });
const shapes = (page: Page, type: string) =>
  page.locator(`[data-testid="board-canvas"] .tl-shape[data-shape-type="${type}"]`);
const shapeOf = (page: Page, el: string) =>
  page.locator(`[data-testid="board-canvas"] .tl-shape[data-shape-id="shape:ada.fix.${el}"]`);
/** How the camera fitted, as the engine says on tldraw's container (P5-R9). */
const fitOf = (page: Page) =>
  page.locator('[data-testid="board-canvas"] [data-fit]').getAttribute('data-fit');

async function centerOf(locator: ReturnType<Page['locator']>): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not on screen');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Whether every state's box lies inside the board region. */
async function statesInsideBoard(page: Page): Promise<boolean> {
  const board = await boardRegion(page).boundingBox();
  if (!board) return false;
  const boxes = await shapes(page, 'tassel-state').evaluateAll((els) =>
    els.map((el) => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
  return (
    boxes.length === 5 &&
    boxes.every(
      (box) =>
        box.x >= board.x &&
        box.y >= board.y &&
        box.x + box.width <= board.x + board.width &&
        box.y + box.height <= board.y + board.height,
    )
  );
}

/**
 * What of Ada's drawing lies under her tile, the board's TopLine (54 px) or the captions: each
 * state's circle, and each arrow's drawn path and label, by what covers it.
 */
async function obstructed(page: Page): Promise<string[]> {
  const covers: Record<string, Box | null> = {
    tile: await page.getByTestId('tutor-tile').boundingBox(),
    captions: await page.getByTestId('captions').boundingBox(),
    topLine: await boardRegion(page)
      .boundingBox()
      .then((board) => board && { ...board, height: 54 }),
  };
  const drawn = await page.evaluate(() => {
    const boxOf = (el: Element) => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return { x, y, width, height };
    };
    const ada = document.querySelectorAll(
      '[data-testid="board-canvas"] .tl-shape[data-shape-id^="shape:ada."]',
    );
    return [...ada].flatMap((shape) => {
      const name = (shape.getAttribute('data-shape-id') ?? '').replace('shape:ada.fix.', '');
      const parts =
        shape.getAttribute('data-shape-type') === 'arrow'
          ? [...shape.querySelectorAll('path, .tl-rich-text')]
          : [shape];
      return parts.map((part) => ({ name, box: boxOf(part) }));
    });
  });
  const hits = (a: Box, b: Box) =>
    a.width > 0 &&
    a.height > 0 &&
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height;
  const found = new Set<string>();
  for (const { name, box } of drawn) {
    for (const [cover, area] of Object.entries(covers)) {
      if (area && hits(box, area)) found.add(`${name} under ${cover}`);
    }
  }
  return [...found].sort();
}

/** Which side of the chord a → b the point p is on: positive to the left, on the y-down screen. */
function side(
  a: { x: number; y: number },
  b: { x: number; y: number },
  p: { x: number; y: number },
) {
  return Math.sign((b.x - a.x) * (a.y - p.y) - (b.y - a.y) * (a.x - p.x));
}

test("draws the reference DFA beside her paper, Graphviz's way, clear of her tile", async () => {
  const { app, page } = await launchDemo();
  const problems = watchProblems(page);
  await startSession(page);

  // The store's account first, which needs no tldraw (I10): the whole DFA, laid out by Graphviz
  // in its worker under the real CSP.
  await expect.poll(() => described(page), { timeout: 10_000 }).toEqual(WHOLE_BOARD);
  await expect(page.getByTestId('board-canvas')).toHaveAttribute('data-layout', 'graphviz');
  // Ada's first showing action split the stage: the board is beside the paper.
  await expect(page.getByRole('region', { name: 'Your paper · Desk View' })).toBeVisible();
  await expect(boardRegion(page)).toBeVisible();
  expect(problems).toEqual([]);

  test.skip(!seesTldraw(), NO_TLDRAW);

  // Five states labelled q0…qd, only q3 accepting, all fully shown; and nine arrows.
  const states = shapes(page, 'tassel-state');
  await expect(states).toHaveCount(5);
  await settle(page);
  expect(await states.locator('text').allTextContents()).toEqual(['q0', 'q1', 'q2', 'q3', 'qd']);
  expect(
    await states
      .locator('[data-accept]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-accept'))),
  ).toEqual(['false', 'false', 'false', 'true', 'false']);
  expect(await states.evaluateAll((els) => els.map((el) => getComputedStyle(el).opacity))).toEqual([
    '1',
    '1',
    '1',
    '1',
    '1',
  ]);
  await expect(shapes(page, 'arrow')).toHaveCount(9);
  await expect(shapeOf(page, 'state:qd').locator('[data-ring]')).toHaveAttribute(
    'data-ring',
    'highlight',
  );
  await expect(shapeOf(page, 'state:q3').locator('[role="img"]')).toHaveAttribute(
    'aria-label',
    'q3, accepting',
  );

  // q3's loop is drawn above q3, where its label is.
  const q3 = await centerOf(shapeOf(page, 'state:q3'));
  const loopLabel = await centerOf(shapeOf(page, 'edge:q3>q3').locator('.tl-rich-text'));
  expect(loopLabel.y).toBeLessThan(q3.y);
  // The 1 of q0→qd sits on the side of the chord Graphviz put it (the bend's sign, P5-R2).
  const layout = await layoutWithViz(CORRECT);
  const expected = side(layout.states.q0, layout.states.qd, layout.edges['q0>qd'].label);
  const q0 = await centerOf(shapeOf(page, 'state:q0'));
  const qd = await centerOf(shapeOf(page, 'state:qd'));
  const label = await centerOf(shapeOf(page, 'edge:q0>qd').locator('.tl-rich-text'));
  expect(expected).not.toBe(0);
  expect(side(q0, qd, label)).toBe(expected);

  // P5-R9 at 1440 split, with two caption lines up: all of it clear of her tile, the TopLine and
  // the captions.
  await expect.poll(() => fitOf(page)).toBe('clear');
  await expect.poll(() => statesInsideBoard(page)).toBe(true);
  await expect(page.getByTestId('captions')).toContainText("Here's one. We start at q0.");
  await settle(page);
  await expect.poll(() => obstructed(page)).toEqual([]);
  await snap(page, 'p5-board-demo-1440');

  // At 1024 split, clear of everything it would be at 0.54, labels at 8 px: it gives up the
  // captions band first (P5-R9), and refits once the panel settles.
  await setWindowSize(app, page, 1024, 680);
  await expect.poll(() => fitOf(page)).toBe('no-captions');
  await expect.poll(() => statesInsideBoard(page)).toBe(true);
  await settle(page);
  // Once the camera has stopped: only the captions band covers any of it.
  await expect
    .poll(async () => (await obstructed(page)).filter((what) => !what.endsWith('under captions')))
    .toEqual([]);
  const covered = await obstructed(page);
  test.info().annotations.push({
    type: 'under the captions at 1024 split',
    description: covered.join('; '),
  });
  await snap(page, 'p5-board-demo-1024');
  expect(problems).toEqual([]);
  await app.close();
});

test('draws only what Ada has revealed, and fades each piece in (I2)', async () => {
  const { app, page } = await launchDemo({ TASSEL_FAKE_SPEED: '1' });
  const problems = watchProblems(page);
  await startSession(page);

  // Every 50 ms: the states the description lists, and the ones tldraw draws.
  await page.evaluate(() => {
    const sampled = window as unknown as {
      samples: Array<{ described: string[]; drawn: string[] }>;
      sampler: number;
    };
    sampled.samples = [];
    sampled.sampler = window.setInterval(() => {
      const board = document.querySelector('[data-testid="board-canvas"]');
      const line = [...(board?.querySelectorAll('ul li') ?? [])]
        .map((li) => li.textContent ?? '')
        .find((text) => text.startsWith('States: '));
      const states = board?.querySelectorAll('.tl-shape[data-shape-type="tassel-state"] text');
      sampled.samples.push({
        described: line ? line.slice('States: '.length).split(', ') : [],
        drawn: [...(states ?? [])].map((text) => text.textContent ?? ''),
      });
    }, 50);
  });
  // qd appears at 6 s, with its pulse: still inside a build's license window.
  await expect
    .poll(() => described(page), { timeout: 10_000 })
    .toContain('States: q0, q1, q2, q3, qd');
  const samples = await page.evaluate(() => {
    const sampled = window as unknown as {
      samples: Array<{ described: string[]; drawn: string[] }>;
      sampler: number;
    };
    window.clearInterval(sampled.sampler);
    return sampled.samples;
  });
  // The store revealed her states one piece at a time.
  const steps = [...new Set(samples.map((sample) => sample.described.join(',')))];
  expect(steps).toEqual(['', 'q0', 'q0,q1', 'q0,q1,q2', 'q0,q1,q2,q3', 'q0,q1,q2,q3,qd']);
  expect(problems).toEqual([]);

  test.skip(!seesTldraw(), NO_TLDRAW);

  await snap(page, 'p5-board-demo-pulse');
  // tldraw never draws a state before Ada reveals it (it may lag her by a frame), and drew the
  // first ones while the rest were still hidden.
  for (const { described: listed, drawn } of samples) {
    expect(
      drawn.every((state) => listed.includes(state)),
      `${drawn} of ${listed}`,
    ).toBe(true);
  }
  expect(samples.some(({ drawn }) => drawn.join(',') === 'q0,q1')).toBe(true);
  await expect(shapes(page, 'tassel-state')).toHaveCount(5);
  // Each fades in as tldraw mounts it, over MOTION.revealMs.
  expect(
    await page
      .locator('[data-testid="board-canvas"] .tl-shape[data-shape-id^="shape:ada."]')
      .evaluateAll((els) => [
        ...new Set(
          els.map(
            (el) =>
              `${getComputedStyle(el).animationName} ${getComputedStyle(el).animationDuration}`,
          ),
        ),
      ]),
  ).toEqual(['ada-reveal 0.18s']);
  expect(problems).toEqual([]);
  await app.close();
});

test('keeps her pinned paper, and shows the finished board when she unpins (Review Focus 1)', async () => {
  // B goes in before Ada draws, at 2.7 s at speed 1. A build's board blanks 5 s after tldraw
  // mounts unless its key validates on app://tassel, so a build runs the script three times as
  // fast, to unpin inside that window; the dev path runs at the brief's speed 1.
  const { app, page } = await launchDemo({ TASSEL_FAKE_SPEED: DEV_RENDERER ? '1' : '3' });
  const problems = watchProblems(page);
  await startSession(page);
  await page.keyboard.press('b');
  await expect(page.getByRole('button', { name: 'Board: Paper, pinned' })).toBeVisible();

  // She draws it all while the board is hidden; the pin holds, and Ada asks.
  await expect.poll(() => described(page), { timeout: 15_000 }).toEqual(WHOLE_BOARD);
  await expect(page.getByTestId('board-canvas')).toHaveAttribute('data-layout', 'graphviz');
  await expect(page.getByText('Ada asks: Paper and board')).toBeVisible();
  await expect(boardRegion(page)).toHaveCount(0);
  expect(problems).toEqual([]);

  test.skip(!seesTldraw(), NO_TLDRAW);

  await page.getByRole('button', { name: 'Unpin' }).click();
  await expect(boardRegion(page)).toBeVisible();
  // The camera fits her drawing once the panel has grown, clear of her tile.
  await expect.poll(() => statesInsideBoard(page)).toBe(true);
  await expect.poll(() => fitOf(page)).toBe('clear');
  await settle(page);
  // Polled: tldraw animates the camera over MOTION.cameraMs, past what settle() waits for.
  await expect
    .poll(async () => (await obstructed(page)).filter((what) => what.endsWith('under tile')))
    .toEqual([]);
  await snap(page, 'p5-board-demo-unpinned');
  expect(problems).toEqual([]);
  await app.close();
});

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`student camera controls keep Ada's shapes read-only (${reducedMotion})`, async () => {
    test.skip(!seesTldraw(), NO_TLDRAW);
    const { app, page } = await launchDemo();
    try {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await startSession(page);
      await expect.poll(() => described(page), { timeout: 10_000 }).toEqual(WHOLE_BOARD);
      const controls = page.getByRole('group', { name: 'Board camera controls' });
      const fit = controls.getByRole('button', { name: 'Fit', exact: true });
      await fit.click();
      await settle(page);
      const state = shapeOf(page, 'state:q0');
      const original = await state.boundingBox();
      expect(original).not.toBeNull();
      if (!original) return;
      await page.emulateMedia({ reducedMotion });
      const restoreFit = async () => {
        await fit.click();
        await expect
          .poll(async () => {
            const box = await state.boundingBox();
            return box
              ? Math.max(
                  Math.abs(box.x - original.x),
                  Math.abs(box.y - original.y),
                  Math.abs(box.width - original.width),
                )
              : Infinity;
          })
          .toBeLessThan(0.1);
      };
      await controls.getByRole('button', { name: 'Zoom in' }).click();
      await expect
        .poll(async () => (await state.boundingBox())?.width ?? 0)
        .toBeGreaterThan(original.width);
      await controls.getByRole('button', { name: 'Zoom out' }).click();
      await restoreFit();

      const panel = await boardRegion(page).boundingBox();
      if (!panel) throw new Error('Board panel missing');
      await page.mouse.move(panel.x + 40, panel.y + 250);
      await page.mouse.down();
      await page.mouse.move(panel.x + 140, panel.y + 290, { steps: 8 });
      await page.mouse.up();
      await settle(page);
      expect((await state.boundingBox())?.x).not.toBeCloseTo(original.x, 0);
      await restoreFit();
      await expect.poll(async () => (await state.boundingBox())?.x ?? 0).toBeCloseTo(original.x, 0);

      for (const modifier of ['Meta', 'Control'] as const) {
        await page.mouse.move(panel.x + 150, panel.y + 250);
        await page.keyboard.down(modifier);
        await page.mouse.wheel(0, -180);
        await page.keyboard.up(modifier);
        await expect
          .poll(async () => (await state.boundingBox())?.width ?? 0)
          .toBeGreaterThan(original.width);
        await restoreFit();
      }
      await state.click();
      await page.keyboard.press('Delete');
      await expect(shapes(page, 'tassel-state')).toHaveCount(5);
      expect(await described(page)).toEqual(WHOLE_BOARD);
    } finally {
      await app.close();
    }
  });
}
