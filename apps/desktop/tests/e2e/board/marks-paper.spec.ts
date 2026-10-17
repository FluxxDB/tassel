// No live input: seed one P3 synthetic frame, then send its real server-generated freeze
// through a test-only bundled entry. P2's provider pipeline is intentionally outside this test.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { BeatAction } from '@tassel/shared/beats';
import spawn from 'cross-spawn';
import { resolveConfig } from 'electron-vite';
import { build } from 'vite';
import { callApi, E2E_SERVER_URL, launchApp, setWindowSize, snap } from '../fixtures';

const appDir = join(__dirname, '../../..');
const repoDir = join(appDir, '../..');
const probeDir = join(appDir, 'out/renderer/marks-paper-probe');
const prepare = `
import base64, json, uuid
from datetime import datetime, UTC
from tassel.beats.markup import BoardContext, parse_command
from tassel.frames.tables import Frame
from tassel.vision.clips import ensure_clip, frame_at
from tassel.vision.turn_image import _page_view
jpeg = frame_at(ensure_clip('dfa-demo').mjpeg, 47100)
row = Frame(id=uuid.uuid4(), captured_at=datetime(2026, 10, 17, tzinfo=UTC), meta={})
view = _page_view(jpeg, row)
assert view is not None
ctx = BoardContext()
view.set_context(ctx)
print(json.dumps({'jpeg': base64.b64encode(jpeg).decode(),
                  'freeze': parse_command('freeze', ctx).model_dump(mode='json')}))
`;

test('Ada marks the stored flattened paper at two window sizes', async () => {
  test.setTimeout(180_000);
  const generated = spawn.sync(
    'uv',
    ['run', '--directory', join(repoDir, 'services/server'), 'python', '-c', prepare],
    { encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
  );
  expect(generated.status, generated.stderr).toBe(0);
  const input = JSON.parse(generated.stdout) as {
    jpeg: string;
    freeze: Extract<BeatAction, { kind: 'paper.freeze' }>;
  };
  const renderer =
    (await resolveConfig({ root: appDir }, 'build', 'production')).config?.renderer ?? {};
  try {
    await build({
      ...renderer,
      logLevel: 'error',
      build: {
        ...renderer.build,
        outDir: probeDir,
        emptyOutDir: true,
        copyPublicDir: false,
        rollupOptions: {
          input: { probe: join(__dirname, 'paper-probe.tsx') },
          preserveEntrySignatures: 'exports-only',
          output: { format: 'es', entryFileNames: '[name].js' },
        },
      },
    });
    const { app, page } = await launchApp();
    try {
      const created = await callApi(page, '/v1/sessions', {
        method: 'POST',
        body: JSON.stringify({ type: 'homework', language: 'en', source: 'paper' }),
      });
      expect(created.status).toBe(201);
      const sessionId = (await created.json()).id as string;
      const token = await page.evaluate(() => window.tassel.getToken());
      const form = new FormData();
      form.append(
        'frame',
        new Blob([Buffer.from(input.jpeg, 'base64')], { type: 'image/jpeg' }),
        'page.jpg',
      );
      form.append(
        'meta',
        JSON.stringify({
          reason: 'page',
          source: 'fake-clip',
          captured_at: '2026-10-17T00:00:00Z',
          page_found: false,
          page_quad: null,
          crop_rect: null,
          mask: null,
          detector: { changed_cells: 0, ink_pixels: 0, erase_pixels: 0, version: 'p3.1' },
        }),
      );
      const uploaded = await fetch(`${E2E_SERVER_URL}/v1/sessions/${sessionId}/frames`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      expect(uploaded.status).toBe(201);
      const stored = await uploaded.json();
      input.freeze.frame = { kind: 'paper', id: stored.id, capturedAt: stored.captured_at };
      await page.evaluate(
        async ({ url, sessionId, freeze }) => {
          const moduleUrl = 'app://tassel/marks-paper-probe/probe.js';
          const probe = await import(moduleUrl);
          await probe.showPaper(url, sessionId, freeze);
        },
        { url: E2E_SERVER_URL, sessionId, freeze: input.freeze },
      );
      const detected = input.freeze.elements?.detected;
      if (!detected) throw new Error('no candidate geometry');
      const candidate = detected.items.find((item) => item.id === 'm1');
      if (!candidate) throw new Error('no first state circle');
      for (const [w, h] of [
        [1440, 900],
        [1024, 680],
      ]) {
        await setWindowSize(app, page, w, h);
        const image = page.getByTestId('snapshot-image');
        await expect(image).toBeVisible();
        await expect
          .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth))
          .toBe(detected.width);
        await expect(page.getByTestId('mark-circle-real-paper')).toBeVisible();
        await expect
          .poll(async () => {
            const img = await image.boundingBox();
            const ring = await page.getByTestId('mark-circle-real-paper').boundingBox();
            if (!img || !ring) return false;
            const scale = img.width / detected.width;
            const box = candidate.box;
            return (
              ring.x <= img.x + box.x * scale &&
              ring.y <= img.y + box.y * scale &&
              ring.x + ring.width >= img.x + (box.x + box.w) * scale &&
              ring.y + ring.height >= img.y + (box.y + box.h) * scale
            );
          })
          .toBe(true);
      }
      await snap(page, 'vision-lite-paper-1024');
    } finally {
      await app.close();
    }
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
});
