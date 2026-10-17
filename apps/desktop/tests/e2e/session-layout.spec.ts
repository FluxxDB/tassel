import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { E2E_SERVER_URL, launchApp as launch, settle, setWindowSize, snap } from './fixtures';

// The fake tutor at its own pace: within these few seconds Ada only connects and listens, so
// her split request (27.6 s) never moves the stage under a measurement.
const launchApp = (env: Record<string, string> = {}) => launch({ TASSEL_FAKE_SPEED: '1', ...env });

// 70 characters of Spanish: too long for the title strip at 1024.
const LONG_SPANISH_TITLE = 'Demostración por inducción de la fórmula para la suma de los n impares';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function boxOf(page: Page, testId: string): Promise<Box> {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`${testId} isn't on screen`);
  return box;
}

/** Creates a session for the app's learner through the API, then opens it from the library. */
async function openSession(
  page: Page,
  create = { type: 'homework', language: 'en', source: 'paper' },
  patch?: { title: string; subject: string },
): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const token = await page.evaluate(() => window.tassel.getToken());
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const created = await fetch(`${E2E_SERVER_URL}/v1/sessions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(create),
  });
  const { id } = (await created.json()) as { id: string };
  if (patch) {
    await fetch(`${E2E_SERVER_URL}/v1/sessions/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(patch),
    });
  }
  await page.reload();
  await page.getByRole('list').getByRole('button').first().click();
  await expect(page.getByTestId('stage')).toBeVisible();
}

async function closeApp(app: ElectronApplication): Promise<void> {
  await app.close();
}

test('lays out the stage at 1440×900', async () => {
  const { app, page } = await launchApp();
  await openSession(page, undefined, {
    title: 'Strings that start with 010',
    subject: 'Automata · DFA',
  });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Strings that start with 010');
  await expect(page.getByRole('timer')).toHaveText(/^00:0\d$/);

  // The stage is inset 60 / 16 / 104 from the window; her paper fills it.
  expect(await boxOf(page, 'stage')).toEqual({ x: 16, y: 60, width: 1408, height: 736 });
  // Ada's tile: 212×176, 14px in from the stage's top right.
  expect(await boxOf(page, 'tutor-tile')).toEqual({ x: 1198, y: 74, width: 212, height: 176 });
  // The dock sits 22px from the bottom, centered; the captions 118px from the bottom.
  const dock = await boxOf(page, 'dock');
  expect(dock.y + dock.height).toBe(878);
  expect(Math.round(dock.x + dock.width / 2)).toBe(720);
  const captions = await boxOf(page, 'captions');
  expect(Math.round(captions.y + captions.height)).toBe(782);
  expect(captions.width).toBe(880);

  await settle(page);
  await snap(page, 'p1-session-1440');

  // B pins split: paper left and board right at exactly 1:1, 12px apart.
  await page.keyboard.press('b');
  await page.keyboard.press('b');
  await expect(page.getByRole('region', { name: "Ada's board" })).toBeVisible();
  await settle(page);
  const paper = await page.getByRole('region', { name: 'Your paper · Desk View' }).boundingBox();
  const board = await page.getByRole('region', { name: "Ada's board" }).boundingBox();
  expect(paper).toMatchObject({ x: 16, width: 698 });
  expect(board).toMatchObject({ x: 726, width: 698 });
  await snap(page, 'p1-session-split-1440');
  await closeApp(app);
});

test("keeps the dock, captions and Ada's tile apart at 1024×680", async () => {
  const { app, page } = await launchApp();
  await openSession(page);
  await setWindowSize(app, page, 1024, 680);
  // The split view is the busiest: two panels, the tile, the captions and the dock.
  await page.keyboard.press('b');
  await page.keyboard.press('b');
  await settle(page);

  const dock = await boxOf(page, 'dock');
  const captions = await boxOf(page, 'captions');
  const tile = await boxOf(page, 'tutor-tile');
  expect(intersects(dock, captions)).toBe(false);
  expect(intersects(dock, tile)).toBe(false);
  expect(intersects(captions, tile)).toBe(false);
  // The session screen never scrolls.
  expect(
    await page.evaluate(() => [
      document.documentElement.scrollHeight <= window.innerHeight,
      document.documentElement.scrollWidth <= window.innerWidth,
    ]),
  ).toEqual([true, true]);
  await snap(page, 'p1-session-1024');
  await closeApp(app);
});

