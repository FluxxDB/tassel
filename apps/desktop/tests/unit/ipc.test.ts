import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerIpc } from '../../src/main/ipc';

type Listener = (event: { senderFrame: { url: string } | null }) => unknown;

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, Listener>() }));
vi.mock('electron', () => ({
  app: { isPackaged: false, getPreferredSystemLanguages: () => ['en-US'] },
  ipcMain: { handle: (channel: string, listener: Listener) => handlers.set(channel, listener) },
}));

const tokens = {
  getToken: vi.fn(async () => 'cached-token'),
  refreshToken: vi.fn(async () => 'fresh-token'),
};

function invoke(channel: string, senderUrl: string | null): unknown {
  const listener = handlers.get(channel);
  if (!listener) throw new Error(`no handler for ${channel}`);
  return listener({ senderFrame: senderUrl === null ? null : { url: senderUrl } });
}

beforeEach(() => {
  handlers.clear();
  tokens.getToken.mockClear();
  tokens.refreshToken.mockClear();
  registerIpc(tokens);
});

describe('registerIpc', () => {
  it('answers config:get from the app origin', () => {
    expect(invoke('config:get', 'app://tassel/index.html')).toMatchObject({ uiLanguage: 'en' });
  });
  it('hands out the device token', async () => {
    expect(await invoke('auth:getToken', 'app://tassel/index.html')).toBe('cached-token');
    expect(await invoke('auth:refreshToken', 'app://tassel/index.html')).toBe('fresh-token');
  });
  it.each([
    ['config:get', 'https://example.com/'],
    ['config:get', 'app://evil/index.html'],
    ['config:get', null],
    ['auth:getToken', 'https://example.com/'],
    ['auth:refreshToken', 'app://evil/index.html'],
  ])('refuses %s from %s', (channel, senderUrl) => {
    expect(() => invoke(channel, senderUrl)).toThrow('untrusted sender');
    expect(tokens.getToken).not.toHaveBeenCalled();
    expect(tokens.refreshToken).not.toHaveBeenCalled();
  });
});
