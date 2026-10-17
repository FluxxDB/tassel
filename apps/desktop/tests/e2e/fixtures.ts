// Helpers for E2E specs. They drive the built app, so run `pnpm --filter @tassel/desktop build`
// first.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
} from '@playwright/test';

/** The E2E server, which global-setup.ts starts on this port. */
export const E2E_SERVER_URL = 'http://127.0.0.1:8799';

const appDir = join(__dirname, '..', '..');
const mainEntry = join(appDir, 'out', 'main', 'index.js');
const screensDir = join(appDir, 'test-results', 'screens');

/**
 * Launches the built app against the E2E server, with the plaintext token store (no keychain
 * prompts) and a 20x fake tutor. `env` overrides any of these. Without TASSEL_USER_DATA in
 * `env`, the app gets a fresh userData directory that's deleted when it closes; pass your own
 * to keep state across launches. Resolves once the main window is visible, so screenshots never
 * catch it hidden.
 */
export async function launchApp(
  env: Record<string, string> = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  if (!existsSync(mainEntry)) {
    throw new Error(`${mainEntry} is missing. Run pnpm --filter @tassel/desktop build first.`);
  }
  const ownUserData = env.TASSEL_USER_DATA ? undefined : mkdtempSync(join(tmpdir(), 'tassel-e2e-'));
  const app = await electron.launch({
    args: [mainEntry],
    env: {
      ...inheritedEnv(),
      TASSEL_SERVER_URL: E2E_SERVER_URL,
      TASSEL_TOKEN_STORE: 'file',
      TASSEL_FAKE_SPEED: '20',
      ...(ownUserData && { TASSEL_USER_DATA: ownUserData }),
      ...env,
    },
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

/** Saves a screenshot of the window to test-results/screens/<name>.png. */
export async function snap(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(screensDir, `${name}.png`) });
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
