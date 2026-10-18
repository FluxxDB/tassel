// The real Desk View camera (Task 14). Opt-in: TASSEL_E2E_CAMERA=1 on macOS, with the owner at
// the Mac. Tassel is launched through LaunchServices, so macOS uses Electron's own camera grant
// (Task 1's checks H and E), and Playwright attaches over CDP once the page has loaded.
// It takes no screenshot and keeps no frame or trace; deleting the session removes every frame
// it uploaded from the local store.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, chromium, expect, type Page, test } from '@playwright/test';
import { callApi, E2E_SERVER_URL, latestSession, startPaperSession } from '../e2e/fixtures';

test.skip(
  process.env.TASSEL_E2E_CAMERA !== '1' || process.platform !== 'darwin',
  'the real-camera spec runs only with TASSEL_E2E_CAMERA=1 on macOS, with the owner at the Mac',
);
test.setTimeout(120_000);

const appDir = join(__dirname, '..', '..');
const electronApp = join(appDir, 'node_modules', 'electron', 'dist', 'Electron.app');
const mainEntry = join(appDir, 'out', 'main', 'index.js');
const CDP_PORT = 9334;
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;

/** The processes whose command line carries the run's tag: the helper and this Electron. */
const tagged = (tag: string) =>
  spawnSync('pgrep', ['-f', tag], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);

async function cdpReady(): Promise<boolean> {
  try {
    const response = await fetch(`${CDP_URL}/json/list`, { signal: AbortSignal.timeout(1_000) });
    const targets = (await response.json()) as Array<{ type: string; url: string }>;
    return targets.some((target) => target.type === 'page' && target.url.startsWith('app://'));
  } catch {
    return false;
  }
}

test('her paper on the real Desk View camera, released after the run', async () => {
  const tag = randomUUID();
  const userData = mkdtempSync(join(tmpdir(), 'tassel-camera-'));
  const env = {
    TASSEL_SERVER_URL: E2E_SERVER_URL,
    TASSEL_TOKEN_STORE: 'file',
    TASSEL_USER_DATA: userData,
    TASSEL_PAPER_SOURCE: 'auto',
    TASSEL_HELPER_TAG: tag,
  };
  const open = spawn(
    'open',
    [
      '-n',
      '-W',
      '-a',
      electronApp,
      ...Object.entries(env).flatMap(([name, value]) => ['--env', `${name}=${value}`]),
      '--args',
      mainEntry,
      `--remote-debugging-port=${CDP_PORT}`,
      `--tassel-camera-run=${tag}`,
    ],
    { stdio: 'ignore' },
  );
  let browser: Browser | null = null;
  let page: Page | null = null;
  let sessionId: string | null = null;
  try {
    // Attach once the page has loaded: pages without a renderer are dropped while connecting.
    await expect.poll(cdpReady, { timeout: 30_000, intervals: [250] }).toBe(true);
    browser = await chromium.connectOverCDP(CDP_URL);
    const context = browser.contexts()[0];
    if (!context) throw new Error('No browser context over CDP');
    await expect.poll(() => context.pages().length).toBeGreaterThan(0);
    page = context.pages()[0] as Page;
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });

    await startPaperSession(page);
    sessionId = (await latestSession(page)).id;
    const video = page.getByTestId('paper-video');
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth).catch(() => 0), {
        timeout: 15_000,
      })
      .toBeGreaterThanOrEqual(1280);
    // Frames keep coming: at least 30 in 3 s (the helper sends 15 a second).
    const frames = await video.evaluate(
      (v: HTMLVideoElement) =>
        new Promise<number>((resolve) => {
          let count = 0;
          const tick = () => {
            count += 1;
            v.requestVideoFrameCallback(tick);
          };
          v.requestVideoFrameCallback(tick);
          setTimeout(() => resolve(count), 3_000);
        }),
    );
    expect(frames).toBeGreaterThanOrEqual(30);
  } finally {
    if (page && sessionId) {
      const deleted = await callApi(page, `/v1/sessions/${sessionId}`, { method: 'DELETE' });
      expect(deleted.status).toBe(204);
    }
    if (browser) {
      // Browser.close takes the connection down with the app, so its answer may never come.
      const cdp = await browser.newBrowserCDPSession().catch(() => null);
      void cdp?.send('Browser.close').catch(() => {});
    }
    // Whatever is left of this run: the app, by its tag on the command line.
    await new Promise((resolve) => setTimeout(resolve, 500));
    spawnSync('pkill', ['-f', '--', `--tassel-camera-run=${tag}`]);
    // `open -W` only waits for the app; it carries the tag too, so it goes first.
    open.kill();
    const closedAt = Date.now();
    await expect.poll(() => tagged(tag), { timeout: 2_000, intervals: [100] }).toEqual([]);
    expect(Date.now() - closedAt).toBeLessThan(2_000);
    rmSync(userData, { recursive: true, force: true, maxRetries: 5 });
  }
});
