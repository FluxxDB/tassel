// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { resolveDevice, useAudioDevices } from '../../../src/renderer/src/features/voice/devices';
import { device } from './audio-fakes';

function mediaHarness() {
  const target = new EventTarget();
  const media = {
    enumerateDevices: vi.fn(async () => [
      device('mac-mic'),
      device('mac-speaker', 'audiooutput'),
      device('camera', 'videoinput'),
    ]),
    addEventListener: vi.fn(target.addEventListener.bind(target)),
    removeEventListener: vi.fn(target.removeEventListener.bind(target)),
  };
  return { media, target, input: media as unknown as MediaDevices };
}
describe('audio devices', () => {
  it('keeps a present saved device of the matching kind', () => {
    expect(resolveDevice('mac', [device('mac')], 'audioinput')).toEqual({ id: 'mac', lost: false });
  });
  it('a vanished device or wrong kind falls back to default and is lost', () => {
    expect(resolveDevice('iphone', [device('mac')], 'audioinput')).toEqual({
      id: null,
      lost: true,
    });
    expect(resolveDevice('mac', [device('mac', 'audiooutput')], 'audioinput')).toEqual({
      id: null,
      lost: true,
    });
  });
  it('null means system default, not lost', () => {
    expect(resolveDevice(null, [], 'audioinput')).toEqual({ id: null, lost: false });
  });
  it('devicechange refreshes input/output lists and unmount removes the listener', async () => {
    const { media, input, target } = mediaHarness();
    const { result, unmount } = renderHook(() => useAudioDevices(input));
    await waitFor(() => expect(result.current.inputs.map((d) => d.deviceId)).toEqual(['mac-mic']));
    expect(result.current.outputs.map((d) => d.deviceId)).toEqual(['mac-speaker']);
    media.enumerateDevices.mockResolvedValue([device('iphone')]);
    act(() => {
      target.dispatchEvent(new Event('devicechange'));
    });
    await waitFor(() => expect(result.current.inputs.map((d) => d.deviceId)).toEqual(['iphone']));
    expect(result.current.outputs).toEqual([]);
    unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith('devicechange', expect.any(Function));
    const count = media.enumerateDevices.mock.calls.length;
    target.dispatchEvent(new Event('devicechange'));
    expect(media.enumerateDevices).toHaveBeenCalledTimes(count);
  });
  it('refresh observes labels granted later without requesting capture', async () => {
    const { media, input } = mediaHarness();
    const { result } = renderHook(() => useAudioDevices(input));
    await waitFor(() => expect(result.current.inputs).toHaveLength(1));
    media.enumerateDevices.mockResolvedValue([
      { ...device('mac-mic'), label: 'MacBook Microphone' },
    ]);
    await act(() => result.current.refresh());
    expect(result.current.inputs[0]?.label).toBe('MacBook Microphone');
  });
  it('a late enumeration cannot overwrite a newer device list', async () => {
    const { media, input } = mediaHarness();
    let old!: (devices: MediaDeviceInfo[]) => void;
    media.enumerateDevices.mockImplementationOnce(
      () =>
        new Promise((r) => {
          old = r;
        }),
    );
    const { result } = renderHook(() => useAudioDevices(input));
    await act(() => result.current.refresh());
    await act(async () => {
      old([device('stale')]);
    });
    expect(result.current.inputs.map((d) => d.deviceId)).toEqual(['mac-mic']);
  });
  it('failed enumeration retains the last known devices and refresh resolves', async () => {
    const { media, input } = mediaHarness();
    const { result } = renderHook(() => useAudioDevices(input));
    await waitFor(() => expect(result.current.inputs).toHaveLength(1));
    media.enumerateDevices.mockRejectedValue(new Error('denied'));
    await act(() => result.current.refresh());
    expect(result.current.inputs.map((d) => d.deviceId)).toEqual(['mac-mic']);
  });
});
