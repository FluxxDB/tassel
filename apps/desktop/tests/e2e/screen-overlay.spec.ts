import { mkdirSync } from 'node:fs';
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
    hud.on('pageerror', (error) => errors.push(error.message));
    ink.on('pageerror', (error) => errors.push(error.message));
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
    await hud.getByRole('button', { name: 'Draw', exact: true }).click();
    await expect(ink.getByTestId('screen-drawing')).toHaveClass(/is-drawing/);
    await ink.mouse.move(150, 130);
    await ink.mouse.down();
    await ink.mouse.move(220, 170, { steps: 8 });
    await ink.mouse.up();
    await expect(ink.locator('polyline')).toHaveCount(1);
    await hud.getByRole('button', { name: 'Reset annotations', exact: true }).click();
    await expect(ink.locator('polyline')).toHaveCount(0);
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
    await page.getByRole('button', { name: 'Share screen', exact: true }).click();
    await expect(hud.getByTestId('screen-overlay')).toBeVisible();
    // Exercise tutor geometry in real SVG layout, including non-square and portrait displays.
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
      await expect(ink.locator('ellipse')).toHaveCount(1);
      const geometry = await ink.evaluate(() => {
        const ellipse = document.querySelector('ellipse')?.getBoundingClientRect();
        const line = document.querySelector('polyline')?.getBoundingClientRect();
        if (!ellipse || !line) throw new Error('Missing marks');
        return {
          width: innerWidth,
          height: innerHeight,
          circle: { x: ellipse.x, y: ellipse.y, width: ellipse.width, height: ellipse.height },
          line: { x: line.x, y: line.y, width: line.width },
        };
      });
      expect(geometry.circle.x).toBeCloseTo(geometry.width * 0.6, 1);
      expect(geometry.circle.y).toBeCloseTo(geometry.height * 0.5, 1);
      expect(geometry.circle.width).toBeCloseTo(geometry.width * 0.3, 1);
      expect(geometry.circle.height).toBeCloseTo(geometry.height * 0.2, 1);
      expect(geometry.line.x).toBeCloseTo(geometry.width * 0.6, 1);
      expect(geometry.line.y).toBeCloseTo(geometry.height * 0.72, 1);
      expect(geometry.line.width).toBeCloseTo(geometry.width * 0.3, 1);
    }
    await ink.screenshot({ path: join(dir, 'screen-tutor-geometry.png') });
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
