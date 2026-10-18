// Helpers for E2E specs. They drive the built app, so run `pnpm --filter @tassel/desktop build`
// first.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';
import type { Session, SessionType } from '@tassel/shared/api';
import type { Lang } from '@tassel/shared/i18n';
import en from '../../../../packages/shared/src/i18n/en.json';
import es from '../../../../packages/shared/src/i18n/es.json';
import ko from '../../../../packages/shared/src/i18n/ko.json';
import timelines from '../fixtures/audio/timelines.json';
import { assertFakeCapture, fakeCaptureEnv } from './capture-guard';

/**
 * The E2E server, which global-setup.ts starts. TASSEL_E2E_PORT moves it off the default 8799,
 * so checkouts that run E2E at the same time each get their own server.
 */
export const E2E_SERVER_URL = `http://127.0.0.1:${e2ePort(process.env.TASSEL_E2E_PORT)}`;

const appDir = join(__dirname, '..', '..');
const mainEntry = join(appDir, 'out', 'main', 'index.js');
const screensDir = join(appDir, 'test-results', 'screens');

/**
 * Launches the built app against the E2E server, with the plaintext token store (no keychain
 * prompts) and a 20x fake tutor. Paper plays the generated `dfa-short` clip as a fake camera,
 * with the app's own real-capture refusal on. `env` overrides any of these, but the capture
 * guard refuses a launch that could reach a real camera or display (ruling P3-R24). Without
 * TASSEL_USER_DATA in `env`, the app gets a fresh userData directory that's deleted when it
 * closes; pass your own to keep state across launches. Resolves once the main window is
 * visible, so screenshots never catch it hidden.
 */
export async function launchApp(
  env: Record<string, string> = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  if (!existsSync(mainEntry)) {
    throw new Error(`${mainEntry} is missing. Run pnpm --filter @tassel/desktop build first.`);
  }
  // global-setup.ts generates the clip and sets TASSEL_E2E_CLIP_DFA_SHORT.
  const paperEnv = { ...fakeCaptureEnv(process.env.TASSEL_E2E_CLIP_DFA_SHORT), ...env };
  assertFakeCapture(paperEnv);
  const ownUserData = env.TASSEL_USER_DATA ? undefined : mkdtempSync(join(tmpdir(), 'tassel-e2e-'));
  const app = await electron.launch({
    args: [mainEntry],
    env: definedOnly({
      ...inheritedEnv(),
      TASSEL_SERVER_URL: E2E_SERVER_URL,
      TASSEL_TOKEN_STORE: 'file',
      TASSEL_FAKE_SPEED: '20',
      TASSEL_TUTOR: 'fake',
      ...(ownUserData && { TASSEL_USER_DATA: ownUserData }),
      ...paperEnv,
    }),
  });
  if (ownUserData) app.once('close', () => removeDir(ownUserData));
  const page = await app.firstWindow();
  // Poll rather than wait for 'show': Electron doesn't emit it on macOS for a window shown
  // while the app isn't frontmost, which is how Playwright launches it.
  const isVisible = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible());
  await expect.poll(isVisible, { timeout: 15_000 }).toBe(true);
  return { app, page };
}

/** Voice tests always pin a valid fake mic before starting Electron. */
export type MicFixture = keyof typeof timelines.fixtures;
export async function launchVoice(
  opts: { mic?: MicFixture; env?: Record<string, string> } = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  const mic = opts.mic ?? 'silence';
  const file = join(appDir, 'tests', 'fixtures', 'audio', `${mic}.wav`);
  // Missing fixtures must fail closed in E2E, never fall back to the owner's microphone.
  if (!existsSync(file)) throw new Error(`Missing voice fixture: ${file}`);
  const fixture = timelines.fixtures[mic];
  return launchApp({
    ...opts.env,
    TASSEL_TUTOR: 'live',
    TASSEL_FAKE_MIC: file,
    TASSEL_FAKE_MIC_LOOP: 'loop' in fixture && fixture.loop ? '1' : '0',
  });
}

