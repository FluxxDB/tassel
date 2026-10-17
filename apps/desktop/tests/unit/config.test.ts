import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyUserDataOverride, readConfig, tokenStoreMode } from '../../src/main/config';

const { app } = vi.hoisted(() => ({
  app: { getPreferredSystemLanguages: vi.fn<() => string[]>(), setPath: vi.fn() },
}));
vi.mock('electron', () => ({ app }));

beforeEach(() => {
  app.getPreferredSystemLanguages.mockReturnValue(['en-US']);
  app.setPath.mockClear();
});

describe('readConfig', () => {
  it('defaults to the local dev server and the fake tutor', () => {
    expect(readConfig({})).toEqual({
      serverUrl: 'http://127.0.0.1:8787',
      uiLanguage: 'en',
      tutorMode: 'fake',
      fakeScript: 'dfa-opening',
      fakeSpeed: 1,
    });
  });
  it('reads the TASSEL_ variables', () => {
    expect(
      readConfig({
        TASSEL_SERVER_URL: 'http://127.0.0.1:8799',
        TASSEL_UI_LANG: 'ko',
        TASSEL_TUTOR: 'live',
        TASSEL_FAKE_SCRIPT: 'other-script',
        TASSEL_FAKE_SPEED: '20',
      }),
    ).toEqual({
      serverUrl: 'http://127.0.0.1:8799',
      uiLanguage: 'ko',
      tutorMode: 'live',
      fakeScript: 'other-script',
      fakeSpeed: 20,
    });
  });
  it('takes the first supported system language', () => {
    app.getPreferredSystemLanguages.mockReturnValue(['fr-FR', 'es-419', 'ko-KR']);
    expect(readConfig({}).uiLanguage).toBe('es');
  });
  it('falls back to en when no system language is supported', () => {
    app.getPreferredSystemLanguages.mockReturnValue(['fr-FR', 'de']);
    expect(readConfig({}).uiLanguage).toBe('en');
  });
  it('ignores an unsupported TASSEL_UI_LANG', () => {
    app.getPreferredSystemLanguages.mockReturnValue(['ko-KR']);
    expect(readConfig({ TASSEL_UI_LANG: 'fr' }).uiLanguage).toBe('ko');
  });
  it.each(['0', '-2', 'fast', ''])('ignores TASSEL_FAKE_SPEED=%j', (speed) => {
    expect(readConfig({ TASSEL_FAKE_SPEED: speed }).fakeSpeed).toBe(1);
  });
  it('treats any TASSEL_TUTOR other than live as fake', () => {
    expect(readConfig({ TASSEL_TUTOR: 'LIVE!' }).tutorMode).toBe('fake');
  });
  it('drops trailing slashes from the server URL', () => {
    expect(readConfig({ TASSEL_SERVER_URL: 'http://127.0.0.1:8799//' }).serverUrl).toBe(
      'http://127.0.0.1:8799',
    );
  });
  it.each(['not a url', '127.0.0.1:8799', 'localhost:8799', 'ftp://127.0.0.1:8799'])(
    'falls back to the local server, with a warning, for TASSEL_SERVER_URL=%j',
    (value) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(readConfig({ TASSEL_SERVER_URL: value }).serverUrl).toBe('http://127.0.0.1:8787');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('TASSEL_SERVER_URL'));
      warn.mockRestore();
    },
  );
  it('keeps an https server URL', () => {
    expect(readConfig({ TASSEL_SERVER_URL: 'https://tassel.example' }).serverUrl).toBe(
      'https://tassel.example',
    );
  });
});

/** The renderer's connect-src sources, from the Content-Security-Policy in its index.html. */
function connectSources(): string[] {
  const html = readFileSync(new URL('../../src/renderer/index.html', import.meta.url), 'utf8');
  const policy = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? '';
  const directive = policy
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .find(([name]) => name === 'connect-src');
  return directive?.slice(1) ?? [];
}

/** Whether CSP sources let the renderer fetch `url`: a scheme (https:) or a host with a port. */
function cspAllows(sources: string[], url: string): boolean {
  const { protocol, hostname, port } = new URL(url);
  return sources.some((source) => {
    if (source === protocol) return true;
    const [, scheme, host, sourcePort] = /^([a-z]+:)\/\/([^:/]+)(?::(\*|\d+))?$/.exec(source) ?? [];
    return scheme === protocol && host === hostname && (sourcePort === '*' || sourcePort === port);
  });
}

describe("the server URL and the renderer's CSP", () => {
  const sources = connectSources();

  it.each([
    'http://127.0.0.1:8787',
    'http://localhost:8787',
    'http://localhost',
    'https://tassel.example',
    'https://10.0.0.5:8443',
  ])('keeps TASSEL_SERVER_URL=%s, which the CSP lets the renderer reach', (url) => {
    expect(readConfig({ TASSEL_SERVER_URL: url }).serverUrl).toBe(url);
    expect(cspAllows(sources, url)).toBe(true);
  });

  it.each(['http://192.168.1.5:8787', 'http://tassel.example', 'http://[::1]:8787'])(
    'falls back to the local server, with a warning, for TASSEL_SERVER_URL=%s, which the CSP blocks',
    (url) => {
      expect(cspAllows(sources, url)).toBe(false);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(readConfig({ TASSEL_SERVER_URL: url }).serverUrl).toBe('http://127.0.0.1:8787');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('TASSEL_SERVER_URL'));
      warn.mockRestore();
    },
  );
});

describe('applyUserDataOverride', () => {
  it('points userData at TASSEL_USER_DATA', () => {
    applyUserDataOverride({ TASSEL_USER_DATA: '/tmp/tassel-e2e-1' });
    expect(app.setPath).toHaveBeenCalledWith('userData', '/tmp/tassel-e2e-1');
  });
  it('keeps the default userData otherwise', () => {
    applyUserDataOverride({});
    expect(app.setPath).not.toHaveBeenCalled();
  });
});

describe('tokenStoreMode', () => {
  it('uses safeStorage by default', () => {
    expect(tokenStoreMode({})).toBe('safe');
  });
  it('uses plaintext JSON when TASSEL_TOKEN_STORE=file', () => {
    expect(tokenStoreMode({ TASSEL_TOKEN_STORE: 'file' })).toBe('file');
  });
  it('keeps safeStorage for any other value', () => {
    expect(tokenStoreMode({ TASSEL_TOKEN_STORE: 'plaintext' })).toBe('safe');
  });
});
