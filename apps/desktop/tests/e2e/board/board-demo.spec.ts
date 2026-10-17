import { type ElectronApplication, expect, type Locator, type Page, test } from '@playwright/test';
import { layoutWithViz } from '../../../src/renderer/src/board/layout/viz';
import { CORRECT } from '../../unit/board/fixtures';
import { launchApp, settle, setWindowSize, snap } from '../fixtures';
import { hasTldrawKey } from './tldraw-key';

// The fake tutor's board-demo: Ada draws the reference DFA for "starts with 010" (CORRECT) a
// piece at a time from 2.7 s, pulses qd at 6 s, highlights it at 7.8 s, and listens at 8.4 s.
const DEMO = { TASSEL_FAKE_SCRIPT: 'board-demo' };

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

const shapes = (page: Page, type: string) =>
  page.locator(`[data-testid="board-canvas"] .tl-shape[data-shape-type="${type}"]`);
const shapeOf = (page: Page, el: string) =>
  page.locator(`[data-testid="board-canvas"] .tl-shape[data-shape-id="shape:ada.fix.${el}"]`);

async function centerOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not on screen');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Whether every state's box lies inside the board region. */
async function statesInsideBoard(page: Page): Promise<boolean> {
  const board = await page.getByRole('region', { name: "Ada's board" }).boundingBox();
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

/** Which side of the chord a → b the point p is on: positive to the left, on the y-down screen. */
function side(
  a: { x: number; y: number },
  b: { x: number; y: number },
  p: { x: number; y: number },
) {
  return Math.sign((b.x - a.x) * (a.y - p.y) - (b.y - a.y) * (a.x - p.x));
}

async function closeApp(app: ElectronApplication): Promise<void> {
  await app.close();
}

test("draws the reference DFA beside her paper, Graphviz's way", async () => {
  const { app, page } = await launchApp(DEMO);
  const problems = watchProblems(page);
  await startSession(page);

  // The store's account first, which needs no tldraw (I10): the whole DFA, laid out by Graphviz
  // in its worker under the real CSP.
  await expect.poll(() => described(page), { timeout: 10_000 }).toEqual(WHOLE_BOARD);
  await expect(page.getByTestId('board-canvas')).toHaveAttribute('data-layout', 'graphviz');
  // Ada's first showing action split the stage: the board is beside the paper.
  await expect(page.getByRole('region', { name: 'Your paper · Desk View' })).toBeVisible();
  await expect(page.getByRole('region', { name: "Ada's board" })).toBeVisible();
  expect(problems).toEqual([]);

  test.skip(!hasTldrawKey(), 'needs TLDRAW_LICENSE_KEY (P5-R2)');

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

  await expect.poll(() => statesInsideBoard(page)).toBe(true);
  await snap(page, 'p5-board-demo-1440');

  await setWindowSize(app, page, 1024, 680);
  // The panel's resize refits the camera, 120 ms after it settles.
  await expect.poll(() => statesInsideBoard(page)).toBe(true);
  await settle(page);
  await snap(page, 'p5-board-demo-1024');
  expect(problems).toEqual([]);
  await closeApp(app);
});

test('keeps her pinned paper, and shows the finished board when she unpins (Review Focus 1)', async () => {
  const { app, page } = await launchApp({ ...DEMO, TASSEL_FAKE_SPEED: '1' });
  const problems = watchProblems(page);
  await startSession(page);
  // Paper pinned before Ada draws at 2.7 s.
  await page.keyboard.press('b');
  await expect(page.getByRole('button', { name: 'Board: Paper, pinned' })).toBeVisible();

  // She draws it all while the board is hidden; the pin holds, and Ada asks.
  await expect.poll(() => described(page), { timeout: 15_000 }).toEqual(WHOLE_BOARD);
  await expect(page.getByTestId('board-canvas')).toHaveAttribute('data-layout', 'graphviz');
  await expect(page.getByText('Ada asks: Paper and board')).toBeVisible();
  await expect(page.getByRole('region', { name: "Ada's board" })).toHaveCount(0);
  expect(problems).toEqual([]);

  test.skip(!hasTldrawKey(), 'needs TLDRAW_LICENSE_KEY (P5-R2)');

  await page.getByRole('button', { name: 'Unpin' }).click();
  await expect(page.getByRole('region', { name: "Ada's board" })).toBeVisible();
  // The camera fits her drawing once the panel has grown.
  await expect.poll(() => statesInsideBoard(page)).toBe(true);
  expect(problems).toEqual([]);
  await closeApp(app);
});
