// The chat sidebar in the running app, on the scripted tutor with chat on: it opens with a
// session beside the stage at 1440×900 and over it at 1024×680, never over Ada's tile, the
// captions or the dock; the scripted spoken lines show in italics, a typed message gets Ada's
// answer and an action row that moves the stage, a text-only answer comes without a caption, and
// two synthetic images go on as chips, a refused upload shows Not sent and Retry, and the retry
// sends them. The title stays whole, or ellipsizes, beside the sidebar's toggle. The choice to
// hide it carries to the next session.
import { deflateSync } from 'node:zlib';
import { type ElectronApplication, expect, type Locator, type Page, test } from '@playwright/test';
import {
  callApi,
  launchApp as launch,
  settle,
  setWindowSize,
  snap,
  startPaperSession,
} from './fixtures';

const launchApp = (env: Record<string, string> = {}) =>
  launch({ TASSEL_CHAT_SIDEBAR: 'open', ...env });

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not on screen');
  return box;
}

/** The sidebar keeps clear of everything the stage floats: her tile, the captions, the dock. */
async function expectClearOfStage(page: Page): Promise<void> {
  // The tiles snap clear over the camera's motion, and the sidebar slides in over 200 ms.
  await page.waitForTimeout(500);
  await settle(page);
  const sidebar = await boxOf(page.getByTestId('chat-sidebar'));
  for (const id of ['tutor-tile', 'captions', 'dock'])
    expect(intersects(sidebar, await boxOf(page.getByTestId(id))), id).toBe(false);
  // The session screen never scrolls.
  expect(
    await page.evaluate(() => [
      document.documentElement.scrollWidth <= window.innerWidth,
      document.documentElement.scrollHeight <= window.innerHeight,
    ]),
  ).toEqual([true, true]);
}

