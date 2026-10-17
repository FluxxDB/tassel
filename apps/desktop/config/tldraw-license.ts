// The tldraw license key, read in Node when the desktop app is built or served for dev (P5-R2).
// tldraw validates its key offline in the page, and keys are made to ship in client bundles, so
// the build hands it to the renderer as __TASSEL_TLDRAW_LICENSE_KEY__. It's still a secret of
// the owner's: nothing here prints, logs or returns it anywhere but `key`.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

export interface TldrawKey {
  key: string | null;
  from: 'environment' | 'services/server/.env' | null;
}

const VARIABLE = 'TLDRAW_LICENSE_KEY';

/** The owner's git-ignored server settings, from apps/desktop. */
const SERVER_ENV_FILE = resolve(__dirname, '..', '..', '..', 'services', 'server', '.env');

/**
 * TLDRAW_LICENSE_KEY from the environment, else from services/server/.env. Values are trimmed,
 * and an empty one means none. Never throws, and never logs the key.
 */
export function readTldrawLicenseKey(
  opts: {
    env?: NodeJS.ProcessEnv;
    serverEnvFile?: string;
    readFile?: (path: string) => string | null;
  } = {},
): TldrawKey {
  const { env = process.env, serverEnvFile = SERVER_ENV_FILE, readFile = readText } = opts;
  const fromEnv = nonEmpty(env[VARIABLE]);
  if (fromEnv) return { key: fromEnv, from: 'environment' };
  const fromFile = nonEmpty(variableIn(safely(() => readFile(serverEnvFile))));
  if (fromFile) return { key: fromFile, from: 'services/server/.env' };
  return { key: null, from: null };
}

/** The one line the build prints about the key: where it came from, never the key itself. */
export function tldrawKeyLine({ from }: TldrawKey): string {
  const source = from ? `from ${from}` : 'none (dev works; production builds blank the board)';
  return `[tassel] tldraw license key: ${source}`;
}

function variableIn(content: string | null): string | undefined {
  if (content === null) return undefined;
  return safely(() => parseEnv(content)[VARIABLE]) ?? undefined;
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** The file's text. It throws when the file is missing or unreadable, which `safely` turns into none. */
function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

/** What `read` returns, or null if it throws. */
function safely<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}
