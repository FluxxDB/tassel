// The paper panel's states in the running app (Task 13), in the UI's language: a camera Tassel
// may not use, and a Mac with no Desk View helper, from which she shares the Desk View window
// instead. The capture guard keeps both fake: denied access never starts the helper, the helper
// path doesn't exist, and window sharing captures the app's own window.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import {
  catalogText,
  launchApp,
  settle,
  snap,
  startPaperSession,
  watchPaperConsole,
} from './fixtures';

const videoSize = (page: Page) =>
  page
    .getByTestId('paper-video')
    .evaluate((video: HTMLVideoElement) => [video.videoWidth, video.videoHeight]);

test("denied: Tassel can't use the camera, and Open System Settings asks the main process (es)", async () => {
  const { app, page } = await launchApp({
    TASSEL_PAPER_SOURCE: 'deskview-helper',
    TASSEL_FAKE_CAMERA_ACCESS: 'denied',
    TASSEL_UI_LANG: 'es',
  });
  const problems = watchPaperConsole(page);
  const mainLog: string[] = [];
  app.on('console', (message) => mainLog.push(message.text()));
  await startPaperSession(page, { uiLang: 'es', language: 'es' });

  const region = page.getByRole('region', { name: 'Tu papel · Desk View' });
  const card = region.getByRole('status');
  await expect(card).toContainText('Tassel no puede usar la cámara');
  await expect(card.getByRole('button')).toHaveText([
    'Abrir Configuración del Sistema',
    catalogText('es', 'common.retry'),
  ]);
  // The dot stays neutral: nothing is captured.
  await expect(page.getByRole('banner').getByText('Desk View', { exact: true })).toBeVisible();
  await settle(page);
  await snap(page, 'p3-paper-denied-es');

  await card.getByRole('button', { name: 'Abrir Configuración del Sistema' }).click();
  // A fake (and an agent's run) never opens System Settings: main logs it instead.
  await expect.poll(() => mainLog).toContain('[tassel] fake: open camera settings');
  await app.close();
  expect(problems).toEqual([]);
});

test('unavailable: no Desk View camera, then she shares the Desk View window instead (ko)', async () => {
  const { app, page } = await launchApp({
    TASSEL_PAPER_SOURCE: 'deskview-helper',
    // A helper that doesn't exist: on macOS the supervisor answers missing-binary (under
    // requireFake without a clip, unsupported), and off macOS unsupported.
    TASSEL_DESKVIEW_HELPER: join(tmpdir(), 'tassel-e2e-no-helper', 'deskview-helper'),
    TASSEL_FAKE_CAMERA_ACCESS: 'granted',
    TASSEL_FAKE_DISPLAY: 'self',
    TASSEL_UI_LANG: 'ko',
  });
  const problems = watchPaperConsole(page);
  await startPaperSession(page, { uiLang: 'ko', language: 'ko' });

  const region = page.getByRole('region', { name: '내 종이 · Desk View' });
  const card = region.getByRole('status');
  await expect(card).toContainText('Desk View 카메라를 찾지 못했어요');
  await expect(card.getByRole('button')).toHaveText([
    'Desk View 설정 열기',
    '대신 Desk View 창 공유하기',
  ]);
  await settle(page);
  await snap(page, 'p3-paper-unavailable-ko');

  await card.getByRole('button', { name: '대신 Desk View 창 공유하기' }).click();
  const shared = page.getByRole('region', { name: '내 종이 · Desk View 창' });
  await expect(shared.getByTestId('paper-video')).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await videoSize(page))[0] ?? 0).toBeGreaterThan(0);
  await expect(shared.getByText('내 종이 · Desk View 창', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('banner').getByText(catalogText('ko', 'session.liveSource.paper')),
  ).toBeVisible();
  await app.close();
  expect(problems).toEqual([]);
});
