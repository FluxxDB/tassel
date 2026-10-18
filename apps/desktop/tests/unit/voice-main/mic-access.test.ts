import { resolve } from 'node:path';
import type { SystemPreferences } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import { readVoiceConfig, registerVoiceIpc } from '../../../src/main/voice/ipc';
import { createMicAccess, micSettingsUrl } from '../../../src/main/voice/mic-access';
import { VOICE_IPC } from '../../../src/shared/voice-bridge';

type Listener = (event: { senderFrame: { url: string } | null }) => unknown;
const { app, handlers } = vi.hoisted(() => ({
  app: { isPackaged: false },
  handlers: new Map<string, Listener>(),
}));
vi.mock('electron', () => ({
  app,
  ipcMain: { handle: (channel: string, listener: Listener) => handlers.set(channel, listener) },
}));
afterEach(() => {
  vi.unstubAllEnvs();
  app.isPackaged = false;
  handlers.clear();
});
const prefs = () => ({
  getMediaAccessStatus: vi.fn<SystemPreferences['getMediaAccessStatus']>(() => 'granted'),
  askForMediaAccess: vi.fn(async () => true),
});

it.each(['darwin', 'win32'] as const)('maps statuses on %s', (platform) => {
  const p = prefs();
  const access = createMicAccess({ platform, prefs: p, open: vi.fn() });
  for (const status of ['granted', 'denied', 'not-determined', 'restricted', 'unknown'] as const) {
    p.getMediaAccessStatus.mockReturnValue(status);
    expect(access.status()).toBe(status);
    expect(p.getMediaAccessStatus).toHaveBeenLastCalledWith('microphone');
  }
});
it.each(['darwin', 'win32', 'linux'] as const)('asks only on macOS: %s', async (platform) => {
  const p = prefs();
  p.getMediaAccessStatus.mockReturnValue('not-determined');
  const access = createMicAccess({ platform, prefs: p, open: vi.fn() });
  expect(await access.ask()).toBe(
    platform === 'darwin' ? 'granted' : platform === 'win32' ? 'not-determined' : 'unknown',
  );
  expect(p.askForMediaAccess).toHaveBeenCalledTimes(platform === 'darwin' ? 1 : 0);
  if (platform === 'darwin') {
    p.askForMediaAccess.mockResolvedValue(false);
    expect(await access.ask()).toBe('denied');
  }
  if (platform === 'linux') expect(p.getMediaAccessStatus).not.toHaveBeenCalled();
});
it('the fake access wins only when unpackaged', async () => {
  const p = prefs();
  const deps = { platform: 'darwin' as const, prefs: p, fake: 'denied' as const, open: vi.fn() };
  expect(createMicAccess(deps).status()).toBe('denied');
  expect(await createMicAccess(deps).ask()).toBe('denied');
  expect(p.getMediaAccessStatus).not.toHaveBeenCalled();
  expect(p.askForMediaAccess).not.toHaveBeenCalled();
  app.isPackaged = true;
  expect(createMicAccess(deps).status()).toBe('granted');
});
it('reads explicit test flags, with denial winning over the fake mic', async () => {
  vi.stubEnv('TASSEL_FAKE_MIC', resolve('tests/unit/windows.test.ts'));
  const p = prefs();
  p.getMediaAccessStatus.mockReturnValue('denied');
  const deps = { platform: 'darwin' as const, prefs: p, open: vi.fn() };
  expect(createMicAccess(deps).status()).toBe('granted');
  vi.stubEnv('TASSEL_FAKE_MIC_ACCESS', 'denied');
  expect(await createMicAccess(deps).ask()).toBe('denied');
  expect(p.askForMediaAccess).not.toHaveBeenCalled();
  app.isPackaged = true;
  expect(createMicAccess(deps).status()).toBe('denied');
  expect(p.getMediaAccessStatus).toHaveBeenCalled();
});
it.each([
  ['darwin', 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'],
  ['win32', 'ms-settings:privacy-microphone'],
  ['linux', null],
] as const)('settings links and fixed URL on %s', async (platform, url) => {
  const open = vi.fn(async () => {});
  expect(micSettingsUrl(platform)).toBe(url);
  expect(readVoiceConfig({}, false, platform).canOpenMicSettings).toBe(url !== null);
  await createMicAccess({ platform, prefs: prefs(), open }).openSettings();
  expect(open.mock.calls).toEqual(url ? [[url]] : []);
});
it('real devices are the default; packaged builds ignore fake mic flags', () => {
  expect(readVoiceConfig({}, false, 'linux')).toEqual({
    devTools: true,
    fakeMic: false,
    canOpenMicSettings: false,
  });
  const env = { TASSEL_FAKE_MIC: resolve('tests/unit/windows.test.ts') };
  expect(readVoiceConfig(env, false, 'darwin')).toMatchObject({ fakeMic: true });
  expect(readVoiceConfig(env, true, 'darwin')).toMatchObject({ fakeMic: false, devTools: false });
});
it('voice IPC refuses every untrusted or missing sender before any side effect', async () => {
  const access = {
    status: vi.fn(() => 'granted' as const),
    ask: vi.fn(async () => 'granted' as const),
    openSettings: vi.fn(async () => {}),
  };
  const config = readVoiceConfig({}, false, 'darwin');
  registerVoiceIpc({ access, config });
  expect(handlers.size).toBe(4);
  for (const channel of Object.values(VOICE_IPC)) {
    const handler = handlers.get(channel);
    expect(handler).toBeDefined();
    for (const url of ['https://evil.example', 'app://evil/index.html', null]) {
      expect(() => handler?.({ senderFrame: url === null ? null : { url } })).toThrow(
        'untrusted sender',
      );
    }
  }
  expect(access.status).not.toHaveBeenCalled();
  expect(access.ask).not.toHaveBeenCalled();
  expect(access.openSettings).not.toHaveBeenCalled();
  const event = { senderFrame: { url: 'app://tassel/index.html' } };
  expect(await handlers.get(VOICE_IPC.getConfig)?.(event)).toEqual(config);
  expect(await handlers.get(VOICE_IPC.micAccess)?.(event)).toBe('granted');
  expect(await handlers.get(VOICE_IPC.askMicAccess)?.(event)).toBe('granted');
  await handlers.get(VOICE_IPC.openMicSettings)?.(event);
  expect(access.openSettings).toHaveBeenCalledTimes(1);
});