/** UI creation, always Just talk, then the newest session via the authenticated API. */
export async function startVoiceSession(
  page: Page,
  opts: { language: Lang; type?: SessionType },
): Promise<string> {
  const config = await page.evaluate(() => window.tassel.getConfig());
  const catalog = { en, es, ko }[config.uiLanguage];
  await page
    .getByRole('banner')
    .getByRole('button', { name: catalog.library.newSession, exact: true })
    .click();
  const sheet = page.getByRole('dialog', { name: catalog.newSession.title, exact: true });
  await sheet
    .getByRole('radio', { name: catalog.newSession.type[opts.type ?? 'homework'], exact: true })
    .click();
  await sheet
    .getByRole('radio', { name: catalog.newSession.language[opts.language], exact: true })
    .click();
  await sheet.getByRole('radio', { name: catalog.newSession.source.talk, exact: true }).click();
  const created = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/v1/sessions' && response.request().method() === 'POST',
  );
  await sheet.getByRole('button', { name: catalog.newSession.start, exact: true }).click();
  expect((await created).ok()).toBe(true);
  await expect(sheet).toBeHidden();
  const token = await page.evaluate(() => window.tassel.getToken());
  const response = await fetch(`${config.serverUrl}/v1/sessions?sort=created`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Session list failed: ${response.status}`);
  const { items } = (await response.json()) as { items: Session[] };
  const newest = items[0];
  if (!newest) throw new Error('New voice session missing from API');
  return newest.id;
}

/**
 * Waits for the web fonts and for running transitions (a segment's 150 ms color change, a
 * sheet's entrance), so screenshots never catch fallback faces or a half-finished state.
 * Endless animations, such as a busy spinner, are left running.
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const finite = document
      .getAnimations()
      .filter((animation) => animation.effect?.getTiming().iterations !== Infinity);
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
  });
}

/** Saves a screenshot of the window to test-results/screens/<name>.png. */
export async function snap(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(screensDir, `${name}.png`) });
}

/** Calls the E2E server's API as the app's learner, with the device token the app holds. */
export async function callApi(page: Page, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await page.evaluate(() => window.tassel.getToken());
  return fetch(`${E2E_SERVER_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
}

/**
 * Double-clicks the middle of `target` the way a person does: two presses 120 ms apart, the
 * second counted as the second click. Unlike locator.dblclick, which presses twice at once, it
 * leaves the first click time to change the screen under the pointer.
 */
export async function doubleClickLikeAPerson(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error("The double click's target isn't on screen");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ clickCount: 1 });
  await page.mouse.up({ clickCount: 1 });
  await page.waitForTimeout(120);
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
}

/**
 * Resizes the window's content area (page.setViewportSize doesn't resize an Electron window)
 * and waits until the page has the new size. The window's minimum is 1024×680.
 */
export async function setWindowSize(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]?.setContentSize(w, h),
    [width, height],
  );
  await expect
    .poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight]))
    .toEqual([width, height]);
}

function e2ePort(value: string | undefined): number {
  if (!value) return 8799;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`TASSEL_E2E_PORT must be a port from 1 to 65535, not "${value}"`);
  }
  return port;
}

/** The env without its unset entries: an undefined value would reach Electron as "undefined". */
function definedOnly(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (value !== undefined) out[key] = value;
  return out;
}

function removeDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    // A file Windows still holds open: it's a temp directory, so leave it to the OS.
  }
}

/** Variables that would change how Electron starts or which renderer it loads. */
const ELECTRON_OVERRIDES = new Set(['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL']);

/**
 * The runner's environment, minus TASSEL_* settings from the developer's shell (each spec
 * states its own) and ELECTRON_OVERRIDES: ELECTRON_RUN_AS_NODE would start Electron as plain
 * Node, and ELECTRON_RENDERER_URL would load a dev server instead of the built renderer.
 */
function inheritedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.startsWith('TASSEL_') || ELECTRON_OVERRIDES.has(key)) continue;
    env[key] = value;
  }
  return env;
}
