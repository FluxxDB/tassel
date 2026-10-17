import { describe, expect, it, vi } from 'vitest';
import type { DetectorStats, DetectorTrigger } from '../../../../src/renderer/src/paper/contracts';
import { createChangeDetector } from '../../../../src/renderer/src/paper/detector/client';
import type { FromWorker } from '../../../../src/renderer/src/paper/detector/messages';

class FakeWorker {
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly sent: Array<{ message: unknown; transfer: unknown }> = [];
  terminate = vi.fn();
  postMessage(message: unknown, transfer?: unknown) {
    this.sent.push({ message, transfer });
  }
  /** As if the worker posted `data`. */
  emit(data: FromWorker) {
    this.onmessage?.({ data } as MessageEvent<FromWorker>);
  }
}

const STATS: DetectorStats = {
  t: 200,
  busy: false,
  occluded: false,
  quiet: 5,
  cols: 50,
  rows: 38,
  changed: [],
  solid: [],
  quad: null,
  refAgeMs: 0,
  triggers: 0,
  opencv: true,
};

function setup() {
  const worker = new FakeWorker();
  const track = { kind: 'video' } as MediaStreamTrack;
  const stream = { getVideoTracks: () => [track] } as unknown as MediaStream;
  const readable = new ReadableStream<VideoFrame>();
  const createProcessor = vi.fn(() => ({ readable }));
  const handlers = { onStats: vi.fn(), onTrigger: vi.fn(), onError: vi.fn() };
  const detector = createChangeDetector(stream, {
    params: { quietInkMs: 2500 },
    contentRect: { x: 0, y: 0.05, w: 1, h: 0.95 },
    ...handlers,
    createWorker: () => worker as unknown as Worker,
    createProcessor,
  });
  return { worker, track, readable, createProcessor, detector, ...handlers };
}

describe('createChangeDetector', () => {
  it('createChangeDetector forwards stats and triggers, uses the processor seam, and terminates the worker on stop', () => {
    const s = setup();
    expect(s.createProcessor).toHaveBeenCalledWith(s.track);
    // The processor's readable goes to the worker, transferred, with the params and the crop.
    expect(s.worker.sent).toEqual([
      {
        message: {
          type: 'start',
          readable: s.readable,
          params: { quietInkMs: 2500 },
          contentRect: { x: 0, y: 0.05, w: 1, h: 0.95 },
        },
        transfer: [s.readable],
      },
    ]);

    s.worker.emit({ type: 'stats', stats: STATS });
    expect(s.onStats).toHaveBeenCalledWith(STATS);
    const trigger = { reason: 'ink' } as DetectorTrigger;
    s.worker.emit({ type: 'trigger', trigger });
    expect(s.onTrigger).toHaveBeenCalledWith(trigger);
    s.worker.emit({ type: 'error', message: 'OpenCV failed to load' });
    expect(s.onError).toHaveBeenCalledWith('OpenCV failed to load');
    s.worker.emit({ type: 'ready', opencv: true });

    s.detector.stop();
    expect(s.worker.sent.at(-1)).toEqual({ message: { type: 'stop' }, transfer: undefined });
    expect(s.worker.terminate).toHaveBeenCalledTimes(1);
    // Nothing reaches the caller after stop, and a second stop is harmless.
    s.worker.emit({ type: 'stats', stats: STATS });
    expect(s.onStats).toHaveBeenCalledTimes(1);
    s.detector.stop();
    expect(s.worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('creates the detector worker as a module worker by default (re-review N3)', () => {
    const created: Array<{ url: string; options: WorkerOptions | undefined }> = [];
    vi.stubGlobal(
      'Worker',
      class {
        onmessage = null;
        onerror = null;
        constructor(url: URL | string, options?: WorkerOptions) {
          created.push({ url: String(url), options });
        }
        postMessage() {}
        terminate() {}
      },
    );
    try {
      const stream = { getVideoTracks: () => [{ kind: 'video' }] } as unknown as MediaStream;
      const detector = createChangeDetector(stream, {
        onStats: vi.fn(),
        onTrigger: vi.fn(),
        onError: vi.fn(),
        createProcessor: () => ({ readable: new ReadableStream<VideoFrame>() }),
      });
      expect(created).toHaveLength(1);
      expect(created[0]?.url).toMatch(/\/paper\/detector\/worker\.ts/);
      // A classic worker can't parse the ES imports the dev server leaves in worker.ts.
      expect(created[0]?.options).toMatchObject({ type: 'module' });
      detector.stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports a worker that fails', () => {
    const s = setup();
    s.worker.onerror?.({ message: 'Uncaught SyntaxError' } as ErrorEvent);
    expect(s.onError).toHaveBeenCalledWith('Uncaught SyntaxError');
  });

  it('reports a stream without video, and starts nothing', () => {
    const worker = new FakeWorker();
    const onError = vi.fn();
    const createWorker = vi.fn(() => worker as unknown as Worker);
    const detector = createChangeDetector({ getVideoTracks: () => [] } as unknown as MediaStream, {
      onStats: vi.fn(),
      onTrigger: vi.fn(),
      onError,
      createWorker,
      createProcessor: vi.fn(),
    });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('video'));
    expect(createWorker).not.toHaveBeenCalled();
    detector.stop();
  });
});
