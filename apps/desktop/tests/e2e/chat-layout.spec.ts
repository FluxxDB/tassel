// The chat sidebar closed: the session screen lays out exactly as it did before the sidebar
// existed. The baseline boxes were measured on origin/claude/floating-tiles (479c43c), the
// commit before the sidebar, with the same specs: at 1440×900 and 1024×680, in each view, her
// tile, the captions, the dock, the panels' top lines and the board's fit.
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { E2E_SERVER_URL, launchApp, setWindowSize } from './fixtures';

type Box = [x: number, y: number, w: number, h: number];

/** Measured on origin/claude/floating-tiles at 479c43c, with this spec's own measure(). */
const BEFORE = {
  wide: {
    paper: {
      main: [[0, 52, 1440, 848]],
      stage: [[16, 60, 1408, 736]],
      panels: [[16, 60, 1408, 736]],
      tile: [[1198, 74, 212, 176]],
      pip: [],
      captions: [[280, 782, 880, 1]],
      dock: [[492, 814, 456, 64]],
      topLines: [[30, 74, 175, 26]],
    },
    split: {
      main: [[0, 52, 1440, 848]],
      stage: [[16, 60, 1408, 736]],
      panels: [
        [16, 60, 698, 736],
        [726, 60, 698, 736],
      ],
      tile: [[1198, 74, 212, 176]],
      pip: [],
      captions: [[280, 782, 880, 1]],
      dock: [[492, 814, 456, 64]],
      topLines: [
        [30, 74, 175, 26],
        [213, 74, 261, 26],
        [740, 74, 100, 26],
        [848, 74, 92, 26],
      ],
    },
    board: {
      main: [[0, 52, 1440, 848]],
      stage: [[16, 60, 1408, 736]],
      panels: [[16, 60, 1408, 736]],
      tile: [[1198, 74, 212, 176]],
      pip: [[1170, 536, 240, 150]],
      captions: [[280, 782, 880, 1]],
      dock: [[492, 814, 456, 64]],
      topLines: [
        [30, 74, 100, 26],
        [138, 74, 92, 26],
        [238, 74, 193, 26],
      ],
    },
  },
  narrow: {
    paper: {
      main: [[0, 52, 1024, 628]],
      stage: [[16, 60, 992, 516]],
      panels: [[16, 60, 992, 516]],
      tile: [[782, 74, 212, 176]],
      pip: [],
      captions: [[72, 562, 880, 1]],
      dock: [[284, 594, 456, 64]],
      topLines: [[30, 74, 175, 26]],
    },
    split: {
      main: [[0, 52, 1024, 628]],
      stage: [[16, 60, 992, 516]],
      panels: [
        [16, 60, 490, 516],
        [518, 60, 490, 516],
      ],
      tile: [[782, 74, 212, 176]],
      pip: [],
      captions: [[72, 562, 880, 1]],
      dock: [[284, 594, 456, 64]],
      topLines: [
        [30, 74, 175, 26],
        [213, 74, 261, 26],
        [532, 74, 100, 26],
        [640, 74, 92, 26],
      ],
    },
    board: {
      main: [[0, 52, 1024, 628]],
      stage: [[16, 60, 992, 516]],
      panels: [[16, 60, 992, 516]],
      tile: [[782, 74, 212, 176]],
      pip: [[754, 316, 240, 150]],
      captions: [[72, 562, 880, 1]],
      dock: [[284, 594, 456, 64]],
      topLines: [
        [30, 74, 100, 26],
        [138, 74, 92, 26],
        [238, 74, 193, 26],
      ],
    },
  },
};

/** Ada's board-demo DFA, fitted with the board pinned, measured there too. */
const BOARD_BEFORE = {
  wide: { fit: 'clear', states: [361, 283, 516, 311] },
  narrow: { fit: 'clear', states: [209, 203, 391, 236] },
};

interface Layout {
  main: Box[];
  stage: Box[];
  panels: Box[];
  tile: Box[];
  pip: Box[];
  captions: Box[];
  dock: Box[];
  topLines: Box[];
}

/** Every box the closed sidebar must leave where it was, rounded to the pixel. */
function measure(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    // The captions grow upward as lines come and go: their bottom edge, x and width are fixed.
    const boxes = (selector: string, bottomOnly = false): Box[] =>
      [...document.querySelectorAll(selector)]
        .filter((el) => !el.closest('[inert]'))
        .map((el) => {
          const r = el.getBoundingClientRect();
          return bottomOnly
            ? [Math.round(r.x), Math.round(r.bottom), Math.round(r.width), 1]
            : [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
        })
        .filter(([, , w, h]) => w > 0 && h > 0) as Box[];
    return {
      main: boxes('main'),
      stage: boxes('[data-testid="stage"]'),
      panels: boxes('[data-testid="stage"] > section'),
      tile: boxes('[data-testid="tutor-tile"]'),
      pip: boxes('[data-testid="camera-pip"]'),
      captions: boxes('[data-testid="captions"]', true),
      dock: boxes('[data-testid="dock"]'),
      topLines: boxes('[data-top-line] > *'),
    };
  });
}

