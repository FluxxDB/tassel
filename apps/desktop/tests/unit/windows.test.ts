import { BrowserWindow, type Session } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMainWindow, isTrustedUrl, restrictPermissions } from '../../src/main/windows';

const { app } = vi.hoisted(() => ({ app: { isPackaged: false } }));
vi.mock('electron', () => ({ app, BrowserWindow: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  app.isPackaged = false;
});

describe('isTrustedUrl', () => {
  it('trusts the app origin', () => {
    expect(isTrustedUrl('app://tassel/index.html')).toBe(true);
  });
  it.each([
    'app://evil/index.html',
    'https://example.com/',
    'file:///etc/passwd',
    'http://localhost:5173/',
    'not a url',
  ])('rejects %s', (url) => {
    expect(isTrustedUrl(url)).toBe(false);
  });
  it('trusts only the dev server while it runs', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173');
    expect(isTrustedUrl('http://localhost:5173/src/main.tsx')).toBe(true);
    expect(isTrustedUrl('http://localhost:5174/')).toBe(false);
    expect(isTrustedUrl('app://tassel/index.html')).toBe(false);
  });
  it('ignores ELECTRON_RENDERER_URL in a packaged app', () => {
    app.isPackaged = true;
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173');
    expect(isTrustedUrl('http://localhost:5173/')).toBe(false);
    expect(isTrustedUrl('app://tassel/index.html')).toBe(true);
  });
});

function permissions() {
  let request!: NonNullable<Parameters<Session['setPermissionRequestHandler']>[0]>;
  let check!: NonNullable<Parameters<Session['setPermissionCheckHandler']>[0]>;
  restrictPermissions({
    setPermissionRequestHandler: (handler) => {
      if (handler) request = handler;
    },
    setPermissionCheckHandler: (handler) => {
      if (handler) check = handler;
    },
  } as Session);
  return {
    request(
      permission: Parameters<typeof request>[1],
      mediaTypes?: Array<'audio' | 'video'>,
      url = 'app://tassel/index.html',
    ) {
      const callback = vi.fn();
      request({} as Electron.WebContents, permission, callback, {
        requestingUrl: url,
        isMainFrame: true,
        mediaTypes,
      });
      return callback.mock.calls[0][0];
    },
    check(
      permission: Parameters<typeof check>[1],
      mediaType?: 'audio' | 'video' | 'unknown',
      url = 'app://tassel',
    ) {
      return check(null, permission, url, { mediaType, isMainFrame: true });
    },
  };
}
it('the main window keeps timers running in the background', () => {
  vi.mocked(BrowserWindow).mockImplementation(
    class {
      once = vi.fn();
      loadURL = vi.fn(async () => {});
    } as unknown as typeof BrowserWindow,
  );
  createMainWindow();
  expect(vi.mocked(BrowserWindow).mock.calls.at(-1)?.[0]?.webPreferences).toMatchObject({
    backgroundThrottling: false,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
  });
});
it('with fake access denied, only audio capture requests are refused; outputs and labels stay allowed', () => {
  vi.stubEnv('TASSEL_FAKE_MIC_ACCESS', 'denied');
  const p = permissions();
  expect(p.request('media', ['audio'])).toBe(false);
  expect(p.request('media', ['audio', 'video'])).toBe(false);
  expect(p.request('media', ['video'])).toBe(true);
  expect(p.request('speaker-selection')).toBe(true);
  expect(p.request('media')).toBe(true);
  expect(p.request('notifications')).toBe(true);
  // Checks must preserve enumeration/labels. The capture request enforces denial.
  expect(p.check('media', 'audio')).toBe(true);
  expect(p.check('speaker-selection')).toBe(true);
  expect(p.request('speaker-selection', undefined, 'https://evil.example')).toBe(false);
  expect(p.check('media', 'audio', 'https://evil.example')).toBe(false);
});
it('real media permissions remain allowed by default and packaged builds ignore fake denial', () => {
  expect(permissions().request('media', ['audio'])).toBe(true);
  vi.stubEnv('TASSEL_FAKE_MIC_ACCESS', 'denied');
  app.isPackaged = true;
  expect(permissions().request('media', ['audio'])).toBe(true);
});
