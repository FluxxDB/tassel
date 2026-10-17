// The Desk View helper on a clip (Task 13, macOS only): TASSEL_HELPER_CLIP makes the real helper
// stream the generated dfa-short clip instead of opening the camera, so the whole helper path
// runs (spawn, token, WebSocket, frames, canvas feed, detector, upload) with no camera. Ending
// the session releases the helper (Review Focus 2).

import { expect, type Page, test } from '@playwright/test';
import spawn from 'cross-spawn';
import {
  framesOf,
  latestSession,
  launchApp,
  startPaperSession,
  watchPaperConsole,
} from './fixtures';

test.skip(process.platform !== 'darwin', 'the Desk View helper is macOS-only');
test.setTimeout(90_000);

const videoSize = (page: Page) =>
  page
    .getByTestId('paper-video')
    .evaluate((video: HTMLVideoElement) => [video.videoWidth, video.videoHeight]);

/** The pids of the app's own deskview-helper children. */
function helperChildren(appPid: number): string[] {
  const result = spawn.sync('pgrep', ['-P', String(appPid), 'deskview-helper'], {
    encoding: 'utf8',
  });
  return result.stdout.trim().split('\n').filter(Boolean);
}

test('streams the helper clip, uploads from it, and the helper exits after End session', async () => {
  const clip = process.env.TASSEL_E2E_CLIP_DFA_SHORT ?? '';
  const { app, page } = await launchApp({
    TASSEL_PAPER_SOURCE: 'deskview-helper',
    TASSEL_HELPER_CLIP: clip,
  });
  const problems = watchPaperConsole(page);
  const pid = app.process().pid;
  if (pid === undefined) throw new Error('The app has no pid');
  await startPaperSession(page);

  // 1. Live through the helper, at the clip's size.
  await expect.poll(() => videoSize(page), { timeout: 15_000 }).toEqual([960, 720]);
  expect(helperChildren(pid)).toHaveLength(1);

  // 2. The clip's first stroke uploads, from the helper.
  const session = await latestSession(page);
  await expect
    .poll(async () => (await framesOf(page, session.id)).length, { timeout: 40_000 })
    .toBeGreaterThan(0);
  const [first] = await framesOf(page, session.id);
  expect(first).toMatchObject({ seq: 1, source: 'deskview-helper', width: 960, height: 720 });

  // 3. End session, confirmed: within 2 s the helper is gone.
  await page
    .getByRole('group', { name: 'Session controls' })
    .getByRole('button', { name: 'End session' })
    .click();
  await page
    .getByRole('dialog', { name: 'End this session?' })
    .getByRole('button', { name: 'End session' })
    .click();
  const endedAt = Date.now();
  await expect.poll(() => helperChildren(pid), { timeout: 2_000, intervals: [100] }).toEqual([]);
  expect(Date.now() - endedAt).toBeLessThan(2_000);
  await app.close();
  expect(problems).toEqual([]);
});
