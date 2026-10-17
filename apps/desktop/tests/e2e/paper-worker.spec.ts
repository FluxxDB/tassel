// The change-detector worker in Electron, before the paper view uses it (Task 12):
// - under the renderer's dev server, as `pnpm dev` serves it (re-review N3: a module worker,
//   since the dev server serves worker.ts unbundled, with ES imports);
// - built for production and loaded from app://tassel, under P1's unchanged page CSP.
// Each runs the detector on a canvas stream of a white page on a desk, and waits until OpenCV is
// ready in the worker and its page finder has found the page. No camera is involved.
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { resolveConfig } from 'electron-vite';
import { build, createServer } from 'vite';
import { launchApp } from './fixtures';

const appDir = join(__dirname, '..', '..');
const probeDir = join(appDir, 'out', 'renderer', 'paper-probe');

interface Run {
  stats: number;
  opencv: boolean;
  quad: Array<{ x: number; y: number }> | null;
  errors: string[];
}

/** Starts the detector in the page from `moduleUrl`, on a drawn page, until it finds the page. */
function runDetector(page: Page, moduleUrl: string): Promise<Run> {
  return page.evaluate(async (url) => {
    const { createChangeDetector } = (await import(
      url
    )) as typeof import('../../src/renderer/src/paper/detector/client');
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2D context');
    let tick = 0;
    // A white page on a desk; one corner pixel flickers so the stream keeps sending frames.
    const draw = () => {
      ctx.fillStyle = '#cdc4b6';
      ctx.fillRect(0, 0, 960, 720);
      ctx.fillStyle = '#fbfaf6';
      ctx.fillRect(80, 60, 800, 600);
      ctx.fillStyle = tick++ % 2 ? '#cdc4b6' : '#ccc3b5';
      ctx.fillRect(0, 0, 1, 1);
    };
    draw();
    const timer = setInterval(draw, 50);
    const stream = canvas.captureStream(20);
    const run: Run = { stats: 0, opencv: false, quad: null, errors: [] };
    try {
      await new Promise<void>((resolve, reject) => {
        const deadline = setTimeout(
          () => reject(new Error(`no page found in time: ${JSON.stringify(run)}`)),
          60_000,
        );
        const detector = createChangeDetector(stream, {
          onStats: (stats) => {
            run.stats++;
            run.opencv ||= stats.opencv;
            if (stats.quad) run.quad = stats.quad;
            if (stats.opencv && stats.quad) {
              clearTimeout(deadline);
              detector.stop();
              resolve();
            }
          },
          onTrigger: () => {},
          onError: (message) => run.errors.push(message),
        });
      });
    } finally {
      clearInterval(timer);
      for (const track of stream.getTracks()) track.stop();
    }
    return run;
  }, moduleUrl);
}

/** Console lines about a policy refusing something, from the page and its workers. */
function watchViolations(page: Page): string[] {
  const violations: string[] = [];
  const watch = (text: string) => {
    if (/content security policy|refused to/i.test(text)) violations.push(text);
  };
  page.on('console', (message) => watch(message.text()));
  page.on('worker', (worker) => worker.on('console', (message) => watch(message.text())));
  return violations;
}

/** The found quad is the drawn page, (80, 60)–(880, 660), within 4 px at each corner. */
function expectThePage(quad: Run['quad']) {
  const drawn = [
    { x: 80, y: 60 },
    { x: 880, y: 60 },
    { x: 880, y: 660 },
    { x: 80, y: 660 },
  ];
  expect(quad).toHaveLength(4);
  quad?.forEach((corner, i) => {
    const want = drawn[i] ?? { x: 0, y: 0 };
    expect(Math.hypot(corner.x - want.x, corner.y - want.y)).toBeLessThanOrEqual(4);
  });
}

test('the change detector runs as a module worker under the renderer dev server (pnpm dev)', async () => {
  test.setTimeout(180_000);
  const resolved = await resolveConfig({ root: appDir }, 'serve', 'development');
  const renderer = resolved.config?.renderer ?? {};
  const server = await createServer({
    ...renderer,
    server: { ...renderer.server, host: '127.0.0.1', port: 0, strictPort: false },
    logLevel: 'error',
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  try {
    expect(url).toBeTruthy();
    const { app, page } = await launchApp({ ELECTRON_RENDERER_URL: url ?? '' });
    try {
      const violations = watchViolations(page);
      expect(page.url()).toBe(url);
      const run = await runDetector(page, '/src/paper/detector/client.ts');
      expect(run.errors).toEqual([]);
      expect(run.opencv).toBe(true);
      expectThePage(run.quad);
      // The dev page has its own preamble to argue with; nothing the worker did may be refused.
      expect(violations.filter((v) => /worker|wasm|webassembly|eval/i.test(v))).toEqual([]);
    } finally {
      await app.close();
    }
  } finally {
    await server.close();
  }
});

test('the built change detector worker runs from app://tassel under the page’s unchanged CSP', async () => {
  test.setTimeout(180_000);
  const resolved = await resolveConfig({ root: appDir }, 'build', 'production');
  const renderer = resolved.config?.renderer ?? {};
  rmSync(probeDir, { recursive: true, force: true });
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
          input: { probe: join(appDir, 'tests', 'e2e', 'paper', 'detector-probe.ts') },
          // An app build drops an entry's exports; the probe is nothing but its export.
          preserveEntrySignatures: 'exports-only',
          output: { format: 'es', entryFileNames: '[name].js' },
        },
      },
    });
    // The build emits the worker as its own chunk, and OpenCV with it.
    const assets = readdirSync(join(probeDir, 'assets'));
    expect(assets.some((name) => /^worker-.*\.js$/.test(name))).toBe(true);
    const total = assets.reduce(
      (sum, name) => sum + statSync(join(probeDir, 'assets', name)).size,
      0,
    );
    expect(total).toBeGreaterThan(8_000_000);
    expect(existsSync(join(probeDir, 'probe.js'))).toBe(true);

    const { app, page } = await launchApp();
    try {
      const violations = watchViolations(page);
      expect(page.url()).toBe('app://tassel/index.html');
      const run = await runDetector(page, 'app://tassel/paper-probe/probe.js');
      expect(run.errors).toEqual([]);
      expect(run.opencv).toBe(true);
      expectThePage(run.quad);
      expect(violations).toEqual([]);
      // The page's CSP is P1's, untouched: no eval for the page itself.
      const meta = await page.evaluate(
        () =>
          document
            .querySelector('meta[http-equiv="Content-Security-Policy"]')
            ?.getAttribute('content') ?? '',
      );
      expect(meta).toContain("script-src 'self';");
      expect(meta).not.toMatch(/unsafe-eval|wasm-unsafe-eval/);
    } finally {
      await app.close();
    }
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
});
