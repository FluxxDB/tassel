import { describe, expect, it, vi } from 'vitest';
import { createPaperSource } from '../../../../src/renderer/src/paper/select-source';
import type { PaperBridge, PaperConfig } from '../../../../src/shared/paper-bridge';

const config = {
  source: 'auto',
  debug: false,
  helperClip: false,
  fakeClip: false,
  params: {},
} satisfies PaperConfig;

function setup() {
  const track = {
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getSettings: () => ({ deviceId: 'laptop' }),
  };
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  const mediaDevices = {
    getUserMedia: vi.fn(async () => stream),
    enumerateDevices: vi.fn(async () => [
      { kind: 'audioinput', deviceId: 'mic', label: 'Microphone' },
      { kind: 'videoinput', deviceId: 'phone', label: 'Phone camera' },
      { kind: 'videoinput', deviceId: 'laptop', label: 'Laptop camera' },
    ]),
  };
  const source = createPaperSource('webcam', {
    config,
    bridge: {} as PaperBridge,
    mediaDevices: mediaDevices as unknown as MediaDevices,
  });
  return { source, mediaDevices, stream, track, controller: new AbortController() };
}

describe('webcam paper source', () => {
  it('requests high resolution video without audio and lists the active camera first', async () => {
    const s = setup();
    const feed = await s.source.start({ signal: s.controller.signal });
    expect(s.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      video: { width: { ideal: 1920 }, height: { ideal: 1440 } },
      audio: false,
    });
    expect(feed.kind).toBe('webcam');
    expect(feed.devices.map((d) => d.id)).toEqual(['laptop', 'phone']);
    feed.stop();
    feed.stop();
    expect(s.track.stop).toHaveBeenCalledTimes(1);
  });

  it('selects the requested camera exactly', async () => {
    const s = setup();
    const feed = await s.source.start({ signal: s.controller.signal, deviceId: 'phone' });
    expect(s.mediaDevices.getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({ video: expect.objectContaining({ deviceId: { exact: 'phone' } }) }),
    );
    feed.stop();
  });

  it('releases a stream if the session ends while permission is pending', async () => {
    const s = setup();
    s.mediaDevices.getUserMedia.mockImplementation(async () => {
      s.controller.abort();
      return s.stream;
    });
    await expect(s.source.start({ signal: s.controller.signal })).rejects.toMatchObject({
      code: 'aborted',
    });
    expect(s.track.stop).toHaveBeenCalledTimes(1);
  });

  it('does not discard a working camera when device enumeration fails', async () => {
    const s = setup();
    s.mediaDevices.enumerateDevices.mockRejectedValue(new Error('device list unavailable'));
    const feed = await s.source.start({ signal: s.controller.signal });
    expect(feed.stream).toBe(s.stream);
    feed.stop();
  });

  it.each([
    ['NotAllowedError', 'denied'],
    ['NotFoundError', 'unavailable'],
    ['NotReadableError', 'unavailable'],
    ['OverconstrainedError', 'unavailable'],
  ])('maps %s to %s', async (name, code) => {
    const s = setup();
    s.mediaDevices.getUserMedia.mockRejectedValue(new DOMException('camera failed', name));
    await expect(s.source.start({ signal: s.controller.signal })).rejects.toMatchObject({ code });
  });
});
