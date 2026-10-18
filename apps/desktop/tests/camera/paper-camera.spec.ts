// Owner-only real camera check. No screenshot, trace, video, or frame artifacts are saved.
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, type Page, test } from '@playwright/test';
import { withCameraLifetime, withDeadline } from '../../../../scripts/camera-lifecycle.mjs';
import { cameraLaunch } from '../../../../scripts/paper-env.mjs';
import { E2E_SERVER_URL, startPaperSession } from '../e2e/fixtures';
import {
  allocateCdpPort,
  assertCdpOwner,
  captureSessionCreation,
  cleanupCameraRun,
  deleteRunSessions,
} from './support';

test.skip(
  process.env.TASSEL_E2E_CAMERA !== '1' || process.platform !== 'darwin',
  'the real-camera spec runs only with TASSEL_E2E_CAMERA=1 on macOS, with the owner at the Mac',
);
test.setTimeout(120_000);

const appDir = join(__dirname, '..', '..');
const electronApp = join(appDir, 'node_modules', 'electron', 'dist', 'Electron.app');
const mainEntry = join(appDir, 'out', 'main', 'index.js');

async function cdpReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/json/list`, { signal: AbortSignal.timeout(1_000) });
    const targets = (await response.json()) as Array<{ type: string; url: string }>;
    return targets.some((target) => target.type === 'page' && target.url.startsWith('app://'));
  } catch {
    return false;
  }
}

test('her paper on the real Desk View camera, released after the run', async () => {
  const tag = randomUUID();
  await withCameraLifetime(
    async (run) => {
      let userData: string | undefined;
      let token: string | null = null;
      const sessionIds = new Set<string>();
      try {
        userData = mkdtempSync(join(tmpdir(), 'tassel-camera-'));
        const port = await allocateCdpPort();
        const cdpUrl = `http://127.0.0.1:${port}`;
        const launch = cameraLaunch(process.env, {
          electronApp,
          mainEntry,
          serverUrl: E2E_SERVER_URL,
          tag,
          userData,
          cdpPort: port,
        });
        // CameraLifetime uses cross-spawn and installs the child error handler immediately.
        const { child } = run.start(launch.command, launch.args, launch.options);
        await expect
          .poll(
            async () => {
              run.check();
              if (child.exitCode !== null || child.signalCode !== null)
                throw new Error('Camera launch exited');
              return cdpReady(cdpUrl);
            },
            { timeout: 30_000, intervals: [250] },
          )
          .toBe(true);
        // A free port can be claimed between allocation and launch. Check its actual listener,
        // not just an app:// page, before connecting; never close a browser through unverified CDP.
        assertCdpOwner(port, tag);
        const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 5_000 });
        assertCdpOwner(port, tag);
        const context = browser.contexts()[0];
        if (!context) throw new Error('No browser context over CDP');
        await expect.poll(() => context.pages().length).toBeGreaterThan(0);
        const page = context.pages()[0] as Page;
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });

        token = await withDeadline(
          () => page.evaluate(() => window.tassel.getToken()),
          5_000,
          'Read device token',
        );
        if (!token) throw new Error('No device token before camera session');
        await page.route(`${E2E_SERVER_URL}/v1/sessions`, async (route) => {
          if (route.request().method() !== 'POST') {
            await route.continue();
            return;
          }
          const response = await route.fetch({ timeout: 5_000 });
          await captureSessionCreation(response, sessionIds, () => route.fulfill({ response }));
        });
        await startPaperSession(page);
        const video = page.getByTestId('paper-video');
        await expect
          .poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth).catch(() => 0), {
            timeout: 15_000,
          })
          .toBeGreaterThanOrEqual(1280);
        const frames = await withDeadline(
          () =>
            video.evaluate(
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
            ),
          5_000,
          'Count video frames',
        );
        expect(frames).toBeGreaterThanOrEqual(30);
      } finally {
        await cleanupCameraRun({
          deleteFrames: async () => {
            if (token) await deleteRunSessions(E2E_SERVER_URL, token, sessionIds);
          },
          // Tagged SIGTERM + bounded SIGKILL release the app/helper even when CDP is broken.
          // No Browser.close is sent to an endpoint that might now belong to another run.
          shutdown: run.shutdown,
          removeUserData: () => {
            if (userData) rmSync(userData, { recursive: true, force: true, maxRetries: 5 });
          },
        });
      }
    },
    { tag },
  );
});