for (const lang of ['ko', 'es'] as const) {
  test(`ellipsizes a long Spanish title on one line in a ${lang} UI`, async () => {
    const { app, page } = await launchApp({ TASSEL_UI_LANG: lang });
    await openSession(
      page,
      { type: 'studying', language: 'es', source: 'paper' },
      // The longest subject the server takes: 40 characters.
      { title: LONG_SPANISH_TITLE, subject: 'Matemáticas discretas y teoría de grafos' },
    );
    await setWindowSize(app, page, 1024, 680);
    const title = page.getByRole('heading', { level: 1 });
    await expect(title).toHaveText(LONG_SPANISH_TITLE);
    expect(LONG_SPANISH_TITLE).toHaveLength(70);
    expect(await title.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await expect(title).toHaveCSS('text-overflow', 'ellipsis');
    await expect(title).toHaveCSS('white-space', 'nowrap');
    // The subject chip stops at 200px and ellipsizes, leaving the title its room.
    const subject = page.getByRole('banner').getByText('Matemáticas discretas y teoría de grafos');
    expect((await subject.boundingBox())?.width).toBeLessThanOrEqual(200);
    await expect(subject).toHaveCSS('text-overflow', 'ellipsis');
    await settle(page);
    if (lang === 'ko') await snap(page, 'p1-session-ko');
    await closeApp(app);
  });
}

/**
 * Presses B in the page and samples the paper panel's width on every frame for 400 ms, so the
 * samples start with the change itself.
 */
async function sampleReflow(page: Page): Promise<number[]> {
  return page.evaluate(async () => {
    const paper = document.querySelector('[data-testid="stage"] > section');
    if (!paper) throw new Error('no paper panel');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }));
    const widths: number[] = [];
    const start = performance.now();
    while (performance.now() - start < 400) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      widths.push(Math.round(paper.getBoundingClientRect().width));
    }
    return widths;
  });
}

test('reflows the stage over 240 ms, and instantly under reduced motion', async () => {
  const { app, page } = await launchApp();
  await openSession(page);
  // Paper pinned: the same view, so nothing moves.
  await page.keyboard.press('b');
  await settle(page);

  // Split pinned: the paper panel narrows from the whole stage to half of it, in steps.
  const widths = await sampleReflow(page);
  expect(widths.at(-1)).toBe(698);
  expect(widths.some((width) => width > 698 && width < 1408)).toBe(true);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Board pinned, then Follow Ada (back to paper): each change lands in one step, with no width
  // between the old one and the new (a frame may still show the old one before React commits).
  let before = 698;
  for (const target of [0, 1408]) {
    const steps = await sampleReflow(page);
    expect(steps.at(-1)).toBe(target);
    expect(steps.every((width) => width === before || width === target)).toBe(true);
    before = target;
  }
  await closeApp(app);
});

test('End session confirms through the sheet, and is the only way back', async () => {
  const { app, page } = await launchApp();
  await openSession(page);
  await expect(page.getByRole('button', { name: 'Back' })).toHaveCount(0);
  // Escape and history-back stay on the session.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+BracketLeft');
  await expect(page.getByTestId('stage')).toBeVisible();

  await page.getByRole('button', { name: 'End session' }).click();
  const confirm = page.getByRole('dialog', { name: 'End this session?' });
  await expect(confirm.getByRole('button', { name: 'Keep going' })).toBeFocused();
  await settle(page);
  await snap(page, 'p1-session-end');
  await confirm.getByRole('button', { name: 'End session' }).click();
  // Back in the library, focus lands on its heading rather than the page body.
  await expect(page.getByRole('heading', { level: 1, name: 'Your sessions' })).toBeFocused();
  await closeApp(app);
});

test('keeps keyboard focus moving: the title on arrival, and the Board control after Unpin', async () => {
  const { app, page } = await launchApp();
  await openSession(page);
  // Arriving from the card she pressed, focus lands on the session's title.
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await page.keyboard.press('b');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Unpin' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Board: following Ada' })).toBeFocused();
  await closeApp(app);
});
