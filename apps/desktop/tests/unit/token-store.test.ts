import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Crypto, createTokenStore } from '../../src/main/token-store';

const SERVER_URL = 'http://127.0.0.1:8799';
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tassel-tokens-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** A fake POST /v1/devices that issues a new token on every call. */
function fakeServer() {
  let issued = 0;
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    issued += 1;
    const body = { device_id: `device-${issued}`, token: `token-${issued}-${'x'.repeat(40)}` };
    return Response.json(body, { status: 201 });
  });
}

/** Stands in for safeStorage: a reversible XOR, so the raw token never appears in the bytes. */
function xorCrypto(available = true): Crypto {
  const xor = (bytes: Uint8Array) => Buffer.from(bytes.map((byte) => byte ^ 0x5a));
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text) => xor(Buffer.from(text, 'utf8')),
    decryptString: (bytes) => xor(bytes).toString('utf8'),
  };
}

/** A Crypto that fails the test if the store touches it. */
const untouchableCrypto: Crypto = {
  isEncryptionAvailable: () => {
    throw new Error('file mode must not touch safeStorage');
  },
  encryptString: () => {
    throw new Error('file mode must not touch safeStorage');
  },
  decryptString: () => {
    throw new Error('file mode must not touch safeStorage');
  },
};

function store(mode: 'safe' | 'file', fetch = fakeServer(), crypto = xorCrypto()) {
  return { fetch, tokens: createTokenStore({ dir, mode, crypto, fetch, serverUrl: SERVER_URL }) };
}

const jsonFile = () => JSON.parse(readFileSync(join(dir, 'device.json'), 'utf8'));
const binFile = () => readFileSync(join(dir, 'device.bin'));

