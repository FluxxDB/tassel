// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { Mic } from '../../../src/renderer/src/tutor/live/mic';
import { device, FakeStream, FakeTrack, micHarness } from './audio-fakes';

function setup() {
  const h = micHarness();
  return { ...h, mic: new Mic(h.deps) };
}
const options = { deviceId: null, processing: true };
describe('Mic', () => {
  it.each([null, 'mic-2'])(
    'opens mono with processing and exact saved device %s',
    async (deviceId) => {
      const { mic, media } = setup();
      expect(await mic.open({ ...options, deviceId })).toBe('live');
      expect(media.getUserMedia).toHaveBeenCalledWith({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      expect(mic.openedAt).toEqual(expect.any(Number));
      mic.close();
    },
  );
  it('the fake mic turns processing off', async () => {
    const { mic, media } = setup();
    await mic.open({ ...options, processing: false });
    expect(media.getUserMedia).toHaveBeenCalledWith({
      audio: {
        deviceId: undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    mic.close();
  });
  it('the sent track exists before capture and is silent until open', async () => {
    const { mic, media } = setup();
    const track = mic.sendTrack();
    expect(track.readyState).toBe('live');
    expect(media.getUserMedia).not.toHaveBeenCalled();
    expect(mic.sentLevel()).toBe(0);
    expect(mic.status).toBe('off');
    await mic.open(options);
    expect(mic.sendTrack()).toBe(track);
    expect(mic.sentLevel()).toBeCloseTo(0.5);
    mic.close();
  });
  it.each([
    ['NotAllowedError', 'denied'],
    ['NotReadableError', 'unavailable'],
    ['AbortError', 'unavailable'],
  ])('%s resolves to %s', async (name, status) => {
    const { mic, media } = setup();
    media.getUserMedia.mockRejectedValue(new DOMException('', name));
    const listener = vi.fn();
    mic.on(listener);
    expect(await mic.open(options)).toBe(status);
    expect(listener).toHaveBeenCalledWith({ type: 'status', status });
    expect(mic.sentLevel()).toBe(0);
    mic.close();
  });
  it.each(['NotFoundError', 'OverconstrainedError'])(
    'a missing saved device falls back once on %s',
    async (name) => {
      const { mic, media } = setup();
      media.getUserMedia.mockRejectedValueOnce(new DOMException('', name));
      expect(await mic.open({ ...options, deviceId: 'gone' })).toBe('live');
      expect(media.getUserMedia).toHaveBeenCalledTimes(2);
      expect(media.getUserMedia.mock.calls[1]?.[0]).toMatchObject({
        audio: { deviceId: undefined },
      });
      mic.close();
    },
  );
  it('a missing default does not retry forever', async () => {
    const { mic, media } = setup();
    media.getUserMedia.mockRejectedValue(new DOMException('', 'NotFoundError'));
    expect(await mic.open({ ...options, deviceId: 'gone' })).toBe('unavailable');
    expect(media.getUserMedia).toHaveBeenCalledTimes(2);
    mic.close();
  });
  it('switching devices keeps the sent track and stops old capture', async () => {
    const { mic, media, captures } = setup();
    await mic.open(options);
    const track = mic.sendTrack();
    media.getUserMedia.mockResolvedValueOnce(
      new FakeStream([new FakeTrack('mic-2').asTrack()]).asStream(),
    );
    await mic.setDevice('mic-2');
    expect(mic.sendTrack()).toBe(track);
    expect(captures[0]?.getAudioTracks()[0]?.readyState).toBe('ended');
    expect(mic.deviceId).toBe('mic-2');
    mic.close();
  });
  it('gates multiply while the pre-gain meter keeps showing input', async () => {
    const { mic } = setup();
    await mic.open(options);
    for (const [enabled, gate, expected] of [
      [true, true, 0.5],
      [false, true, 0],
      [true, false, 0],
      [false, false, 0],
    ] as const) {
      mic.setEnabled(enabled);
      mic.setGate(gate);
      expect(mic.level()).toBeCloseTo(0.5);
      expect(mic.sentLevel()).toBeCloseTo(expected);
    }
    mic.close();
  });
  it('unplugging the open mic reopens default and reports device-lost', async () => {
    const { mic, media, events } = setup();
    await mic.open(options);
    const listener = vi.fn();
    mic.on(listener);
    media.enumerateDevices.mockResolvedValue([device('mic-2')]);
    media.getUserMedia.mockResolvedValue(
      new FakeStream([new FakeTrack('mic-2').asTrack()]).asStream(),
    );
    events.dispatchEvent(new Event('devicechange'));
    await vi.waitFor(() => expect(mic.deviceId).toBe('mic-2'));
    expect(listener).toHaveBeenCalledWith({ type: 'device-lost', deviceId: 'mic-1' });
    expect(media.getUserMedia).toHaveBeenCalledTimes(2);
    mic.close();
  });
  it('a stopped sent track is replaced without losing capture', async () => {
    const { mic } = setup();
    await mic.open(options);
    const old = mic.sendTrack();
    old.stop();
    expect(mic.sendTrack()).not.toBe(old);
    expect(mic.sendTrack().readyState).toBe('live');
    expect(mic.sentLevel()).toBeCloseTo(0.5);
    mic.close();
  });
  it('close releases capture, graph and listeners, including a pending open', async () => {
    const { mic, media, contexts, events } = setup();
    let finish!: (s: MediaStream) => void;
    media.getUserMedia.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const opening = mic.open(options);
    mic.close();
    const track = new FakeTrack();
    finish(new FakeStream([track.asTrack()]).asStream());
    await opening;
    expect(track.readyState).toBe('ended');
    expect(mic.status).toBe('off');
    expect(contexts[0]?.close).toHaveBeenCalledOnce();
    events.dispatchEvent(new Event('devicechange'));
    expect(media.enumerateDevices).not.toHaveBeenCalled();
  });
});
