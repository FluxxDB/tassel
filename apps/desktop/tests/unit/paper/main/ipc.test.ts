import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPaperIpc } from '../../../../src/main/paper/ipc';
import { PAPER_IPC, type PaperConfig } from '../../../../src/shared/paper-bridge';

type Listener = (event: { senderFrame: { url: string } | null }) => unknown;

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, Listener>() }));
vi.mock('electron', () => ({
  app: { isPackaged: false, getPreferredSystemLanguages: () => ['en-US'] },
  ipcMain: { handle: (channel: string, listener: Listener) => handlers.set(channel, listener) },
}));

const config: PaperConfig = {
  source: 'auto',
  debug: false,
  helperClip: false,
  fakeClip: false,
  params: {},
};
const helper = {
  start: vi.fn(async () => ({
    ok: true as const,
    url: 'ws://127.0.0.1:54321',
    token: 'ab'.repeat(32),
  })),
  stop: vi.fn(async () => {}),
};
const camera = {
  status: vi.fn(() => 'granted' as const),
  request: vi.fn(async () => true),
  openSettings: vi.fn(async () => {}),
};

function invoke(channel: string, senderUrl: string | null): unknown {
  const listener = handlers.get(channel);
  if (!listener) throw new Error(`no handler for ${channel}`);
  return listener({ senderFrame: senderUrl === null ? null : { url: senderUrl } });
}

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  registerPaperIpc({ config, helper, camera });
});

describe('registerPaperIpc', () => {
  it('answers each paper channel from the app origin', async () => {
    const app = 'app://tassel/index.html';
    expect(await invoke(PAPER_IPC.getConfig, app)).toEqual(config);
    expect(await invoke(PAPER_IPC.startHelper, app)).toMatchObject({ ok: true });
    await invoke(PAPER_IPC.stopHelper, app);
    expect(helper.stop).toHaveBeenCalledTimes(1);
    expect(await invoke(PAPER_IPC.cameraAccess, app)).toBe('granted');
    expect(await invoke(PAPER_IPC.requestCameraAccess, app)).toBe(true);
    await invoke(PAPER_IPC.openCameraSettings, app);
    expect(camera.openSettings).toHaveBeenCalledTimes(1);
  });

  it('every paper channel refuses an untrusted sender', () => {
    expect([...handlers.keys()].sort()).toEqual(Object.values(PAPER_IPC).sort());
    for (const channel of Object.values(PAPER_IPC)) {
      for (const sender of ['https://example.com/', 'app://evil/index.html', null]) {
        expect(() => invoke(channel, sender)).toThrow('untrusted sender');
      }
    }
    for (const spy of [
      helper.start,
      helper.stop,
      camera.status,
      camera.request,
      camera.openSettings,
    ]) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
