import { describe, expect, it, vi } from 'vitest';
import { createPaperSource } from '../../../../src/renderer/src/paper/select-source';
import { type PaperFeed, PaperSourceError } from '../../../../src/renderer/src/paper/types';
import type {
  PaperBridge,
  PaperConfig,
  PaperSourceKind,
} from '../../../../src/shared/paper-bridge';

const CONFIG: PaperConfig = {
  source: 'auto',
  debug: false,
  helperClip: false,
  fakeClip: true,
  params: {},
};

/** A video track the test can end, as the OS or Chromium would. */
class FakeTrack {
  readyState = 'live';
  private listeners: Array<() => void> = [];
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });
  addEventListener(type: string, listener: () => void): void {
    if (type === 'ended') this.listeners.push(listener);
  }
  removeEventListener(type: string, listener: () => void): void {
    if (type === 'ended') this.listeners = this.listeners.filter((l) => l !== listener);
  }
  end(): void {
    this.readyState = 'ended';
    for (const listener of this.listeners) listener();
  }
}

function fakeStream() {
  const track = new FakeTrack();
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track };
}

function setup(kind: PaperSourceKind, options: { config?: PaperConfig; document?: Document } = {}) {
  const { stream, track } = fakeStream();
  const mediaDevices = {
    getUserMedia: vi.fn(async (_constraints: MediaStreamConstraints) => stream),
    getDisplayMedia: vi.fn(async (_constraints?: DisplayMediaStreamOptions) => stream),
  };
  const source = createPaperSource(kind, {
    bridge: {} as PaperBridge,
    config: options.config ?? CONFIG,
    mediaDevices: mediaDevices as unknown as MediaDevices,
    document: options.document,
  });
  const controller = new AbortController();
  return { source, mediaDevices, stream, track, controller };
}

async function failure(started: Promise<PaperFeed>): Promise<string> {
  try {
    await started;
  } catch (error) {
    if (error instanceof PaperSourceError) return error.code;
    throw error;
  }
  throw new Error('the start resolved');
}

/**
 * A document whose video plays a first frame with a `band`-row flat title bar over noise, and
 * whose canvas reads that frame back, as a captured window gives.
 */
function captureDocument(width: number, height: number, band: number): Document {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = y < band ? 236 : (x * 31 + y * 17) % 256;
      pixels.set([value, value, value, 255], (y * width + x) * 4);
    }
  }
  const video = {
    muted: false,
    playsInline: false,
    srcObject: null as MediaStream | null,
    videoWidth: width,
    videoHeight: height,
    play: vi.fn(async () => {}),
    requestVideoFrameCallback: (callback: () => void) => {
      setTimeout(callback, 0);
      return 1;
    },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage: vi.fn(),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: w === width && h === height ? pixels : new Uint8ClampedArray(w * h * 4),
      }),
    }),
  };
  return {
    createElement: (tag: string) => (tag === 'video' ? video : canvas),
  } as unknown as Document;
}

