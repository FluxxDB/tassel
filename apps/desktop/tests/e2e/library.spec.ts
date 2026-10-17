import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { E2E_SERVER_URL, launchApp, settle, setWindowSize, snap } from './fixtures';

interface Seed {
  create: { type: string; language: string; source: string };
  patch?: { title: string; subject: string };
}

// Seeded oldest first, so Recent activity lists them in reverse.
const SEEDS: Seed[] = [
  {
    create: { type: 'homework', language: 'en', source: 'paper' },
    patch: { title: 'Strings that start with 010', subject: 'Automata · DFA' },
  },
  {
    create: { type: 'studying', language: 'es', source: 'screen' },
    patch: {
      title: 'Derivadas de funciones compuestas con la regla de la cadena, paso a paso',
      subject: 'Cálculo',
    },
  },
  { create: { type: 'research', language: 'ko', source: 'talk' } },
];

/** Creates sessions for the app's learner through the API, with its own device token. */
async function seed(page: Page, seeds: Seed[]): Promise<void> {
  const token = await page.evaluate(() => window.tassel.getToken());
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  for (const { create, patch } of seeds) {
    const created = await fetch(`${E2E_SERVER_URL}/v1/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(create),
    });
    expect(created.status).toBe(201);
    if (!patch) continue;
    const { id } = (await created.json()) as { id: string };
    const patched = await fetch(`${E2E_SERVER_URL}/v1/sessions/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(patch),
    });
    expect(patched.status).toBe(200);
  }
}

const cardsOf = (page: Page) =>
  page.getByRole('list', { name: 'Your sessions' }).getByRole('listitem');

test('shows the sessions seeded through the API as cards', async () => {
  const { app, page } = await launchApp();
  // A fresh learner starts with an empty library.
  await expect(page.getByRole('region', { name: 'No sessions yet' })).toBeVisible();
  await seed(page, SEEDS);
  await page.reload();

  const cards = cardsOf(page);
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('Untitled Session');
  await expect(cards.nth(1)).toContainText('Derivadas de funciones compuestas');
  await expect(cards.nth(2)).toContainText('Strings that start with 010');
  await settle(page);
  await snap(page, 'p1-library');
  await app.close();
});

test('groups by topic, and searches titles and topics', async () => {
  const { app, page } = await launchApp();
  await expect(page.getByRole('region', { name: 'No sessions yet' })).toBeVisible();
  await seed(page, SEEDS);
  await page.reload();
  await expect(cardsOf(page)).toHaveCount(3);

  await page.getByRole('radio', { name: 'Topic' }).click();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    'Automata · DFA',
    'Cálculo',
    'No topic',
  ]);
  await settle(page);
  await snap(page, 'p1-library-topic');

  await page.getByRole('radio', { name: 'Recent activity' }).click();
  const search = page.getByRole('searchbox', { name: 'Search sessions' });
  await search.fill('cálc');
  await expect(cardsOf(page)).toHaveCount(1);
  await expect(cardsOf(page)).toContainText('Derivadas');
  await search.fill('zzz');
  const noResults = page.getByRole('region', { name: 'No sessions match “zzz”' });
  await expect(noResults).toBeVisible();
  await settle(page);
  await snap(page, 'p1-library-no-results');
  await noResults.getByRole('button', { name: 'Clear search' }).click();
  await expect(cardsOf(page)).toHaveCount(3);
  await app.close();
});

test('moves by keyboard from the search through New session and the sort to a card', async () => {
  const { app, page } = await launchApp();
  await expect(page.getByRole('region', { name: 'No sessions yet' })).toBeVisible();
  await seed(page, SEEDS.slice(0, 1));
  await page.reload();
  await expect(cardsOf(page)).toHaveCount(1);

  await page.getByRole('searchbox', { name: 'Search sessions' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'New session' })).toBeFocused();
  await page.keyboard.press('Tab');
  const selected = page.getByRole('radio', { name: 'Recent activity' });
  await expect(selected).toBeFocused();
  // The ring keeps a 2px gap around the selected ink pill (Task 10, design C1).
  await expect(selected).toHaveCSS('outline-style', 'solid');
  await expect(selected).toHaveCSS('outline-offset', '2px');
  await page.keyboard.press('Tab');
  const card = page.getByRole('button', { name: 'Strings that start with 010' });
  await expect(card).toBeFocused();
  await expect(card).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Your sessions' })).toBeHidden();
  await app.close();
});

