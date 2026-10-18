import { expect, type Page, test } from '@playwright/test';
import { launchApp, settle, snap } from '../fixtures';
import { hasTldrawKey } from './tldraw-key';

// The same assertions can exercise the localhost dev renderer past the license window.
const dev = process.env.TASSEL_E2E_RENDERER_URL;
async function launch() {
  const launched = await launchApp({
    TASSEL_FAKE_SCRIPT: 'trace-demo',
    TASSEL_FAKE_SPEED: '1',
    ...(dev ? { ELECTRON_RENDERER_URL: dev } : {}),
  });
  await launched.app
    .context()
    .route('https://cdn.tldraw.com/**', (route) =>
      route.fulfill({ contentType: 'image/svg+xml', body: '<svg/>' }),
    );
  return launched;
}
async function start(page: Page, lang = 'English') {
  await page.getByRole('banner').getByRole('button', { name: 'New session' }).click();
  const sheet = page.getByRole('dialog', { name: 'New session' });
  await sheet.getByRole('radio', { name: lang, exact: true }).click();
  await sheet.getByRole('button', { name: 'Start session' }).click();
}
async function paperDone(page: Page) {
  const edges = ['edge:q0>q0', 'edge:q0>q1', 'edge:q1>q2', 'edge:q2>q3'];
  for (const [i, edge] of edges.entries()) {
    const dot = page.getByTestId(`trace-dot-${i + 1}`);
    await expect(dot).toHaveText(String(i + 1), { timeout: 20_000 });
    await expect(dot).toHaveAttribute('data-edge', edge);
  }
  await expect(page.getByTestId('trace-ring-q3')).toBeVisible();
  await expect(page.getByTestId('trace-ring-q0')).toHaveCount(0);
  await settle(page);
  const dot = await page.getByTestId('trace-dot-2').boundingBox();
  const edge = await page.locator('[data-ink="edge:q0>q1"]').boundingBox();
  expect(dot && edge && dot.y > edge.y + edge.height).toBe(true);
  const ring = await page.getByTestId('trace-ring-q3').boundingBox();
  const state = await page.locator('[data-ink="state:q3"]').boundingBox();
  expect(
    ring && state && Math.abs(ring.x + ring.width / 2 - state.x - state.width / 2),
  ).toBeLessThan(1);
}

test('paper trace follows the ink and finishes without running animations', async () => {
  const { app, page } = await launch();
  try {
    await start(page);
    await paperDone(page);
    await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
    await snap(page, 'p5-trace-paper');
  } finally {
    await app.close();
  }
});

test('board trace reads four rows, rejects, and rings qd', async () => {
  const { app, page } = await launch();
  try {
    await start(page);
    // P5-R6: the store's account is checked even in a keyless build.
    const description = page.getByRole('list', { name: "What's on Ada's board" });
    await expect(description).toContainText('This DFA: reject', { timeout: 20_000 });
    await expect(description).toContainText('Step 4');
    await expect(page.getByTestId('board-canvas')).toHaveAttribute(
      'data-layout',
      /graphviz|fallback/,
    );
    test.skip(!dev && !hasTldrawKey(), 'needs TLDRAW_LICENSE_KEY (P5-R2)');
    await expect(page.getByTestId('trace-verdict')).toHaveText('This DFA: reject', {
      timeout: 20000,
    });
    const rows = page.getByTestId('trace-row');
    await expect(rows).toHaveCount(4);
    for (const text of ['Step 4', 'read 0', 'qd → qd', 'loops'])
      await expect(rows.last()).toContainText(text);
    await expect(page.getByRole('img', { name: 'qd', exact: true })).toHaveAttribute(
      'data-ring',
      'current',
    );
    await expect(page.locator('[data-testid="trace-cell"][data-reading="true"]')).toHaveText('0');
    await settle(page);
    await snap(page, 'p5-trace-board');
  } finally {
    await app.close();
  }
});

for (const [lang, step, read] of [
  ['Español', 'Paso 1', 'lee 1'],
  ['한국어', '1단계', '1 읽음'],
]) {
  test(`trace rows fit in a ${lang} session`, async () => {
    const { app, page } = await launch();
    try {
      await start(page, lang);
      const description = page.getByRole('list', {
        name: lang === '한국어' ? 'Ada의 보드에 있는 것' : 'Lo que hay en la pizarra de Ada',
      });
      await expect(description).toContainText(
        lang === '한국어' ? '이 DFA: 거부' : 'Este AFD: rechaza',
        { timeout: 20_000 },
      );
      await expect(page.getByTestId('board-canvas')).toHaveAttribute(
        'data-layout',
        /graphviz|fallback/,
      );
      test.skip(!dev && !hasTldrawKey(), 'needs TLDRAW_LICENSE_KEY (P5-R2)');
      await expect(page.getByTestId('trace-row')).toHaveCount(4, { timeout: 20000 });
      await expect(page.getByTestId('trace-row').first()).toContainText(step);
      await expect(page.getByTestId('trace-row').first()).toContainText(read);
      await settle(page);
      expect(
        await page
          .getByTestId('trace-row')
          .evaluateAll((rows) => rows.every((row) => row.scrollWidth <= row.clientWidth)),
      ).toBe(true);
      if (lang === '한국어') await snap(page, 'p5-trace-ko');
    } finally {
      await app.close();
    }
  });
}

test('reduced motion shows final paper marks without starting animations', async () => {
  const { app, page } = await launch();
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => {
      const seen: string[] = [];
      Object.assign(window, { traceAnimations: seen });
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        if (this.closest('[data-testid="paper-snapshot"], [data-testid="board-canvas"]'))
          seen.push('WAAPI');
        return animate.apply(this, args);
      };
      document.addEventListener(
        'animationstart',
        (event) => {
          if (
            event.target instanceof Element &&
            event.target.closest('[data-testid="paper-snapshot"], [data-testid="board-canvas"]')
          )
            seen.push((event as AnimationEvent).animationName);
        },
        true,
      );
    });
    await start(page);
    await paperDone(page);
    expect(
      await page.evaluate(
        () => (window as unknown as { traceAnimations: string[] }).traceAnimations,
      ),
    ).toEqual([]);
    // Board assertions need a valid build license, while the paper check always runs.
    if (dev || hasTldrawKey()) {
      await expect(page.getByTestId('trace-row')).toHaveCount(4);
      await expect(page.getByRole('img', { name: 'qd', exact: true })).toHaveAttribute(
        'data-ring',
        'current',
      );
    }
  } finally {
    await app.close();
  }
});
