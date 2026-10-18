import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import {
  callApi,
  doubleClickLikeAPerson,
  E2E_SERVER_URL,
  launchApp as launch,
  settle,
  setWindowSize,
  snap,
} from './fixtures';

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

test('drags the window by the session title, and not by the controls in a strip', async () => {
  const { app, page } = await launchApp();
  await openSession(page);
  // The title is only a focus landing spot (tabindex -1), so it moves the window like the strip.
  await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('-webkit-app-region', 'drag');
  await page.getByRole('button', { name: 'End session' }).click();
  await page
    .getByRole('dialog', { name: 'End this session?' })
    .getByRole('button', { name: 'End session' })
    .click();
  const strip = page.getByRole('banner');
  await expect(strip.getByRole('searchbox')).toHaveCSS('-webkit-app-region', 'no-drag');
  await expect(strip.getByRole('button', { name: 'New session' })).toHaveCSS(
    '-webkit-app-region',
    'no-drag',
  );
  await closeApp(app);
});

test('a double click on End session opens its sheet once, with focus inside', async () => {
  const { app, page } = await launchApp();
  await openSession(page);
  const end = page.getByTestId('dock').getByRole('button', { name: 'End session' });
  const sheet = page.getByRole('dialog', { name: 'End this session?' });
  const keepGoing = sheet.getByRole('button', { name: 'Keep going' });
  // A person's double click: the second press lands on the sheet's scrim.
  await doubleClickLikeAPerson(page, end);
  await page.waitForTimeout(300);
  await expect(sheet).toBeVisible();
  await expect(keepGoing).toBeFocused();
  await keepGoing.click();
  await expect(sheet).toBeHidden();
  // A script's double click: both presses at once.
  await end.dblclick();
  await page.waitForTimeout(300);
  await expect(sheet).toBeVisible();
  await expect(keepGoing).toBeFocused();
  await closeApp(app);
});

test('a double click on End session lands in the library, not in the session under it', async () => {
  const { app, page } = await launchApp();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // Two full rows of cards at 1024: the sheet's End session button sits over the second.
  for (let n = 0; n < 6; n += 1) {
    await callApi(page, '/v1/sessions', {
      method: 'POST',
      body: JSON.stringify({ type: 'homework', language: 'en', source: 'paper' }),
    });
  }
  await page.reload();
  await setWindowSize(app, page, 1024, 680);
  const cards = page.getByRole('list', { name: 'Your sessions' }).getByRole('button');
  await expect(cards).toHaveCount(6);
  await cards.first().click();
  await expect(page.getByTestId('stage')).toBeVisible();
  await page.getByRole('button', { name: 'End session' }).click();
  const confirm = page
    .getByRole('dialog', { name: 'End this session?' })
    .getByRole('button', { name: 'End session' });
  await settle(page);
  await doubleClickLikeAPerson(page, confirm);
  await page.waitForTimeout(500);
  await expect(page.getByRole('heading', { level: 1, name: 'Your sessions' })).toBeVisible();
  await expect(page.getByTestId('stage')).toHaveCount(0);
  await closeApp(app);
});

/** Board pinned (Paper → Split → Board), once her paper's fake clip is live. */
async function pinBoard(page: Page): Promise<void> {
  await expect(
    page.getByRole('region', { name: 'Your paper · Desk View' }).getByTestId('paper-video'),
  ).toBeVisible({ timeout: 10_000 });
  for (let n = 0; n < 3; n += 1) await page.keyboard.press('b');
  await expect(page.getByRole('region', { name: "Ada's board" })).toBeVisible();
  await settle(page);
}

/** A person's drag: press, a few moves, release. */
async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 3, from.y + dy / 3, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  await page.mouse.up();
}

test('floats her desk camera over the board, and only there', async () => {
  const { app, page } = await launchApp();
  await openSession(page);
  const pip = page.getByRole('group', { name: 'Your desk' });
  // Not over her paper.
  await expect(
    page.getByRole('region', { name: 'Your paper · Desk View' }).getByTestId('paper-video'),
  ).toBeVisible({ timeout: 10_000 });
  await expect(pip).toHaveCount(0);
  await pinBoard(page);
  await expect(pip).toBeVisible();
  // 240×150 in the stage's bottom right corner, 14px in and clear of the captions band.
  expect(await pip.boundingBox()).toEqual({ x: 1170, y: 536, width: 240, height: 150 });
  // The same live stream as her paper panel, playing.
  await expect
    .poll(() =>
      pip.locator('video').evaluate((v: HTMLVideoElement) => v.readyState >= 2 && !v.paused),
    )
    .toBe(true);
  await expect(pip).toContainText('Your desk');
  // Ada's tile is still where it always was.
  expect(await boxOf(page, 'tutor-tile')).toEqual({ x: 1198, y: 74, width: 212, height: 176 });
  await settle(page);
  await snap(page, 'tiles-board-pip-1440');

  // A double click pins paper and board side by side, and the picture in picture goes.
  await pip.dblclick();
  await expect(page.getByRole('region', { name: 'Your paper · Desk View' })).toBeVisible();
  await expect(pip).toHaveCount(0);
  await expect(page.getByText('Pinned · Paper and board')).toBeVisible();
  // Her paper panel's video still plays: the picture in picture never stopped the stream.
  await expect
    .poll(() =>
      page
        .getByRole('region', { name: 'Your paper · Desk View' })
        .locator('video')
        .evaluate(
          (v: HTMLVideoElement) =>
            v.readyState >= 2 && !v.paused && (v.srcObject as MediaStream).active,
        ),
    )
    .toBe(true);
  await closeApp(app);
});