test('fits Spanish at the smallest window without scrolling sideways', async () => {
  const { app, page } = await launchApp({ TASSEL_UI_LANG: 'es' });
  await expect(page.getByRole('region', { name: 'Todavía no hay sesiones' })).toBeVisible();
  await seed(page, SEEDS);
  await page.reload();
  await setWindowSize(app, page, 1024, 680);
  await expect(page.getByRole('list', { name: 'Tus sesiones' }).getByRole('listitem')).toHaveCount(
    3,
  );

  // Every sort label fits its segment, and nothing scrolls sideways.
  const segments = page.getByRole('radiogroup', { name: 'Ordenar sesiones' }).getByRole('radio');
  await expect(segments).toHaveCount(3);
  for (const segment of await segments.all()) {
    expect(await segment.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  const sideways = await page.evaluate(() => {
    const main = document.querySelector('main');
    return {
      page: document.documentElement.scrollWidth > window.innerWidth,
      main: main ? main.scrollWidth > main.clientWidth : true,
    };
  });
  expect(sideways).toEqual({ page: false, main: false });
  await settle(page);
  await snap(page, 'p1-library-es-1024');
  await app.close();
});

test('shows a recoverable error when the server is down', async () => {
  const { app, page } = await launchApp({ TASSEL_SERVER_URL: 'http://127.0.0.1:1' });
  const alert = page.getByRole('alert');
  await expect(
    alert.getByRole('heading', { name: "Couldn't reach Tassel's server" }),
  ).toBeVisible();
  const retry = alert.getByRole('button', { name: 'Retry' });
  await expect(retry).toBeVisible();
  // Still down: Retry comes back, ready for another try.
  await retry.click();
  await expect(alert.getByRole('button', { name: 'Retry' })).toBeEnabled();
  await settle(page);
  await snap(page, 'p1-library-error');
  await app.close();
});

test('recovers through Retry once the server comes up', async () => {
  const port = await freePort();
  const { app, page } = await launchApp({ TASSEL_SERVER_URL: `http://127.0.0.1:${port}` });
  const alert = page.getByRole('alert');
  await expect(alert).toContainText("Couldn't reach Tassel's server");

  const proxy = await forward(port, E2E_SERVER_URL);
  try {
    await alert.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('region', { name: 'No sessions yet' })).toBeVisible();
    await expect(alert).toBeHidden();
  } finally {
    await app.close();
    proxy.closeAllConnections();
    proxy.close();
  }
});

test('tells the learner once when an unreadable token file forced a fresh library', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'tassel-e2e-'));
  try {
    writeFileSync(join(userData, 'device.json'), '{"token":42}');
    const first = await launchApp({ TASSEL_USER_DATA: userData });
    expect(await first.page.evaluate(() => window.tassel.getConfig())).toMatchObject({
      tokenReset: true,
    });
    const notice = first.page.getByRole('status').filter({ hasText: "couldn't read" });
    await expect(notice).toBeVisible();
    await expect(first.page.getByRole('region', { name: 'No sessions yet' })).toBeVisible();
    await settle(first.page);
    await snap(first.page, 'p1-library-token-reset');
    await notice.getByRole('button', { name: 'Got it' }).click();
    await expect(notice).toBeHidden();
    await first.app.close();

    // The fresh token reads back on the next launch, so the notice doesn't return.
    const second = await launchApp({ TASSEL_USER_DATA: userData });
    expect(await second.page.evaluate(() => window.tassel.getConfig())).toMatchObject({
      tokenReset: false,
    });
    await expect(second.page.getByRole('region', { name: 'No sessions yet' })).toBeVisible();
    await expect(second.page.getByText("couldn't read")).toHaveCount(0);
    await second.app.close();
  } finally {
    rmSync(userData, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('keeps New session clear of the Windows and Linux window controls (R23)', async () => {
  const { app, page } = await launchApp();
  await setWindowSize(app, page, 1024, 680);
  const strip = page.getByRole('banner');
  // AppFrame's classes on Windows and Linux. macOS has no controls overlay, so the
  // titlebar-area env values are missing here: the fallback path a Windows strip takes
  // when Electron doesn't provide them.
  await strip.evaluate((el) => {
    el.classList.remove('pl-[84px]', 'pr-5');
    el.classList.add('app-drag-overlay-inset', 'pl-5');
  });
  await expect(strip).toHaveCSS('padding-right', '158px');

  const width = await page.evaluate(() => window.innerWidth);
  const pill = await strip.getByRole('button', { name: 'New session' }).boundingBox();
  const search = await page.getByRole('search').boundingBox();
  if (!pill || !search) throw new Error('the strip lost its search or its New session pill');
  // Windows draws about 138px of caption buttons at the strip's right end.
  expect(pill.x + pill.width).toBeLessThanOrEqual(width - 138);
  expect(search.x + search.width).toBeLessThan(pill.x);
  await settle(page);
  await snap(page, 'p1-library-overlay-inset-1024');
  await app.close();
});

/** A port nothing listens on yet. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** The server "coming up" on `port`: a plain HTTP proxy to the E2E server. */
async function forward(port: number, target: string): Promise<Server> {
  const proxy = createServer((incoming, outgoing) => {
    const upstream = request(
      new URL(incoming.url ?? '/', target),
      { method: incoming.method, headers: incoming.headers },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on('error', () => outgoing.destroy());
    incoming.pipe(upstream);
  });
  await new Promise<void>((resolve) => proxy.listen(port, '127.0.0.1', resolve));
  return proxy;
}