describe('createTokenStore', () => {
  it('registers once and caches', async () => {
    const { fetch, tokens } = store('file');
    const first = await tokens.getToken();
    expect(await tokens.getToken()).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      `${SERVER_URL}/v1/devices`,
      expect.objectContaining({ method: 'POST' }),
    );
  });
  it('shares one registration between concurrent calls', async () => {
    const { fetch, tokens } = store('file');
    const [a, b] = await Promise.all([tokens.getToken(), tokens.getToken()]);
    expect(a).toBe(b);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['safe', 'file'] as const)('persists across instances (%s mode)', async (mode) => {
    const token = await store(mode).tokens.getToken();
    const second = store(mode);
    expect(await second.tokens.getToken()).toBe(token);
    expect(second.fetch).not.toHaveBeenCalled();
  });
  it('refreshToken re-registers and overwrites', async () => {
    const { fetch, tokens } = store('file');
    const old = await tokens.getToken();
    const fresh = await tokens.refreshToken();
    expect(fresh).not.toBe(old);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(jsonFile()).toEqual({ token: fresh });
    expect(await tokens.getToken()).toBe(fresh);
    expect(await store('file').tokens.getToken()).toBe(fresh);
  });
  it('shares one registration between concurrent refreshes', async () => {
    const { fetch, tokens } = store('file');
    const [a, b] = await Promise.all([tokens.refreshToken(), tokens.refreshToken()]);
    expect(a).toBe(b);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('safe mode never writes the raw token', async () => {
    const crypto = xorCrypto();
    const token = await store('safe', fakeServer(), crypto).tokens.getToken();
    expect(binFile().includes(Buffer.from(token))).toBe(false);
    expect(crypto.decryptString(binFile())).toBe(token);
    expect(existsSync(join(dir, 'device.json'))).toBe(false);
  });
  it('file mode writes JSON {token}', async () => {
    const token = await store('file').tokens.getToken();
    expect(jsonFile()).toEqual({ token });
    expect(existsSync(join(dir, 'device.bin'))).toBe(false);
  });
  it('file mode never touches safeStorage', async () => {
    const { tokens } = store('file', fakeServer(), untouchableCrypto);
    await tokens.getToken();
    await tokens.refreshToken();
    expect(await store('file', fakeServer(), untouchableCrypto).tokens.getToken()).toBeTruthy();
  });
  it('falls back to file mode, warning once, when safeStorage cannot encrypt', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { tokens } = store('safe', fakeServer(), xorCrypto(false));
    await tokens.getToken();
    const fresh = await tokens.refreshToken();
    expect(jsonFile()).toEqual({ token: fresh });
    expect(existsSync(join(dir, 'device.bin'))).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('keeps the mode it started with when encryption availability changes', async () => {
    const crypto = xorCrypto();
    const available = vi.fn<() => boolean>().mockReturnValueOnce(true).mockReturnValue(false);
    crypto.isEncryptionAvailable = available;
    const { tokens } = store('safe', fakeServer(), crypto);
    await tokens.getToken();
    const fresh = await tokens.refreshToken();
    expect(crypto.decryptString(binFile())).toBe(fresh);
    expect(existsSync(join(dir, 'device.json'))).toBe(false);
  });
  it.each([
    ['an error status', () => new Response('down', { status: 503 })],
    ['no token', () => Response.json({ device_id: 'device-1' }, { status: 201 })],
  ])('rejects a registration with %s, then retries on the next call', async (_case, reply) => {
    const fetch = fakeServer();
    fetch.mockImplementationOnce(async () => reply());
    const { tokens } = store('file', fetch);
    await expect(tokens.getToken()).rejects.toThrow('Device registration failed');
    expect(existsSync(join(dir, 'device.json'))).toBe(false);
    expect(await tokens.getToken()).toMatch(/^token-/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects when the server is unreachable', async () => {
    const fetch = fakeServer();
    fetch.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(store('file', fetch).tokens.getToken()).rejects.toThrow(
      'Device registration failed',
    );
  });
  it.each([
    ['file', 'device.json', 'not json'],
    ['safe', 'device.bin', 'not a ciphertext'],
  ] as const)('replaces an unreadable %s-mode token file', async (mode, file, contents) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeFileSync(join(dir, file), contents);
    const crypto = xorCrypto();
    crypto.decryptString = () => {
      throw new Error('cannot decrypt');
    };
    const { fetch, tokens } = store(mode, fakeServer(), crypto);
    expect(await tokens.getToken()).toMatch(/^token-1-/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('wasReset', () => {
  /** A Crypto whose decryption fails, as when the keychain entry behind device.bin is gone. */
  function undecryptable(): Crypto {
    const crypto = xorCrypto();
    crypto.decryptString = () => {
      throw new Error('cannot decrypt');
    };
    return crypto;
  }

  it('is false on a first launch, and asking registers nothing', async () => {
    const { fetch, tokens } = store('file');
    expect(await tokens.wasReset()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(existsSync(join(dir, 'device.json'))).toBe(false);
  });

  it.each(['safe', 'file'] as const)(
    'is false when the stored token reads back (%s mode)',
    async (mode) => {
      await store(mode).tokens.getToken();
      const next = store(mode);
      expect(await next.tokens.wasReset()).toBe(false);
      expect(next.fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['file', 'device.json', 'not json'],
    ['file', 'device.json', '{"token":42}'],
    ['file', 'device.json', ''],
    ['safe', 'device.bin', 'not a ciphertext'],
  ] as const)(
    'is true for the launch an unreadable %s-mode %s (%j) starts fresh',
    async (mode, file, contents) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      writeFileSync(join(dir, file), contents);
      const { fetch, tokens } = store(mode, fakeServer(), undecryptable());
      expect(await tokens.wasReset()).toBe(true);
      // The fresh device replaces the file, and the answer holds for the rest of this launch.
      expect(await tokens.getToken()).toMatch(/^token-1-/);
      expect(await tokens.wasReset()).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
      // The next launch reads the fresh token back, so it doesn't report a reset again.
      expect(await store(mode).tokens.wasReset()).toBe(false);
    },
  );

  it('counts a token file that exists but cannot be opened as unreadable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mkdirSync(join(dir, 'device.json'));
    expect(await store('file').tokens.wasReset()).toBe(true);
  });

  it('reads the token file once for both questions', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeFileSync(join(dir, 'device.json'), 'not json');
    const { tokens } = store('file');
    const [reset, token] = await Promise.all([tokens.wasReset(), tokens.getToken()]);
    expect(reset).toBe(true);
    expect(token).toMatch(/^token-1-/);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
