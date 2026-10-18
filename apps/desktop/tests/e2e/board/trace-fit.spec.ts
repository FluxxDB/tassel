// The camera while Ada traces (the trace-demo script): she draws the reference DFA, then steps
// 0100 through it on a trace card under it. The camera frames the whole board, so the automaton
// stays whole inside the board panel, at 1440×900 and 1024×680, with the chat sidebar closed and
// open; the card's steps never pull the camera onto the card alone. And the student's Download
// board button saves the board as a PNG named for the session and the day.
//
// The store's account (the description list) needs no tldraw; the drawing's checks run on the
// dev path or in a build whose key validates on app://tassel (board-demo.spec.ts).
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { launchApp, settle, setWindowSize, snap } from '../fixtures';
import { hasTldrawKey } from './tldraw-key';

const DEV_RENDERER = process.env.TASSEL_E2E_RENDERER_URL;
const LICENSE_PING = 'https://cdn.tldraw.com/5.5.2/watermarks/watermark-track.svg';
const NO_TLDRAW = 'needs TLDRAW_LICENSE_KEY (P5-R2), or TASSEL_E2E_RENDERER_URL';
const seesTldraw = () => DEV_RENDERER !== undefined || hasTldrawKey();
const screens = join(__dirname, '..', '..', '..', 'test-results', 'screens');

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function launchTrace(
  env: Record<string, string> = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  const launched = await launchApp({
    TASSEL_FAKE_SCRIPT: 'trace-demo',
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

const described = (page: Page) =>
  page
    .locator('[data-testid="board-canvas"] ul[aria-label="What\'s on Ada\'s board"] li')
    .allTextContents();
const boardRegion = (page: Page) => page.getByRole('region', { name: "Ada's board" });
const fitOf = (page: Page) =>
  page.locator('[data-testid="board-canvas"] [data-fit]').getAttribute('data-fit');

/** The box around everything drawn for the automaton `fix`: its states, arrows and labels. */
async function automatonBox(page: Page): Promise<Box | null> {
  return page.evaluate(() => {
    const parts = [
      ...document.querySelectorAll(
        '[data-testid="board-canvas"] .tl-shape[data-shape-id^="shape:ada.fix."]',
      ),
    ].flatMap((shape) =>
      shape.getAttribute('data-shape-type') === 'arrow'
        ? [...shape.querySelectorAll('path, .tl-rich-text')]
        : [shape],
    );
    const boxes = parts
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0);
    if (boxes.length === 0) return null;
    const x = Math.min(...boxes.map((r) => r.x));
    const y = Math.min(...boxes.map((r) => r.y));
    const right = Math.max(...boxes.map((r) => r.right));
    const bottom = Math.max(...boxes.map((r) => r.bottom));
    return { x, y, width: right - x, height: bottom - y };
  });
}

function inside(a: Box, b: Box): boolean {
  return (
    a.x >= b.x - 0.5 &&
    a.y >= b.y - 0.5 &&
    a.x + a.width <= b.x + b.width + 0.5 &&
    a.y + a.height <= b.y + b.height + 0.5
  );
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * What's wrong with the view, if anything: the automaton must be whole inside the board panel
 * and, unless the fit is the plain last resort, clear of Ada's tile; the trace card must begin
 * in the panel under it, and be whole there when the fit is clear (its last rows run off the
 * bottom when the panel is short: fit.ts's 'top' stage gives those up, never the automaton).
 */
async function wholeBoardInView(page: Page): Promise<string[]> {
  const board = await boardRegion(page).boundingBox();
  const automaton = await automatonBox(page);
  const tile = await page.getByTestId('tutor-tile').boundingBox();
  const card = await page.getByTestId('trace-card').boundingBox();
  const fit = await fitOf(page);
  const problems: string[] = [];
  if (!board) return ['no board panel'];
  if (!automaton) problems.push('no automaton drawn');
  else {
    if (!inside(automaton, board)) problems.push(`automaton ${JSON.stringify(automaton)} cut off`);
    if (fit !== 'plain' && tile && intersects(automaton, tile))
      problems.push('automaton under tile');
  }
  if (!card) problems.push('no trace card');
  else if (fit === 'top') {
    if (!inside({ ...card, height: 1 }, board)) problems.push('trace card starts off the panel');
  } else if (!inside(card, board)) {
    problems.push(`trace card ${JSON.stringify(card)} cut off`);
  }
  if (automaton && card && card.y < automaton.y + automaton.height) {
    problems.push('trace card over the automaton');
  }
  return problems;
}

/** Everything Ada draws and steps, as the description reads it once the trace is done. */
const TRACED = [
  'Step 1: read 0, q0 to q1',
  'Step 2: read 1, q1 to q2',
  'Step 3: read 0, q2 to q3',
  'Step 4: read 0, q3 to q3',
];

async function tracedBoard(page: Page): Promise<void> {
  await startSession(page);
  await expect
    .poll(async () => (await described(page)).filter((line) => line.startsWith('Step ')), {
      timeout: 10_000,
    })
    .toEqual(TRACED);
  await expect(boardRegion(page)).toBeVisible();
}

for (const sidebar of ['closed', 'open'] as const) {
  test(`frames the DFA whole while a trace runs, chat ${sidebar}, at 1440×900 and 1024×680`, async () => {
    test.setTimeout(60_000);
    const { app, page } = await launchTrace({ TASSEL_CHAT_SIDEBAR: sidebar });
    try {
      await tracedBoard(page);
      if (sidebar === 'open') await expect(page.getByTestId('chat-sidebar')).toBeVisible();
      test.skip(!seesTldraw(), NO_TLDRAW);

      await expect(page.getByTestId('trace-card')).toBeVisible();
      await expect(page.getByTestId('trace-row')).toHaveCount(4);
      await expect.poll(() => wholeBoardInView(page), { timeout: 10_000 }).toEqual([]);
      test.info().annotations.push({
        type: `fit at 1440, chat ${sidebar}`,
        description: `${await fitOf(page)}`,
      });
      await settle(page);
      await snap(page, `trace-fit-1440-chat-${sidebar}`);

      await setWindowSize(app, page, 1024, 680);
      // Her tile snaps to its new corner over the camera's motion: let both end, then look.
      await settle(page);
      await expect.poll(() => wholeBoardInView(page), { timeout: 10_000 }).toEqual([]);
      test.info().annotations.push({
        type: `fit at 1024, chat ${sidebar}`,
        description: `${await fitOf(page)}`,
      });
      if (sidebar === 'open') {
        // In split, the stage makes room for the sidebar: the board is never under it.
        const chat = await page.getByTestId('chat-sidebar').boundingBox();
        const board = await boardRegion(page).boundingBox();
        if (!chat || !board) throw new Error('chat or board missing');
        expect(board.x + board.width).toBeLessThanOrEqual(chat.x);
      }
      await settle(page);
      await snap(page, `trace-fit-1024-chat-${sidebar}`);
    } finally {
      await app.close();
    }
  });
}

// Electron's downloads never reach Playwright's `download` event (its CDP download behaviour
// doesn't take in Electron's session), so the main process saves them itself (main/downloads.ts)
// and the spec watches the folder TASSEL_DOWNLOAD_DIR names.
test('Download board saves the whole board as a PNG named for the session and the day', async () => {
  test.setTimeout(60_000);
  const dir = mkdtempSync(join(tmpdir(), 'tassel-download-'));
  const { app, page } = await launchTrace({ TASSEL_DOWNLOAD_DIR: dir });
  try {
    await tracedBoard(page);
    test.skip(!seesTldraw(), NO_TLDRAW);
    await expect(page.getByTestId('trace-card')).toBeVisible();
    const button = page
      .getByRole('group', { name: 'Board camera controls' })
      .getByRole('button', { name: 'Download board' });
    await expect(button).toBeEnabled();
    await expect(button).toHaveAttribute('title', 'Download board');
    await button.click();
    const day = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const name = `tassel-board-strings-that-start-with-010-${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}.png`;
    // The whole file: Electron writes it, then names it (a .crdownload until then).
    await expect.poll(() => readdirSync(dir), { timeout: 15_000 }).toEqual([name]);
    const png = readFileSync(join(dir, name));
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]));
    expect(png.length).toBeGreaterThan(10_000);
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    // The DFA with the card under it, at twice its size: tall, and well over 400 px.
    expect(width).toBeGreaterThan(400);
    expect(height).toBeGreaterThan(width);
    writeFileSync(join(screens, 'board-download.png'), png);
    // A second click never overwrites: the next one counts up.
    await button.click();
    await expect
      .poll(() => readdirSync(dir).sort(), { timeout: 15_000 })
      .toEqual([name.replace(/\.png$/, '-2.png'), name]);
    await snap(page, 'board-download-clicked');
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