describe('the display and fake-clip sources', () => {
  it('window capture maps NotAllowedError to cancelled, AbortError to unavailable, and its ended track to ended', async () => {
    const cancelled = setup('window-capture');
    cancelled.mediaDevices.getDisplayMedia.mockRejectedValueOnce(
      new DOMException('no', 'NotAllowedError'),
    );
    expect(await failure(cancelled.source.start({ signal: cancelled.controller.signal }))).toBe(
      'cancelled',
    );

    const denied = setup('window-capture');
    denied.mediaDevices.getDisplayMedia.mockRejectedValueOnce(
      new DOMException('denied', 'AbortError'),
    );
    expect(await failure(denied.source.start({ signal: denied.controller.signal }))).toBe(
      'unavailable',
    );

    const other = setup('window-capture');
    other.mediaDevices.getDisplayMedia.mockRejectedValueOnce(
      new DOMException('?', 'NotReadableError'),
    );
    expect(await failure(other.source.start({ signal: other.controller.signal }))).toBe('error');

    const live = setup('window-capture');
    const feed = await live.source.start({ signal: live.controller.signal });
    const ended = vi.fn();
    feed.onEnd(ended);
    live.track.end();
    expect(ended).toHaveBeenCalledExactlyOnceWith('ended');
  });

  it('window capture asks for 15 fps, and crops the title bar it finds on its first frame', async () => {
    const run = setup('window-capture', { document: captureDocument(320, 200, 20) });
    const feed = await run.source.start({ signal: run.controller.signal });
    expect(run.mediaDevices.getDisplayMedia).toHaveBeenCalledWith({
      video: { frameRate: { ideal: 15, max: 30 } },
      audio: false,
    });
    expect(feed.kind).toBe('window-capture');
    expect(feed.contentRect).toEqual({ x: 0, y: 0.1, w: 1, h: 0.9 });
  });

  it('fake clip without config.fakeClip rejects unavailable and never calls getUserMedia', async () => {
    const run = setup('fake-clip', { config: { ...CONFIG, fakeClip: false } });
    expect(await failure(run.source.start({ signal: run.controller.signal }))).toBe('unavailable');
    expect(run.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it('fake clip maps NotFoundError to unavailable and its ended track to lost', async () => {
    for (const name of ['NotFoundError', 'NotReadableError']) {
      const missing = setup('fake-clip');
      missing.mediaDevices.getUserMedia.mockRejectedValueOnce(new DOMException('none', name));
      expect(await failure(missing.source.start({ signal: missing.controller.signal }))).toBe(
        'unavailable',
      );
    }

    const live = setup('fake-clip');
    const feed = await live.source.start({ signal: live.controller.signal });
    expect(live.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      video: { width: { ideal: 1920 }, height: { ideal: 1440 } },
      audio: false,
    });
    expect(feed).toMatchObject({
      kind: 'fake-clip',
      stream: live.stream,
      contentRect: null,
      devices: [],
    });
    const ended = vi.fn();
    feed.onEnd(ended);
    live.track.end();
    expect(ended).toHaveBeenCalledExactlyOnceWith('lost');
  });

  it('screen requests at most 10 fps', async () => {
    const run = setup('screen');
    const feed = await run.source.start({ signal: run.controller.signal });
    expect(run.mediaDevices.getDisplayMedia).toHaveBeenCalledWith({
      video: { frameRate: { ideal: 5, max: 10 } },
      audio: false,
    });
    expect(feed).toMatchObject({ kind: 'screen', contentRect: null });
    const ended = vi.fn();
    feed.onEnd(ended);
    run.track.end();
    expect(ended).toHaveBeenCalledExactlyOnceWith('ended');

    const cancelled = setup('screen');
    cancelled.mediaDevices.getDisplayMedia.mockRejectedValueOnce(
      new DOMException('no', 'NotAllowedError'),
    );
    expect(await failure(cancelled.source.start({ signal: cancelled.controller.signal }))).toBe(
      'cancelled',
    );
  });

  it('an aborted signal stops before getDisplayMedia or getUserMedia is called', async () => {
    for (const kind of ['window-capture', 'screen', 'fake-clip'] as const) {
      const run = setup(kind);
      run.controller.abort();
      expect(await failure(run.source.start({ signal: run.controller.signal }))).toBe('aborted');
      expect(run.mediaDevices.getDisplayMedia).not.toHaveBeenCalled();
      expect(run.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    }
  });

  it('a start aborted while the picker is open stops the stream it gets', async () => {
    for (const kind of ['window-capture', 'screen', 'fake-clip'] as const) {
      const run = setup(kind);
      const started = run.source.start({ signal: run.controller.signal });
      run.controller.abort();
      expect(await failure(started)).toBe('aborted');
      expect(run.track.stop).toHaveBeenCalled();
    }
  });

  it('stop stops every track, and is not an ending', async () => {
    const run = setup('fake-clip');
    const feed = await run.source.start({ signal: run.controller.signal });
    const ended = vi.fn();
    feed.onEnd(ended);
    feed.stop();
    feed.stop();
    expect(run.track.stop).toHaveBeenCalledTimes(1);
    expect(ended).not.toHaveBeenCalled();
  });
});
