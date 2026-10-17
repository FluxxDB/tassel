// The device token, the app's only credential. The store registers the device with the server on
// first use and keeps the token in userData. In 'safe' mode it is encrypted with safeStorage
// (device.bin). In 'file' mode it is plaintext JSON (device.json): dev scripts and E2E use that,
// so unattended runs never trigger a keychain prompt.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The part of Electron's safeStorage the store uses. */
export interface Crypto {
  isEncryptionAvailable(): boolean;
  encryptString(s: string): Buffer;
  decryptString(b: Buffer): string;
}

export interface TokenStore {
  getToken(): Promise<string>;
  refreshToken(): Promise<string>;
  /**
   * True when this launch found a token file it couldn't read, so the app registers a fresh
   * device: a new learner whose library starts empty. It reads the file but never registers.
   */
  wasReset(): Promise<boolean>;
}

/** What the token file held when this launch first read it. */
interface Stored {
  token?: string;
  /** The file exists but can't be read or holds no token. */
  unreadable: boolean;
}

interface TokenStoreDeps {
  dir: string;
  mode: 'safe' | 'file';
  crypto: Crypto;
  fetch: typeof fetch;
  serverUrl: string;
}

const FILES = { safe: 'device.bin', file: 'device.json' } as const;
const REGISTRATION_TIMEOUT_MS = 10_000;

export function createTokenStore(deps: TokenStoreDeps): TokenStore {
  let token: string | undefined;
  let loading: Promise<string> | undefined;
  let registering: Promise<string> | undefined;
  let resolvedMode: 'safe' | 'file' | undefined;
  let stored: Promise<Stored> | undefined;

  /**
   * The mode in effect: 'safe' falls back to 'file' when safeStorage can't encrypt. It is
   * settled on first use, so reads and writes never split across device.bin and device.json if
   * the keyring's availability changes while the app runs (Linux).
   */
  function mode(): 'safe' | 'file' {
    if (resolvedMode) return resolvedMode;
    resolvedMode = deps.mode === 'file' || deps.crypto.isEncryptionAvailable() ? deps.mode : 'file';
    if (resolvedMode !== deps.mode) {
      console.warn(
        '[tassel] safeStorage cannot encrypt here, so the device token is stored as plaintext JSON.',
      );
    }
    return resolvedMode;
  }

  /**
   * The token file as this launch first found it. It's read once: until a registration
   * succeeds nothing writes the file, so a later read would find the same bytes.
   */
  function readStored(): Promise<Stored> {
    stored ??= read();
    return stored;
  }

  async function read(): Promise<Stored> {
    const current = mode();
    let bytes: Buffer;
    try {
      bytes = await readFile(join(deps.dir, FILES[current]));
    } catch (error) {
      // No file is a first launch. One that exists but can't be opened is unreadable.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { unreadable: false };
      return unreadable(current);
    }
    try {
      const value =
        current === 'safe'
          ? deps.crypto.decryptString(bytes)
          : (JSON.parse(bytes.toString('utf8')) as { token?: unknown } | null)?.token;
      if (typeof value === 'string' && value !== '') return { token: value, unreadable: false };
    } catch {
      // Unreadable: fall through and register again.
    }
    return unreadable(current);
  }

  function unreadable(current: 'safe' | 'file'): Stored {
    console.warn(`[tassel] Can't read ${FILES[current]}, so the app registers a new device.`);
    return { unreadable: true };
  }

  /**
   * Writes the token beside a temporary file, then renames it, so a crash never leaves half a
   * file. The fixed .tmp name is safe only because every write runs inside register(), which
   * reregister() serializes; a new writer must go through it too.
   */
  async function write(value: string): Promise<void> {
    const current = mode();
    const target = join(deps.dir, FILES[current]);
    const data =
      current === 'safe' ? deps.crypto.encryptString(value) : JSON.stringify({ token: value });
    await mkdir(deps.dir, { recursive: true });
    await writeFile(`${target}.tmp`, data, { mode: 0o600 });
    await rename(`${target}.tmp`, target);
  }

  async function register(): Promise<string> {
    let body: unknown;
    try {
      const response = await deps.fetch(`${deps.serverUrl}/v1/devices`, {
        method: 'POST',
        signal: AbortSignal.timeout(REGISTRATION_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      body = await response.json();
    } catch (error) {
      throw new Error(`Device registration failed: ${String(error)}`, { cause: error });
    }
    const fresh = (body as { token?: unknown } | null)?.token;
    if (typeof fresh !== 'string' || fresh === '') {
      throw new Error('Device registration failed: the response has no token');
    }
    await write(fresh);
    token = fresh;
    return fresh;
  }

  /** Registers once for any number of concurrent callers. */
  function reregister(): Promise<string> {
    registering ??= register().finally(() => {
      registering = undefined;
    });
    return registering;
  }

  async function load(): Promise<string> {
    const { token: fromFile } = await readStored();
    if (token) return token; // A refresh finished while the file was being read.
    if (fromFile) {
      token = fromFile;
      return fromFile;
    }
    return reregister();
  }

  return {
    getToken() {
      if (token) return Promise.resolve(token);
      loading ??= load().finally(() => {
        loading = undefined;
      });
      return loading;
    },
    refreshToken: reregister,
    wasReset: async () => (await readStored()).unreadable,
  };
}