async function openSession(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const token = await page.evaluate(() => window.tassel.getToken());
  await fetch(`${E2E_SERVER_URL}/v1/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'homework', language: 'en', source: 'paper' }),
  });
  await page.reload();
  await page.getByRole('list').getByRole('button').first().click();
  await expect(page.getByTestId('stage')).toBeVisible();
}

/** Each view's layout, after its reflow and the tiles' snap have settled. */
async function views(app: ElectronApplication, page: Page, width: number, height: number) {
  await setWindowSize(app, page, width, height);
  const settled = async () => {
    await page.waitForTimeout(400);
    return measure(page);
  };
  const paper = await settled();
  await page.keyboard.press('b');
  await page.keyboard.press('b');
  const split = await settled();
  await page.keyboard.press('b');
  const board = await settled();
  // Back to following Ada, which shows her paper.
  await page.keyboard.press('b');
  return { paper, split, board };
}

test('the session screen lays out as before the sidebar while it is closed', async () => {
  const { app, page } = await launchApp({ TASSEL_FAKE_SPEED: '1' });
  await openSession(page);
  await page.getByTestId('captions').waitFor({ state: 'attached' });
  const toggle = page.getByRole('button', { name: 'Chat', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(await views(app, page, 1440, 900)).toEqual(BEFORE.wide);
  expect(await views(app, page, 1024, 680)).toEqual(BEFORE.narrow);
  // Opened and closed again, at each size, everything goes back where it was.
  for (const [width, height, before] of [
    [1024, 680, BEFORE.narrow],
    [1440, 900, BEFORE.wide],
  ] as const) {
    await setWindowSize(app, page, width, height);
    await page.keyboard.press('t');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // T put focus in the message field, so a second T is typing: Hide closes it.
    await expect(page.getByRole('textbox', { name: 'Message to Ada' })).toBeFocused();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Hide chat' }).click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
    await page.waitForTimeout(400);
    expect(await measure(page)).toEqual(before.paper);
  }
  await app.close();
});

/** tldraw's license ping, answered here so no spec needs the network. */
const LICENSE_PING = 'https://cdn.tldraw.com/5.5.2/watermarks/watermark-track.svg';

/** How the camera fitted Ada's board and where her five states landed. */
async function boardFit(page: Page): Promise<{ fit: string | null; states: Box | null }> {
  const fit = await page
    .locator('[data-testid="board-canvas"] [data-fit]')
    .getAttribute('data-fit', { timeout: 1000 })
    .catch(() => null);
  const states = await page
    .locator('[data-testid="board-canvas"] .tl-shape[data-shape-type="tassel-state"]')
    .evaluateAll((els) => {
      if (els.length !== 5) return null;
      const rs = els.map((el) => el.getBoundingClientRect());
      const left = Math.min(...rs.map((r) => r.left));
      const top = Math.min(...rs.map((r) => r.top));
      const right = Math.max(...rs.map((r) => r.right));
      const bottom = Math.max(...rs.map((r) => r.bottom));
      return [left, top, right - left, bottom - top].map(Math.round) as Box;
    });
  return { fit, states };
}

test("Ada's board fits as before the sidebar", async () => {
  const { app, page } = await launchApp({
    TASSEL_FAKE_SCRIPT: 'board-demo',
    TASSEL_FAKE_SPEED: '3',
  });
  await app.context().route(
    (url) => url.href.startsWith(LICENSE_PING),
    (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg/>' }),
  );
  await expect(page.getByRole('region', { name: 'No sessions yet' })).toBeVisible();
  await page.getByRole('banner').getByRole('button', { name: 'New session' }).click();
  await page
    .getByRole('dialog', { name: 'New session' })
    .getByRole('button', { name: 'Start session' })
    .click();
  await expect(page.getByTestId('stage')).toBeVisible();
  await page.keyboard.press('b');
  await page.keyboard.press('b');
  await page.keyboard.press('b');
  await expect.poll(async () => (await boardFit(page)).states, { timeout: 10_000 }).not.toBeNull();
  await page.waitForTimeout(600);
  const boardWide = await boardFit(page);
  await setWindowSize(app, page, 1024, 680);
  await page.waitForTimeout(900);
  const boardNarrow = await boardFit(page);
  expect({ wide: boardWide, narrow: boardNarrow }).toEqual(BOARD_BEFORE);
  await app.close();
});
