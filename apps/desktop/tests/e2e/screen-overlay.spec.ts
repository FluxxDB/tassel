import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { DEFAULT_AVATAR } from '../../src/renderer/src/avatar/catalog';
import { launchApp, startVoiceSession } from './fixtures';

/** Real Electron windows and fake self capture, against a deliberately tiny isolated API. */
test('shares, collapses, draws, resets, restores and stops without leaving capture alive', async () => {
  let session: Record<string, unknown> | null = null;
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    res.setHeader('Access-Control-Allow-Methods', '*');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    const body: Buffer[] = [];
    for await (const chunk of req) body.push(Buffer.from(chunk));
    const path = req.url?.split('?')[0] ?? '';
    if (path === '/v1/devices') {
      res.end(
        JSON.stringify({
          token: 'synthetic-test-token',
          device_id: '00000000-0000-4000-8000-000000000001',
        }),
      );
      return;
    }
    if (path === '/v1/sessions' && req.method === 'POST') {
      session = {
        ...JSON.parse(Buffer.concat(body).toString()),
        id: '00000000-0000-4000-8000-000000000002',
        title: null,
        title_source: null,
        subject: null,
        created_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
      };
      res.end(JSON.stringify(session));
      return;
    }
    if (path === '/v1/sessions') {
      res.end(JSON.stringify({ items: session ? [session] : [] }));
      return;
    }
    res.end(JSON.stringify(path.endsWith('/memory') ? {} : (session ?? {})));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server');
  const { app, page } = await launchApp({
    TASSEL_SERVER_URL: `http://127.0.0.1:${address.port}`,
    TASSEL_PAPER_SOURCE: 'screen',
    TASSEL_FAKE_DISPLAY: 'self',
    TASSEL_UI_LANG: 'en',
    TASSEL_FAKE_SPEED: '.1',
  });
  const errors: string[] = [];
  const timings: Record<string, unknown>[] = [];
  page.on('console', (message) => {
    if (message.text().startsWith('[screen-timing]')) {
      void message
        .args()[1]
        ?.jsonValue()
        .then((value) => timings.push(value));
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.evaluate(
      (profile) => localStorage.setItem('tassel.avatar', JSON.stringify({ version: 1, profile })),
      { ...DEFAULT_AVATAR, name: 'Configured tutor', hair: 'long', outfit: 'dress' },
    );
    await page.reload();
    // A stable synthetic assignment avoids recursively capturing Tassel's own preview.
    await page.evaluate(() => {
      Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
        value: async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 1280;
          canvas.height = 720;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('No canvas');
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, 1280, 720);
          ctx.fillStyle = '#222222';
          ctx.font = '28px sans-serif';
          ctx.fillText('Synthetic assignment: explain 2 + 2', 100, 100);
          return canvas.captureStream(10);
        },
      });
    });
    await startVoiceSession(page, { language: 'en' });
    await expect(page.getByTestId('tutor-tile').locator('svg[data-hair]')).toHaveAttribute(
      'data-hair',
      'long',
    );
    await page.getByRole('button', { name: 'Share screen', exact: true }).click();
    await page.getByRole('button', { name: 'Test display', exact: true }).click();
    await expect
      .poll(() =>
        app
          .windows()
          .find((window) => window.url().endsWith('#overlay-hud'))
          ?.url(),
      )
      .toContain('#overlay-hud');
    await expect
      .poll(() => app.windows().filter((window) => window.url().includes('#overlay-')).length)
      .toBe(2);
    const hud = app.windows().find((window) => window.url().endsWith('#overlay-hud'));
    const ink = app.windows().find((window) => window.url().endsWith('#overlay-ink'));
    if (!hud || !ink) throw new Error('Overlay windows missing');
    hud.on('pageerror', (error) => {
      errors.push(error.message);
      console.log('HUD error:', error.message);
    });
    ink.on('pageerror', (error) => {
      errors.push(error.message);
      console.log('Ink error:', error.message);
    });
    ink.on('console', (message) => {
      if (message.type() === 'error') console.log('Ink console:', message.text());
    });
    await expect(hud.getByTestId('screen-overlay')).toBeVisible();
    await expect(hud.locator('.overlay-avatar svg')).toHaveAttribute('data-hair', 'long');
    expect(
      await hud.locator('.overlay-bar').evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight;
      }),
    ).toBe(true);
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((window) => !window.webContents.getURL().includes('#overlay-'))
            ?.isVisible(),
        ),
      )
      .toBe(false);
    expect(
      await hud.locator('.overlay-bar').evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe('rgb(255, 249, 243)');
    await expect(ink.locator('.tl-container')).toBeVisible();
    expect(
      await ink.locator('.screen-tldraw').evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe('rgba(0, 0, 0, 0)');
    const displayGeometry = await app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith('#overlay-ink'),
      );
      if (!win) throw new Error('Missing ink window');
      return {
        content: win.getContentBounds(),
        display: screen.getDisplayMatching(win.getBounds()).bounds,
      };
    });
    console.log('Synthetic overlay bounds:', displayGeometry);
    expect(
      Math.abs(displayGeometry.content.width - displayGeometry.display.width),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(displayGeometry.content.height - displayGeometry.display.height),
    ).toBeLessThanOrEqual(1);
    await hud.getByRole('button', { name: 'Draw', exact: true }).click();
    await expect(ink.getByTestId('screen-drawing')).toHaveClass(/is-drawing/);
    await ink.mouse.move(150, 130);
    await ink.mouse.down();
    await ink.mouse.move(220, 170, { steps: 8 });
    await ink.mouse.up();
    await expect(ink.locator('.tl-shape[data-shape-type="line"]')).toHaveCount(1);
    // Capture a fresh changed assignment while keeping existing ink on screen.
    await hud.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(hud.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    await expect(ink.locator('.tl-shape[data-shape-type="line"]')).toHaveCount(1);
    await hud.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(ink.locator('.tl-shape[data-shape-type="line"]')).toHaveCount(1);
    await app.evaluate(({ BrowserWindow }) => {
      const inkWindow = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith('#overlay-ink'),
      );
      inkWindow?.setTitle('capture-stayed-visible');
      inkWindow?.once('hide', () => inkWindow.setTitle('capture-hid-ink'));
    });
    await hud.getByRole('button', { name: 'Look again', exact: true }).click();
    await expect
      .poll(() => timings.some((value) => value.delivered === true), { timeout: 12000 })
      .toBe(true);
    await expect(ink.locator('.tl-shape[data-shape-type="line"]')).toHaveCount(1);
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().endsWith('#overlay-ink'))
          ?.getTitle(),
      ),
    ).toBe('capture-stayed-visible');
    await hud.getByRole('button', { name: 'Reset annotations', exact: true }).click();
    await expect(ink.locator('.tl-shape[data-shape-type="line"]')).toHaveCount(0);
    await expect(ink.getByTestId('screen-drawing')).not.toHaveClass(/is-drawing/);
    await hud.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(hud.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    await hud.getByRole('button', { name: 'Reset annotations', exact: true }).click();
    await expect(hud.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    await hud.getByRole('button', { name: 'Resume', exact: true }).click();
    const dir = join(__dirname, '../../test-results/screens');
    mkdirSync(dir, { recursive: true });
    await hud.screenshot({ path: join(dir, 'screen-overlay.png') });
    await hud.getByRole('button', { name: 'Open Tassel', exact: true }).click();
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((window) => !window.webContents.getURL().includes('#overlay-'))
            ?.isVisible(),
        ),
      )
      .toBe(true);
    await page
      .getByTestId('dock')
      .getByRole('button', { name: 'Minimize to overlay', exact: true })
      .click();
    await expect(hud.getByTestId('screen-overlay')).toBeVisible();
    // Exercise tutor geometry in the real shared whiteboard canvas, including non-square and portrait displays.
    for (const [width, height] of [
      [1280, 720],
      [1920, 1080],
      [720, 1280],
    ]) {
      await app.evaluate(
        ({ BrowserWindow }, size) => {
          const window = BrowserWindow.getAllWindows().find((w) =>
            w.webContents.getURL().endsWith('#overlay-ink'),
          );
          if (!window) throw new Error('Missing ink window');
          window.setContentSize(size.width, size.height);
          window.webContents.send('screen:state', {
            sequence: 100000 + (size.width === 1280 ? 1 : size.width === 1920 ? 2 : 3),
            status: 'sharing',
            caption: '',
            tutorState: 'listening',
            micOn: true,
            draw: false,
            avatar: {},
            notice: '',
            marks: [
              {
                id: 'circle',
                author: 'tutor',
                kind: 'circle',
                points: [
                  { x: 0.6, y: 0.5 },
                  { x: 0.9, y: 0.7 },
                ],
              },
              {
                id: 'underline',
                author: 'tutor',
                kind: 'underline',
                points: [
                  { x: 0.6, y: 0.72 },
                  { x: 0.9, y: 0.72 },
                ],
              },
            ],
          });
        },
        { width, height },
      );
      await expect(ink.locator('.tl-shape[data-shape-id="shape:screen.circle"]')).toHaveCount(1);
      const measureGeometry = () =>
        ink.evaluate(() => {
          const ellipse = document
            .querySelector('.tl-shape[data-shape-id="shape:screen.circle"]')
            ?.getBoundingClientRect();
          const line = document
            .querySelector('.tl-shape[data-shape-id="shape:screen.underline"]')
            ?.getBoundingClientRect();
          if (!ellipse || !line) throw new Error('Missing marks');
          return {
            width: innerWidth,
            height: innerHeight,
            circle: { x: ellipse.x, y: ellipse.y, width: ellipse.width, height: ellipse.height },
            line: { x: line.x, y: line.y, width: line.width },
          };
        });
      // Both Electron's content resize and tldraw's camera update settle on a render frame.
      await expect
        .poll(async () => {
          const geometry = await measureGeometry();
          return Math.max(
            Math.abs(geometry.circle.x - geometry.width * 0.6),
            Math.abs(geometry.circle.y - geometry.height * 0.5),
            Math.abs(geometry.circle.width - geometry.width * 0.3),
            Math.abs(geometry.circle.height - geometry.height * 0.2),
            Math.abs(geometry.line.x - geometry.width * 0.6),
            Math.abs(geometry.line.y - geometry.height * 0.72),
            Math.abs(geometry.line.width - geometry.width * 0.3),
          );
        })
        .toBeLessThan(1);
    }
    await ink.screenshot({ path: join(dir, 'screen-tutor-geometry.png') });
    // Existing DFA records, layout and custom figures on the same transparent screen canvas.
    const overlaySpec = {
      kind: 'dfa',
      states: [{ id: 'q0' }, { id: 'q1', accept: true }],
      start: 'q0',
      transitions: [
        { from: 'q0', to: 'q0', symbols: ['0'] },
        { from: 'q0', to: 'q1', symbols: ['1'] },
        { from: 'q1', to: 'q1', symbols: ['0', '1'] },
      ],
    };
    const overlayBoard = {
      scene: {
        items: [
          {
            id: 'overlay-dfa',
            kind: 'automaton',
            title: 'Overlay DFA',
            spec: overlaySpec,
            revealed: 'all',
            highlighted: [],
            current: [],
          },
        ],
        focus: null,
        rev: 1,
      },
      layouts: {
        'overlay-dfa': {
          width: 320,
          height: 200,
          states: { q0: { x: 80, y: 110, r: 32 }, q1: { x: 224, y: 110, r: 32 } },
          start: { from: { x: 0, y: 110 }, to: { x: 48, y: 110 } },
          edges: {
            'q0>q0': { bend: 0, loop: 'top', label: { x: 80, y: 34 } },
            'q0>q1': { bend: 0, loop: null, label: { x: 152, y: 98 } },
            'q1>q1': { bend: 0, loop: 'top', label: { x: 224, y: 34 } },
          },
        },
      },
      placements: { 'overlay-dfa': { x: 0.05, y: 0.1, w: 0.85, h: 0.5, color: 'violet' } },
    };
    await app.evaluate(({ BrowserWindow }, board) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith('#overlay-ink'))
        ?.webContents.send('screen:state', {
          sequence: 100010,
          status: 'sharing',
          caption: '',
          tutorState: 'listening',
          micOn: true,
          draw: false,
          avatar: {},
          notice: '',
          board,
          marks: [
            {
              id: 'writing',
              author: 'tutor',
              kind: 'text',
              text: 'On-screen writing',
              color: 'red',
              points: [{ x: 0.1, y: 0.75 }],
            },
          ],
        });
    }, overlayBoard);
    await expect(ink.locator('.tl-shape[data-shape-type="tassel-state"]')).toHaveCount(
      overlaySpec.states.length,
    );
    await expect(ink.getByText('On-screen writing', { exact: true })).toBeVisible();
    const dfaBounds = await ink
      .locator('.tl-shape[data-shape-type="tassel-state"]')
      .first()
      .boundingBox();
    expect(dfaBounds?.x).toBeGreaterThan(0);
    await ink.screenshot({ path: join(dir, 'screen-whiteboard-dfa.png') });
    await app.evaluate(({ BrowserWindow }) => {
      const hudWindow = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith('#overlay-hud'),
      );
      hudWindow?.webContents.send('screen:state', {
        sequence: 200001,
        status: 'sharing',
        caption: 'A long caption that continues onto new lines. '.repeat(60),
        tutorState: 'speaking',
        micOn: true,
        draw: false,
        marks: [],
        avatar: { name: 'Mira' },
        notice: '',
      });
    });
    await expect
      .poll(() => timings.some((value) => value.delivered === true), { timeout: 12000 })
      .toBe(true);
    writeFileSync(join(dir, 'screen-timings.json'), JSON.stringify(timings, null, 2));
    console.log('Synthetic screen timing:', JSON.stringify(timings));
    const caption = hud.locator('.overlay-caption p');
    await expect(caption).toContainText('A long caption');
    await expect
      .poll(() => caption.evaluate((el) => el.scrollTop > 0 && el.scrollHeight > el.clientHeight))
      .toBe(true);
    await caption.evaluate((el) => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event('scroll'));
    });
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith('#overlay-hud'))
        ?.webContents.send('screen:state', {
          sequence: 200002,
          status: 'sharing',
          caption: 'A long caption that continues onto new lines. '.repeat(65),
          tutorState: 'speaking',
          micOn: true,
          draw: false,
          marks: [],
          avatar: { name: 'Mira' },
          notice: '',
        });
    });
    await expect.poll(() => caption.evaluate((el) => el.scrollTop)).toBe(0);
    await hud.screenshot({ path: join(dir, 'screen-overlay-captions.png') });
    await hud.getByRole('button', { name: 'Stop sharing', exact: true }).click();
    await expect.poll(() => app.windows().length).toBe(1);
    await expect(page.getByRole('button', { name: 'Share screen', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
