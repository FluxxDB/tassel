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
