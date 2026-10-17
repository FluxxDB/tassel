import { describe, expect, it, vi } from 'vitest';
import { createCameraAccess } from '../../../../src/main/paper/camera-access';
import type { CameraAccess } from '../../../../src/shared/paper-bridge';

const PRIVACY_CAMERA = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera';

function setup(overrides: Partial<Parameters<typeof createCameraAccess>[0]> = {}) {
  const systemPreferences = {
    getMediaAccessStatus: vi.fn(
      (_type: 'camera' | 'microphone' | 'screen'): CameraAccess => 'granted',
    ),
    askForMediaAccess: vi.fn(async (_type: 'camera' | 'microphone') => true),
  };
  const openExternal = vi.fn(async (_url: string) => {});
  const log = vi.fn<(line: string) => void>();
  const camera = createCameraAccess({
    platform: 'darwin',
    systemPreferences,
    openExternal,
    fake: null,
    requireFake: false,
    log,
    ...overrides,
  });
  return { camera, systemPreferences, openExternal, log };
}

describe('createCameraAccess', () => {
  it('maps each status', () => {
    const { camera, systemPreferences } = setup();
    for (const status of [
      'not-determined',
      'granted',
      'denied',
      'restricted',
      'unknown',
    ] as const) {
      systemPreferences.getMediaAccessStatus.mockReturnValue(status);
      expect(camera.status()).toBe(status);
    }
    expect(systemPreferences.getMediaAccessStatus).toHaveBeenCalledWith('camera');

    const windows = setup({ platform: 'win32' });
    expect(windows.camera.status()).toBe('unknown');
    expect(windows.systemPreferences.getMediaAccessStatus).not.toHaveBeenCalled();
  });

  it('asks macOS for camera access', async () => {
    const { camera, systemPreferences } = setup();
    systemPreferences.askForMediaAccess.mockResolvedValueOnce(false);
    expect(await camera.request()).toBe(false);
    expect(systemPreferences.askForMediaAccess).toHaveBeenCalledWith('camera');
  });

  it('the fake overrides', async () => {
    const denied = setup({ fake: 'denied' });
    expect(denied.camera.status()).toBe('denied');
    expect(await denied.camera.request()).toBe(false);
    const granted = setup({ fake: 'granted' });
    expect(granted.camera.status()).toBe('granted');
    expect(await granted.camera.request()).toBe(true);
    expect(setup({ fake: 'not-determined' }).camera.status()).toBe('not-determined');
    for (const { systemPreferences } of [denied, granted]) {
      expect(systemPreferences.getMediaAccessStatus).not.toHaveBeenCalled();
      expect(systemPreferences.askForMediaAccess).not.toHaveBeenCalled();
    }

    await granted.camera.openSettings();
    expect(granted.openExternal).not.toHaveBeenCalled();
    expect(granted.log).toHaveBeenCalledWith('[tassel] fake: open camera settings');
  });

  it('requireFake never prompts', async () => {
    const { camera, systemPreferences, openExternal, log } = setup({ requireFake: true });
    expect(await camera.request()).toBe(false);
    expect(systemPreferences.askForMediaAccess).not.toHaveBeenCalled();
    // Nor opens System Settings during an agent run.
    await camera.openSettings();
    expect(openExternal).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('[tassel] fake: open camera settings');
  });

  it('openSettings uses the Privacy_Camera URL', async () => {
    const { camera, openExternal } = setup();
    await camera.openSettings();
    expect(openExternal).toHaveBeenCalledWith(PRIVACY_CAMERA);
  });
});
