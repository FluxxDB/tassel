// The tldraw license key's source (P5-R2). Only temporary files and made-up keys: these tests
// never open services/server/.env.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readTldrawLicenseKey, tldrawKeyLine } from '../../../config/tldraw-license';

const ENV_KEY = 'tldraw-test-0000';
const FILE_KEY = 'tldraw-test-1111';

let dir: string;

/** Writes a made-up server .env into a temporary directory and returns its path. */
function serverEnv(content: string): string {
  const file = join(dir, '.env');
  writeFileSync(file, content);
  return file;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tassel-tldraw-key-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('readTldrawLicenseKey', () => {
  it('the environment wins over the file', () => {
    const serverEnvFile = serverEnv(`TLDRAW_LICENSE_KEY=${FILE_KEY}\n`);
    expect(readTldrawLicenseKey({ env: { TLDRAW_LICENSE_KEY: ENV_KEY }, serverEnvFile })).toEqual({
      key: ENV_KEY,
      from: 'environment',
    });
    // Trimmed, and an empty or blank variable counts as none, so the file still answers.
    expect(
      readTldrawLicenseKey({ env: { TLDRAW_LICENSE_KEY: `  ${ENV_KEY}\n` }, serverEnvFile }),
    ).toEqual({ key: ENV_KEY, from: 'environment' });
    expect(readTldrawLicenseKey({ env: { TLDRAW_LICENSE_KEY: '   ' }, serverEnvFile })).toEqual({
      key: FILE_KEY,
      from: 'services/server/.env',
    });
  });

  it("reads TLDRAW_LICENSE_KEY from the server's .env, with comments and quotes", () => {
    const serverEnvFile = serverEnv(
      [
        '# The server reads its provider keys from here.',
        'OPENAI_API_KEY=sk-made-up-0000',
        '',
        `TLDRAW_LICENSE_KEY="${FILE_KEY}" # Ada's board`,
        'TASSEL_PORT=8787',
      ].join('\r\n'),
    );
    expect(readTldrawLicenseKey({ env: {}, serverEnvFile })).toEqual({
      key: FILE_KEY,
      from: 'services/server/.env',
    });
    const single = serverEnv(`export TLDRAW_LICENSE_KEY='  ${FILE_KEY}  '\n`);
    expect(readTldrawLicenseKey({ env: {}, serverEnvFile: single })).toEqual({
      key: FILE_KEY,
      from: 'services/server/.env',
    });
  });

  it('a missing file or an empty value means no key', () => {
    const none = { key: null, from: null };
    expect(readTldrawLicenseKey({ env: {}, serverEnvFile: join(dir, 'missing.env') })).toEqual(
      none,
    );
    expect(
      readTldrawLicenseKey({ env: {}, serverEnvFile: serverEnv('TLDRAW_LICENSE_KEY=\n') }),
    ).toEqual(none);
    expect(
      readTldrawLicenseKey({ env: {}, serverEnvFile: serverEnv('OPENAI_API_KEY=sk-made-up\n') }),
    ).toEqual(none);
    // A file it can't read is none too: it never throws.
    const unreadable = () => {
      throw new Error('EACCES');
    };
    expect(readTldrawLicenseKey({ env: {}, readFile: unreadable })).toEqual(none);
  });

  it('looks for the server .env from apps/desktop by default', () => {
    const asked: string[] = [];
    const readFile = (path: string) => {
      asked.push(path);
      return null;
    };
    readTldrawLicenseKey({ env: {}, readFile });
    const appDir = resolve(__dirname, '..', '..', '..');
    expect(asked).toEqual([resolve(appDir, '..', '..', 'services', 'server', '.env')]);
  });

  it('never logs the key', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    const serverEnvFile = serverEnv(`TLDRAW_LICENSE_KEY=${FILE_KEY}\n`);
    const results = [
      readTldrawLicenseKey({ env: { TLDRAW_LICENSE_KEY: ENV_KEY }, serverEnvFile }),
      readTldrawLicenseKey({ env: {}, serverEnvFile }),
      readTldrawLicenseKey({ env: {}, serverEnvFile: join(dir, 'missing.env') }),
    ];
    const lines = results.map(tldrawKeyLine);
    expect(lines).toEqual([
      '[tassel] tldraw license key: from environment',
      '[tassel] tldraw license key: from services/server/.env',
      '[tassel] tldraw license key: none (dev works; production builds blank the board)',
    ]);
    const printed = spies.flatMap((spy) => spy.mock.calls.flat()).map(String);
    for (const text of [...printed, ...lines]) {
      expect(text).not.toContain(ENV_KEY);
      expect(text).not.toContain(FILE_KEY);
    }
  });
});