test('keeps the camera, captions, dock and tile apart on the board at 1024×680', async () => {
  const { app, page } = await launchApp();
  await openSession(page);
  await setWindowSize(app, page, 1024, 680);
  await pinBoard(page);
  // Ada's first lines, so the captions have their height.
  const captions = page.getByTestId('captions');
  await expect(captions).toHaveCSS('opacity', '1', { timeout: 10_000 });
  await settle(page);
  const boxes = {
    pip: await page.getByRole('group', { name: 'Your desk' }).boundingBox(),
    captions: await boxOf(page, 'captions'),
    dock: await boxOf(page, 'dock'),
    tile: await boxOf(page, 'tutor-tile'),
    // The board's −/+/Fit, in its top line beside the tag.
    controls: await page.getByRole('group', { name: 'Board camera controls' }).boundingBox(),
  };
  if (!boxes.pip) throw new Error("the desk camera isn't on screen");
  if (!boxes.controls) throw new Error("the board's camera controls aren't on screen");
  const all = Object.entries(boxes) as [string, Box][];
  for (const [i, [a, boxA]] of all.entries()) {
    for (const [b, boxB] of all.slice(i + 1)) {
      expect(intersects(boxA, boxB), `${a} and ${b} overlap`).toBe(false);
    }
  }
  // Two lines at most: the band the tiles keep clear of is 84px tall.
  expect(boxes.captions.height).toBeLessThanOrEqual(84);
  await snap(page, 'tiles-board-pip-1024');
  await closeApp(app);
});

test('drags and resizes the tiles, which snap to the nearest free corner', async () => {
  const { app, page } = await launchApp();
  await openSession(page);
  await pinBoard(page);
  const pip = page.getByRole('group', { name: 'Your desk' });
  const tile = page.getByRole('group', { name: "Ada's tile" });

  // The camera, dragged most of the way to the top left, lands there 14px in from the stage.
  const start = await pip.boundingBox();
  if (!start) throw new Error("the desk camera isn't on screen");
  await dragBy(page, { x: start.x + 120, y: start.y + 75 }, -900, -380);
  await settle(page);
  await expect(pip).toHaveAttribute('data-corner', 'top-left');
  expect(await pip.boundingBox()).toMatchObject({ x: 30, y: 74, width: 240, height: 150 });

  // Resized from its inner corner (now its bottom right): wider and taller at 1.6:1.
  await dragBy(page, { x: 30 + 238, y: 74 + 148 }, 80, 50);
  await settle(page);
  expect(await pip.boundingBox()).toMatchObject({ x: 30, y: 74, width: 320, height: 200 });
  await snap(page, 'tiles-dragged-resized');

  // Ada's tile all the way left, to the corner the camera holds: she snaps to the nearest free
  // one instead, the bottom left, above the captions band.
  const ada = await tile.boundingBox();
  if (!ada) throw new Error("Ada's tile isn't on screen");
  await dragBy(page, { x: ada.x + 100, y: ada.y + 100 }, -1100, 0);
  await settle(page);
  await expect(tile).toHaveAttribute('data-corner', 'bottom-left');
  expect(await tile.boundingBox()).toMatchObject({ x: 30, y: 60 + 736 - 110 - 176 });
  await snap(page, 'tiles-ada-bottom-left');

  // From the keyboard: right, up to the top right corner again, then a size step larger.
  await tile.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');
  await settle(page);
  await expect(tile).toHaveAttribute('data-corner', 'top-right');
  expect(await tile.boundingBox()).toMatchObject({ x: 1424 - 14 - 228, y: 74, width: 228 });
  await closeApp(app);
});

test("breathes Ada's ring while she speaks, and holds it still under reduced motion", async () => {
  const { app, page } = await launchApp();
  await openSession(page);
  const tile = page.getByTestId('tutor-tile');
  await expect(tile).toContainText('Speaking', { timeout: 10_000 });
  await expect(tile).toHaveCSS('animation-name', 'tutor-speaking');
  await snap(page, 'tiles-ada-speaking');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(tile).toHaveCSS('animation-name', 'none');
  await expect(tile).toHaveCSS('box-shadow', /2px/);
  await closeApp(app);
});
