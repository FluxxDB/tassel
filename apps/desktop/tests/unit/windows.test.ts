import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTrustedUrl } from '../../src/main/windows';

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