/** A synthetic PNG, `w`×`h`, in soft stripes: never a camera frame. */
function syntheticPng(w: number, h: number, hue: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const b of bytes) c = (crcTable[(c ^ b) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      const stripe = Math.floor((x + y) / 24) % 2 === 0 ? 236 : 214;
      rows.set([stripe, Math.min(255, stripe - 20 + hue), 250 - hue], row + 1 + x * 3);
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const log = (page: Page) => page.getByRole('log', { name: 'Conversation' });
const field = (page: Page) => page.getByRole('textbox', { name: 'Message to Ada' });
const toggle = (page: Page) => page.getByRole('button', { name: 'Chat', exact: true });

/** Whether the log's newest line is in view, whole, above the composer. */
const newestInView = (page: Page) =>
  page.getByTestId('chat-log').evaluate((log) => {
    const last = log.querySelector('[data-testid="chat-line"]:last-child');
    if (!last) return false;
    const box = log.getBoundingClientRect();
    const line = last.getBoundingClientRect();
    return line.top >= box.top - 1 && line.bottom <= box.bottom + 1;
  });

/**
 * Ada's title, typed on in full (a capture mid-type-on shows it cut short), on one line that
 * would ellipsize if the strip were too narrow for it.
 */
async function expectTitle(page: Page): Promise<void> {
  await expect(page.getByTestId('title-typed')).toHaveText('Strings that start with 010');
  const title = page.getByRole('heading', { level: 1 });
  await expect(title).toHaveCSS('text-overflow', 'ellipsis');
  await expect(title).toHaveCSS('white-space', 'nowrap');
  // It fits whole in the strip beside the sidebar's toggle.
  expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
}

async function close(app: ElectronApplication): Promise<void> {
  await app.close();
}

test('a conversation in the sidebar at 1440×900, beside the stage', async () => {
  const { app, page } = await launchApp();
  await setWindowSize(app, page, 1440, 900);
  await startPaperSession(page);
  const sidebar = page.getByTestId('chat-sidebar');
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(sidebar).toHaveAttribute('data-layout', 'push');

  // The stage shrinks beside it: main is the window less 360, and the stage re-centres there.
  expect(await boxOf(sidebar)).toEqual({ x: 1080, y: 52, width: 360, height: 848 });
  expect(await boxOf(page.getByTestId('stage'))).toEqual({
    x: 16,
    y: 60,
    width: 1048,
    height: 736,
  });
  const dock = await boxOf(page.getByTestId('dock'));
  expect(Math.round(dock.x + dock.width / 2)).toBe(540);
  await expectClearOfStage(page);

  // Her scripted spoken line, in italics with a mic, and Ada's, under her label.
  const spoken = log(page).getByText(/^Hi Ada, I'm working on a DFA/);
  await expect(spoken).toBeVisible();
  await expect(spoken.locator('xpath=..')).toHaveClass(/italic/);
  await expect(
    log(page).getByText('Great, draw it on paper and talk me through it.', { exact: false }),
  ).toBeVisible();
  // Captions stay on the stage while the chat is open.
  await expect(page.getByTestId('captions')).toBeVisible();
  await expectTitle(page);
  await settle(page);
  await snap(page, 'chat-1440-open');

  // She types; it shows at once, then Ada answers aloud, and an action row follows.
  await field(page).fill('Can you sketch it?');
  await field(page).press('Enter');
  await expect(field(page)).toHaveValue('');
  await expect(log(page).getByText('Can you sketch it?')).toBeVisible();
  await expect(
    log(page).getByText("Good question. Let's sketch it on the board, one state at a time."),
  ).toBeVisible();
  await expect(page.getByTestId('captions')).toContainText("Let's sketch it on the board");
  const action = log(page).getByRole('button', { name: 'Drew on the board' });
  await expect(action).toBeVisible();

  // Text replies only: Ada answers in the chat, and nothing new captions.
  await page.getByTestId('chat-voice').click();
  await expect(page.getByTestId('chat-voice')).toHaveAccessibleName('Text replies only');
  await field(page).fill('And in writing?');
  await field(page).press('Enter');
  await expect(
    log(page).getByText('Here it is in writing: start at q0 and follow each symbol.'),
  ).toBeVisible();
  await expect(page.getByTestId('captions')).not.toContainText('Here it is in writing');
  await settle(page);
  await snap(page, 'chat-1440-conversation');

  // An action row pins the stage where Ada did it.
  await action.first().click();
  await expect(page.getByRole('button', { name: 'Board: Board, pinned' })).toBeVisible();
  await expect(page.getByRole('region', { name: "Ada's board" })).toBeVisible();
  await expectClearOfStage(page);

  // Two synthetic images as chips. The first upload fails (the network refuses it here, so the
  // spec holds whether or not the server's attachments route is served): the message shows at
  // once, then Not sent, with Retry. The retry goes through: to the server when it takes images,
  // or to a stand-in answer while its route is still a stub.
  let uploads = 0;
  await app.context().route(
    (url) => url.pathname.endsWith('/attachments'),
    async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      uploads += 1;
      if (uploads === 1) return route.abort('failed');
      const response = await route.fetch();
      if (response.ok()) return route.fulfill({ response });
      return route.fulfill({
        response,
        status: 201,
        headers: { ...response.headers(), 'content-type': 'application/json' },
        body: JSON.stringify({ id: `e2e-image-${uploads}`, w: 640, h: 400 }),
      });
    },
  );
  await page.getByTestId('chat-file-input').setInputFiles([
    { name: 'part-a.png', mimeType: 'image/png', buffer: syntheticPng(640, 400, 10) },
    { name: 'part-b.png', mimeType: 'image/png', buffer: syntheticPng(480, 480, 40) },
  ]);
  await expect(page.getByRole('button', { name: /^Remove image/ })).toHaveCount(2);
  // The chips grew the composer: the newest line is still in view.
  await expect.poll(() => newestInView(page)).toBe(true);
  await settle(page);
  await snap(page, 'chat-1440-images');
  await field(page).fill("Here's part b");
  await field(page).press('Enter');
  await expect(page.getByRole('button', { name: /^Remove image/ })).toHaveCount(0);
  await expect(log(page).getByRole('button', { name: 'Image 2' })).toBeVisible();
  await expect(log(page).getByText('Not sent')).toBeVisible();
  await expect(log(page).getByRole('button', { name: 'Retry' })).toBeVisible();
  // A thumbnail opens the viewer.
  await log(page).getByRole('button', { name: 'Image 1' }).click();
  await expect(page.getByRole('dialog', { name: 'Your image' })).toBeVisible();
  await settle(page);
  await snap(page, 'chat-1440-viewer');
  await page.keyboard.press('Escape');
  await settle(page);
  await snap(page, 'chat-1440-not-sent');
  // Retry uploads both, sends them, and the echo takes the line's place.
  await log(page).getByRole('button', { name: 'Retry' }).click();
  await expect(log(page).getByText('Not sent')).toHaveCount(0);
  await expect.poll(() => uploads).toBe(3);
  await expect(log(page).getByRole('button', { name: 'Image 2' }).locator('img')).toBeVisible();
  await expect(log(page).getByText("Here's part b")).toHaveCount(1);

  // Hidden: the stage takes the window back.
  await page.getByRole('button', { name: 'Hide chat' }).click();
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle(page)).toBeFocused();
  await page.waitForTimeout(400);
  expect(await boxOf(page.getByTestId('stage'))).toEqual({
    x: 16,
    y: 60,
    width: 1408,
    height: 736,
  });
  await settle(page);
  await snap(page, 'chat-1440-closed');
  await close(app);
});

test('over the stage at 1024×680, clear of the tiles, captions and dock', async () => {
  const { app, page } = await launchApp();
  await setWindowSize(app, page, 1024, 680);
  await startPaperSession(page);
  const sidebar = page.getByTestId('chat-sidebar');
  await expect(sidebar).toHaveAttribute('data-layout', 'overlay');
  // Her paper keeps its size under it.
  expect(await boxOf(page.getByTestId('stage'))).toEqual({ x: 16, y: 60, width: 992, height: 516 });
  expect(await boxOf(sidebar)).toEqual({ x: 664, y: 52, width: 360, height: 628 });
  await expect(log(page).getByText(/^Hi Ada, I'm working on a DFA/)).toBeVisible();
  await expectClearOfStage(page);
  // The captions and the dock centre in what it leaves of the window.
  const dock = await boxOf(page.getByTestId('dock'));
  expect(Math.round(dock.x + dock.width / 2)).toBe(332);
  await field(page).fill('Can you sketch it?');
  await field(page).press('Enter');
  await expect(log(page).getByRole('button', { name: 'Drew on the board' })).toBeVisible();
  await expectTitle(page);
  await settle(page);
  await snap(page, 'chat-1024-open');

  // Split, the busiest view: still clear.
  await page.getByRole('button', { name: 'Hide chat' }).click();
  await page.keyboard.press('b');
  await page.keyboard.press('b');
  await page.keyboard.press('t');
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  await expectClearOfStage(page);
  // Split, the stage itself makes room: her board and its controls stay out from under it.
  const sidebarBox = await boxOf(page.getByTestId('chat-sidebar'));
  const boardBox = await boxOf(page.getByRole('region', { name: "Ada's board" }));
  expect(boardBox.x + boardBox.width).toBeLessThanOrEqual(sidebarBox.x - 16);
  await expect(page.getByRole('button', { name: 'Fit', exact: true })).toBeVisible();
  const fit = await boxOf(page.getByRole('button', { name: 'Fit', exact: true }));
  expect(fit.x + fit.width).toBeLessThan(sidebarBox.x);
  expect(intersects(await boxOf(page.getByTestId('tutor-tile')), sidebarBox)).toBe(false);
  await snap(page, 'chat-1024-split-open');

  await page.getByRole('button', { name: 'Hide chat' }).click();
  await page.waitForTimeout(400);
  await settle(page);
  await snap(page, 'chat-1024-closed');
  await close(app);
});

test('her choice to hide it carries to the next session', async () => {
  const { app, page } = await launchApp();
  await startPaperSession(page);
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'End session' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'End session' }).click();
  await startPaperSession(page);
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  // And a fresh session starts with an empty chat.
  await page.keyboard.press('t');
  await expect(log(page).getByText('Can you sketch it?')).toHaveCount(0);
  await close(app);
});

test('a long title ellipsizes on one line beside the toggle at 1024×680', async () => {
  const { app, page } = await launchApp({ TASSEL_FAKE_SPEED: '1' });
  await setWindowSize(app, page, 1024, 680);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const title = 'Demostración por inducción de la fórmula para la suma de los n impares';
  const created = await callApi(page, '/v1/sessions', {
    method: 'POST',
    body: JSON.stringify({ type: 'studying', language: 'es', source: 'paper' }),
  });
  const { id } = (await created.json()) as { id: string };
  await callApi(page, `/v1/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title, subject: 'Matemáticas discretas' }),
  });
  await page.reload();
  // Its card, once the library lists it.
  await page.getByRole('list').getByText(title).click();
  await expect(page.getByTestId('stage')).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toHaveText(title);
  expect(await heading.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect(heading).toHaveCSS('text-overflow', 'ellipsis');
  await expect(heading).toHaveCSS('white-space', 'nowrap');
  // The toggle keeps its place at the strip's right end.
  const strip = await boxOf(page.getByRole('banner'));
  const button = await boxOf(toggle(page));
  expect(button.x + button.width).toBeLessThanOrEqual(strip.x + strip.width);
  expect(intersects(await boxOf(heading), button)).toBe(false);
  await settle(page);
  await snap(page, 'chat-1024-long-title');
  await close(app);
});

test('the sidebar in a Korean UI', async () => {
  const { app, page } = await launchApp({ TASSEL_UI_LANG: 'ko' });
  await setWindowSize(app, page, 1440, 900);
  await startPaperSession(page, { uiLang: 'ko', language: 'ko' });
  await expect(page.getByRole('log', { name: '대화' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Ada에게 보낼 메시지' }).fill('이 상태는 왜 반복되나요?');
  await page.getByRole('textbox', { name: 'Ada에게 보낼 메시지' }).press('Enter');
  await expect(page.getByRole('button', { name: '보드에 그렸어요' })).toBeVisible();
  await settle(page);
  await snap(page, 'chat-1440-ko');
  await close(app);
});
