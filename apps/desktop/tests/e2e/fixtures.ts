// Helpers for E2E specs. They drive the built app, so run `pnpm --filter @tassel/desktop build`
// first.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ConsoleMessage,
  type ElectronApplication,
  _electron as electron,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';
import type { Lang } from '@tassel/shared/i18n';
import { assertFakeCapture, fakeCaptureEnv } from './capture-guard';

/**
 * The E2E server, which global-setup.ts starts. TASSEL_E2E_PORT moves it off the default 8799,
 * so checkouts that run E2E at the same time each get their own server.
 */
export const E2E_SERVER_URL = `http://127.0.0.1:${e2ePort(process.env.TASSEL_E2E_PORT)}`;

const appDir = join(__dirname, '..', '..');
const mainEntry = join(appDir, 'out', 'main', 'index.js');
const screensDir = join(appDir, 'test-results', 'screens');
const i18nDir = join(appDir, '..', '..', 'packages', 'shared', 'src', 'i18n');

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

/** A UI string from the app's catalogs (packages/shared/src/i18n), by its dotted key. */
export function catalogText(lang: Lang, key: string): string {
  let node: unknown = catalogs[lang];
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
  if (typeof node !== 'string') throw new Error(`The ${lang} catalog has no string ${key}`);
  return node;
}

const catalogs: Record<Lang, unknown> = Object.fromEntries(
  (['en', 'es', 'ko'] as const).map((lang) => [
    lang,
    JSON.parse(readFileSync(join(i18nDir, `${lang}.json`), 'utf8')),
  ]),
) as Record<Lang, unknown>;

/**
 * Starts a paper session from the library through the new session sheet, as she would, with the
 * sheet's labels in the UI's language. Resolves once the session screen shows its stage.
 */
export async function startPaperSession(
  page: Page,
  {
    type = 'homework',
    language = 'en',
    uiLang = 'en',
  }: { type?: 'homework' | 'studying' | 'research' | 'other'; language?: Lang; uiLang?: Lang } = {},
): Promise<void> {
  const t = (key: string) => catalogText(uiLang, key);
  const newSession = page
    .getByRole('banner')
    .getByRole('button', { name: t('library.newSession') });
  await newSession.click();
  const sheet = page.getByRole('dialog', { name: t('newSession.title') });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('radio', { name: t(`newSession.type.${type}`), exact: true }).click();
  await sheet
    .getByRole('radio', { name: t(`newSession.language.${language}`), exact: true })
    .click();
  await sheet.getByRole('radio', { name: t('newSession.source.paper'), exact: true }).click();
  await sheet.getByRole('button', { name: t('newSession.start'), exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('stage')).toBeVisible();
}

export interface SessionJson {
  id: string;
  type: string;
  language: string;
  source: string;
  title: string | null;
}

/** The learner's most recently active session, from the API. */
export async function latestSession(page: Page): Promise<SessionJson> {
  const response = await callApi(page, '/v1/sessions?sort=recent');
  expect(response.status).toBe(200);
  const { items } = (await response.json()) as { items: SessionJson[] };
  const [latest] = items;
  if (!latest) throw new Error('The learner has no sessions');
  return latest;
}

export interface FrameJson {
  id: string;
  seq: number;
  reason: 'ink' | 'page';
  source: string;
  width: number;
  height: number;
  has_crop: boolean;
  bytes: number;
  page_found: boolean;
}

/** A session's uploaded frames, oldest first. */
export async function framesOf(page: Page, sessionId: string): Promise<FrameJson[]> {
  const response = await callApi(page, `/v1/sessions/${sessionId}/frames`);
  expect(response.status).toBe(200);
  const { items } = (await response.json()) as { items: FrameJson[] };
  return [...items].sort((a, b) => a.seq - b.seq);
}

/** A frame's JPEG bytes, through the API. */
export async function frameImage(
  page: Page,
  sessionId: string,
  frameId: string,
  part: 'full' | 'crop' = 'full',
): Promise<Uint8Array> {
  const response = await callApi(
    page,
    `/v1/sessions/${sessionId}/frames/${frameId}/image?part=${part}`,
  );
  expect(response.status).toBe(200);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Collects what a paper spec must never see: console errors from paper's code (the renderer's
 * and its detector worker's, which say "[paper"), uncaught page errors, and any CSP violation.
 */
export function watchPaperConsole(page: Page): string[] {
  const problems: string[] = [];
  const check = (message: ConsoleMessage) => {
    const text = message.text();
    if (/Content Security Policy|Refused to (load|execute|connect|create|evaluate)/i.test(text)) {
      problems.push(`CSP: ${text}`);
    } else if (
      message.type() === 'error' &&
      /\[paper|paper\//i.test(`${text} ${message.location().url}`)
    ) {
      problems.push(`console: ${text}`);
    }
  };
  page.on('console', check);
  page.on('worker', (worker) => worker.on('console', check));
  page.on('pageerror', (error) => problems.push(`page: ${error.message}`));
  return problems;
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
