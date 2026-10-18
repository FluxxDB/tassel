// @vitest-environment jsdom
// The capture controller (Task 12): one paper source and one change detector per camera-on run,
// one uploader for the life of the session screen, and the store the paper panel reads.
import type { ApiClient } from '@tassel/shared/api';
import { act, renderHook } from '@testing-library/react';
import { type ReactNode, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../../src/renderer/src/lib/api';
import type { DetectorStats, DetectorTrigger } from '../../../src/renderer/src/paper/contracts';
import type { ChangeDetectorOptions } from '../../../src/renderer/src/paper/detector/client';
import { DEFAULT_PAPER_CONFIG, setPaperConfig } from '../../../src/renderer/src/paper/paper-config';
import { usePaperStore } from '../../../src/renderer/src/paper/paper-store';
import {
  type PaperFeed,
  PaperSourceError,
  type PaperSourceKind,
} from '../../../src/renderer/src/paper/types';
import { createFrameUploader } from '../../../src/renderer/src/paper/upload/frame-uploader';
import {
  type CaptureDeps,
  usePaperCapture,
} from '../../../src/renderer/src/paper/use-paper-capture';
import type { CameraAccess, PaperBridge, PaperConfig } from '../../../src/shared/paper-bridge';

const store = () => usePaperStore.getState();
const SESSION = '3a8f0d5e-62a4-4c0b-a3bb-2b5c1f7e9d10';

/** Enough turns of the microtask queue for a run to reach its next await. */
const flush = () =>
  act(async () => {
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class FakeFeed implements PaperFeed {
  readonly stream: MediaStream;
  readonly contentRect = null;
  readonly devices = [];
  readonly stop = vi.fn();
  private readonly listeners = new Set<(reason: 'lost' | 'ended') => void>();
  constructor(readonly kind: PaperSourceKind) {
    this.stream = { id: `${kind}-stream` } as unknown as MediaStream;
  }
  onEnd(listener: (reason: 'lost' | 'ended') => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /** As if the camera or the shared window went away. */
  end(reason: 'lost' | 'ended') {
    for (const listener of [...this.listeners]) listener(reason);
  }
}

function fakeBridge(access: CameraAccess = 'granted') {
  return {
    getConfig: vi.fn(async () => DEFAULT_PAPER_CONFIG),
    startHelper: vi.fn(async () => ({ ok: true as const, url: 'ws://127.0.0.1:1', token: 't' })),
    stopHelper: vi.fn(async () => {}),
    cameraAccess: vi.fn(async (): Promise<CameraAccess> => access),
    requestCameraAccess: vi.fn(async () => true),
    openCameraSettings: vi.fn(async () => {}),
  } satisfies PaperBridge;
}

/** A manual clock for the frame watchdog: now() and intervals that fire only in advance(). */
function manualClock() {
  let now = 0;
  let nextId = 1;
  const intervals = new Map<number, { fn: () => void; ms: number; next: number }>();
  return {
    now: () => now,
    setInterval: ((fn: () => void, ms: number) => {
      const id = nextId++;
      intervals.set(id, { fn, ms, next: now + ms });
      return id;
    }) as unknown as typeof setInterval,
    clearInterval: ((id: number) => {
      intervals.delete(id);
    }) as unknown as typeof clearInterval,
    active: () => intervals.size,
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = [...intervals.values()].filter((i) => i.next <= target);
        if (due.length === 0) break;
        const first = due.reduce((a, b) => (a.next <= b.next ? a : b));
        now = first.next;
        first.next += first.ms;
        first.fn();
      }
      now = target;
    },
  };
}

const STATS: DetectorStats = {
  t: 0,
  busy: false,
  occluded: false,
  quiet: 3,
  cols: 50,
  rows: 38,
  changed: [7, 8],
  solid: [],
  quad: null,
  refAgeMs: null,
  triggers: 0,
  opencv: true,
};

const TRIGGER: DetectorTrigger = {
  reason: 'ink',
  capturedAt: '2026-10-17T12:00:11.500Z',
  full: new Blob(['full'], { type: 'image/jpeg' }),
  crop: new Blob(['crop'], { type: 'image/jpeg' }),
  width: 960,
  height: 720,
  pageFound: true,
  pageQuad: [
    { x: 100, y: 80 },
    { x: 860, y: 80 },
    { x: 860, y: 640 },
    { x: 100, y: 640 },
  ],
  cropRect: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
  mask: { cols: 50, rows: 38, cells: [[7, 0]] },
  changedCells: 2,
  inkPixels: 40,
  erasePixels: 0,
};

/** The controller with every dependency faked, and what it did with them. */
function harness(options: { platform?: 'darwin' | 'win32'; access?: CameraAccess } = {}) {
  const bridge = fakeBridge(options.access);
  const clock = manualClock();
  const feeds: FakeFeed[] = [];
  const starts: Array<{ kind: PaperSourceKind; deviceId: string | null; signal: AbortSignal }> = [];
  /** Set to make the next start fail, or to hold it until resolved. */
  const next: { error?: unknown; hold?: ReturnType<typeof deferred<FakeFeed>> } = {};
  const createSource = vi.fn((kind: PaperSourceKind) => ({
    kind,
    start: vi.fn(
      async ({ deviceId = null, signal }: { deviceId?: string | null; signal: AbortSignal }) => {
        starts.push({ kind, deviceId, signal });
        if (next.error) {
          const error = next.error;
          next.error = undefined;
          throw error;
        }
        if (next.hold) return next.hold.promise;
        const feed = new FakeFeed(kind);
        feeds.push(feed);
        return feed;
      },
    ),
  }));
  const detectors: Array<{
    stream: MediaStream;
    opts: ChangeDetectorOptions;
    stop: ReturnType<typeof vi.fn>;
  }> = [];
  const createChangeDetector = vi.fn((stream: MediaStream, opts: ChangeDetectorOptions) => {
    const detector = { stream, opts, stop: vi.fn() };
    detectors.push(detector);
    return { stop: detector.stop };
  });
  const uploader = { enqueue: vi.fn(), stop: vi.fn() };
  const createUploader = vi.fn(() => uploader);
  const deps: Partial<CaptureDeps> = {
    bridge,
    platform: options.platform ?? 'darwin',
    mediaDevices: {} as MediaDevices,
    createSource: createSource as unknown as CaptureDeps['createSource'],
    createChangeDetector,
    createUploader: createUploader as unknown as CaptureDeps['createUploader'],
    now: clock.now,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
  };
  return {
    bridge,
    clock,
    feeds,
    starts,
    next,
    createSource,
    detectors,
    createChangeDetector,
    uploader,
    createUploader,
    deps,
  };
}

interface Props {
  sessionSource: 'paper' | 'screen' | 'talk' | null;
  cameraOn: boolean;
  deps?: Partial<CaptureDeps>;
}

function renderCapture(initial: Props, opts: { strict?: boolean; api?: ApiClient } = {}) {
  const api = opts.api ?? ({} as ApiClient);
  const wrapper = ({ children }: { children: ReactNode }) => {
    const inner = <ApiProvider client={api}>{children}</ApiProvider>;
    return opts.strict ? <StrictMode>{inner}</StrictMode> : inner;
  };
  return renderHook(
    (props: Props) =>
      usePaperCapture({
        sessionId: SESSION,
        sessionSource: props.sessionSource,
        cameraOn: props.cameraOn,
        deps: props.deps,
      }),
    { initialProps: initial, wrapper },
  );
}

const config = (c: Partial<PaperConfig>) => setPaperConfig({ ...DEFAULT_PAPER_CONFIG, ...c });

beforeEach(() => {
  store().reset();
  setPaperConfig(DEFAULT_PAPER_CONFIG);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('usePaperCapture', () => {
  it('camera on starts the chosen source, then status is live with the stream', async () => {
    const h = harness();
    renderCapture({ sessionSource: 'paper', cameraOn: true, deps: h.deps });
    await flush();
    // auto on macOS is the Desk View helper (Task 1's check H), which needs camera access.
    expect(h.createSource).toHaveBeenCalledTimes(1);
    expect(h.createSource.mock.calls[0]?.[0]).toBe('deskview-helper');
    expect(h.bridge.cameraAccess).toHaveBeenCalledTimes(1);
    expect(store()).toMatchObject({
      kind: 'deskview-helper',
      status: 'live',
      stream: h.feeds[0]?.stream,
    });
    expect(h.createChangeDetector).toHaveBeenCalledWith(
      h.feeds[0]?.stream,
      expect.objectContaining({ params: {}, contentRect: null }),
    );
  });

  it('under StrictMode the source starts once', async () => {
    const h = harness();
    renderCapture({ sessionSource: 'paper', cameraOn: true, deps: h.deps }, { strict: true });
    await flush();
    expect(h.starts).toHaveLength(1);
    expect(h.createChangeDetector).toHaveBeenCalledTimes(1);
    expect(store().status).toBe('live');
  });

  it('a feed that resolves after cleanup is stopped at once', async () => {
    const h = harness();
    config({ source: 'fake-clip', fakeClip: true });
    h.next.hold = deferred<FakeFeed>();
    const { unmount } = renderCapture({ sessionSource: 'paper', cameraOn: true, deps: h.deps });
    await flush();
    expect(h.starts).toHaveLength(1);
    unmount();
    expect(h.starts[0]?.signal.aborted).toBe(true);
    const late = new FakeFeed('fake-clip');
    h.next.hold.resolve(late);
    await flush();
    expect(late.stop).toHaveBeenCalledTimes(1);
    expect(h.createChangeDetector).not.toHaveBeenCalled();
    expect(store().status).toBe('idle');
  });

  it('camera off stops the feed and detector and releases the helper, while a queued upload still finishes; turning it back on starts again', async () => {
    const h = harness();
    const posted = deferred<{ data: unknown; response: Response }>();
    const POST = vi.fn(() => posted.promise);
    // The real uploader, so the queued frame really goes out after the camera is off.
    const deps = { ...h.deps, createUploader: createFrameUploader };
    const { rerender } = renderCapture(
      { sessionSource: 'paper', cameraOn: true, deps },
      { api: { POST } as unknown as ApiClient },
    );
    await flush();
    expect(store().status).toBe('live');
    act(() => h.detectors[0]?.opts.onTrigger(TRIGGER));
    await flush();
    expect(POST).toHaveBeenCalledTimes(1);

    rerender({ sessionSource: 'paper', cameraOn: false, deps });
    await flush();
    expect(h.feeds[0]?.stop).toHaveBeenCalled();
    expect(h.detectors[0]?.stop).toHaveBeenCalled();
    expect(h.bridge.stopHelper).toHaveBeenCalled();
    expect(store()).toMatchObject({ status: 'off', stream: null });

    posted.resolve({ data: { id: 'f1' }, response: new Response(null, { status: 201 }) });
    await flush();
    expect(store().uploads).toMatchObject({ sent: 1, pending: 0, failed: 0 });

    rerender({ sessionSource: 'paper', cameraOn: true, deps });
    await flush();
    expect(h.starts).toHaveLength(2);
    expect(store()).toMatchObject({ status: 'live', stream: h.feeds[1]?.stream });
  });

  it('unmount stops everything', async () => {
    const h = harness();
    const { unmount } = renderCapture({ sessionSource: 'paper', cameraOn: true, deps: h.deps });
    await flush();
    expect(store().status).toBe('live');
    unmount();
    expect(h.feeds[0]?.stop).toHaveBeenCalled();
    expect(h.detectors[0]?.stop).toHaveBeenCalled();
    expect(h.uploader.stop).toHaveBeenCalledTimes(1);
    expect(store()).toMatchObject({ status: 'idle', kind: null, stream: null });
  });

  it('not-determined asks once; denied gives denied', async () => {
    const asked = harness({ access: 'not-determined' });
    asked.bridge.requestCameraAccess.mockResolvedValueOnce(false);
    const first = renderCapture({ sessionSource: 'paper', cameraOn: true, deps: asked.deps });
    await flush();
    expect(asked.bridge.requestCameraAccess).toHaveBeenCalledTimes(1);
    expect(asked.starts).toHaveLength(0);
    expect(store().status).toBe('denied');
    first.unmount();

    const refused = harness({ access: 'denied' });
    renderCapture({ sessionSource: 'paper', cameraOn: true, deps: refused.deps });
    await flush();
    expect(refused.bridge.requestCameraAccess).not.toHaveBeenCalled();
    expect(refused.starts).toHaveLength(0);
    expect(store().status).toBe('denied');
  });

  it('a not-determined camera that she allows goes on to start the helper', async () => {
    const h = harness({ access: 'not-determined' });
    renderCapture({ sessionSource: 'paper', cameraOn: true, deps: h.deps });
    await flush();
    expect(h.bridge.requestCameraAccess).toHaveBeenCalledTimes(1);
    expect(h.starts).toHaveLength(1);
    expect(store().status).toBe('live');
  });

  it('helper clip mode skips camera access', async () => {
    const h = harness({ access: 'denied' });
    config({ source: 'deskview-helper', helperClip: true });
    renderCapture({ sessionSource: 'paper', cameraOn: true, deps: h.deps });
    await flush();
    expect(h.bridge.cameraAccess).not.toHaveBeenCalled();
    expect(h.starts[0]?.kind).toBe('deskview-helper');
    expect(store().status).toBe('live');
  });

  it("after a denial, Retry skips Electron's cached status and lets the helper's welcome decide", async () => {
    const h = harness({ access: 'denied' });
    renderCapture({ sessionSource: 'paper', cameraOn: true, deps: h.deps });
    await flush();
    expect(store().status).toBe('denied');
    // Electron may still say denied until the app restarts; the helper's welcome knows better.
    h.next.error = new PaperSourceError('denied', 'camera access is denied');
    act(() => store().retry());
    await flush();
    expect(h.bridge.cameraAccess).toHaveBeenCalledTimes(1);
    expect(h.starts).toHaveLength(1);
    expect(store()).toMatchObject({ status: 'denied', retrying: false });

    act(() => store().retry());
    await flush();
    expect(h.bridge.cameraAccess).toHaveBeenCalledTimes(1);
    expect(store()).toMatchObject({ status: 'live', retrying: false });
  });

  it('auto off darwin gives unavailable without starting anything', async () => {
    const h = harness({ platform: 'win32' });
    renderCapture({ sessionSource: 'paper', cameraOn: true, deps: h.deps });
    await flush();
    expect(store().status).toBe('unavailable');
    expect(h.createSource).not.toHaveBeenCalled();
    expect(h.bridge.cameraAccess).not.toHaveBeenCalled();
    expect(h.bridge.startHelper).not.toHaveBeenCalled();
  });

  it('unavailable, then useInstead window-capture restarts with window capture', async () => {
    const h = harness();
    h.next.error = new PaperSourceError('unavailable', 'no Desk View camera');
    renderCapture({ sessionSource: 'paper', cameraOn: true, deps: h.deps });
    await flush();
    expect(store()).toMatchObject({ status: 'unavailable', kind: 'deskview-helper' });
    act(() => store().useInstead('window-capture'));
    await flush();
    expect(h.starts.map((start) => start.kind)).toEqual(['deskview-helper', 'window-capture']);
    expect(store()).toMatchObject({ status: 'live', kind: 'window-capture' });
  });

  it('maps every start failure to its status, and an aborted start to none', async () => {
    const outcomes: Array<[PaperSourceError | Error, string]> = [
      [new PaperSourceError('denied'), 'denied'],
      [new PaperSourceError('unavailable'), 'unavailable'],
      [new PaperSourceError('cancelled'), 'ended'],
      [new PaperSourceError('error'), 'error'],
      [new Error('something else'), 'error'],
    ];
    for (const [error, status] of outcomes) {
      store().reset();
      const h = harness();
      config({ source: 'fake-clip', fakeClip: true });
      h.next.error = error;
      const { unmount } = renderCapture({ sessionSource: 'paper', cameraOn: true, deps: h.deps });
      await flush();
      expect(store().status).toBe(status);
      unmount();
    }
    store().reset();
    const aborted = harness();
    config({ source: 'fake-clip', fakeClip: true });
    aborted.next.error = new PaperSourceError('aborted');
    renderCapture({ sessionSource: 'paper', cameraOn: true, deps: aborted.deps });
    await flush();
    expect(store().status).toBe('starting');
  });

  it('triggers upload for camera sources and never for screen', async () => {
    const camera = harness();
    config({ source: 'fake-clip', fakeClip: true });
    const first = renderCapture({ sessionSource: 'paper', cameraOn: true, deps: camera.deps });
    await flush();
    act(() => camera.detectors[0]?.opts.onTrigger(TRIGGER));
    expect(camera.uploader.enqueue).toHaveBeenCalledTimes(1);
    expect(camera.uploader.enqueue).toHaveBeenCalledWith({
      full: TRIGGER.full,
      crop: TRIGGER.crop,
      meta: expect.objectContaining({
        reason: 'ink',
        source: 'fake-clip',
        detector: expect.objectContaining({ version: 'p3.1' }),
      }),
    });
    first.unmount();

    const screen = harness();
    config({ source: 'screen' });
    renderCapture({ sessionSource: 'paper', cameraOn: true, deps: screen.deps });
    await flush();
    expect(store()).toMatchObject({ status: 'live', kind: 'screen' });
    act(() => screen.detectors[0]?.opts.onTrigger(TRIGGER));
    expect(screen.uploader.enqueue).not.toHaveBeenCalled();
  });

  it('a lost feed shows lost and stops the detector', async () => {
    const h = harness();
    renderCapture({ sessionSource: 'paper', cameraOn: true, deps: h.deps });
    await flush();
    act(() => h.feeds[0]?.end('lost'));
    expect(store()).toMatchObject({ status: 'lost', stream: null });
    expect(h.detectors[0]?.stop).toHaveBeenCalled();
    expect(h.feeds[0]?.stop).toHaveBeenCalled();
    // A late stats message from the stopped detector changes nothing.
    act(() => h.detectors[0]?.opts.onStats(STATS));
    expect(store().status).toBe('lost');
  });

  it('a shared window that stops sharing shows ended', async () => {
    const h = harness();
    config({ source: 'window-capture' });
    renderCapture({ sessionSource: 'paper', cameraOn: true, deps: h.deps });
    await flush();
    act(() => h.feeds[0]?.end('ended'));
    expect(store().status).toBe('ended');
  });

  it('no stats for 3 s marks a camera feed lost and stops it; a screen feed has no watchdog', async () => {
    const camera = harness();
    config({ source: 'fake-clip', fakeClip: true });
    const first = renderCapture({ sessionSource: 'paper', cameraOn: true, deps: camera.deps });
    await flush();
    const opts = camera.detectors[0]?.opts;
    act(() => opts?.onReady?.(true));
    act(() => opts?.onStats(STATS));
    act(() => camera.clock.advance(2_000));
    act(() => opts?.onStats(STATS));
    act(() => camera.clock.advance(2_900));
    expect(store().status).toBe('live');
    act(() => camera.clock.advance(600));
    expect(store().status).toBe('lost');
    expect(camera.feeds[0]?.stop).toHaveBeenCalled();
    expect(camera.detectors[0]?.stop).toHaveBeenCalled();
    expect(camera.clock.active()).toBe(0);
    first.unmount();

    const screen = harness();
    config({ source: 'screen' });
    renderCapture({ sessionSource: 'paper', cameraOn: true, deps: screen.deps });
    await flush();
    act(() => screen.detectors[0]?.opts.onReady?.(true));
    act(() => screen.clock.advance(30_000));
    expect(store().status).toBe('live');
  });

  it('a detector still loading OpenCV never makes a healthy feed lost (re-review N4)', async () => {
    const h = harness();
    config({ source: 'fake-clip', fakeClip: true });
    renderCapture({ sessionSource: 'paper', cameraOn: true, deps: h.deps });
    await flush();
    const opts = h.detectors[0]?.opts;
    // Motion-only stats, then OpenCV's load holds the worker's thread for seconds.
    act(() => opts?.onStats({ ...STATS, opencv: false }));
    act(() => h.clock.advance(12_000));
    expect(store().status).toBe('live');
    // Once OpenCV settles, the watchdog counts from there.
    act(() => opts?.onReady?.(true));
    expect(store().opencv).toBe(true);
    act(() => h.clock.advance(2_500));
    act(() => opts?.onStats(STATS));
    act(() => h.clock.advance(2_500));
    expect(store().status).toBe('live');
    act(() => h.clock.advance(1_000));
    expect(store().status).toBe('lost');
  });

  it('a session with source null or not paper never starts a source', async () => {
    const h = harness();
    const { rerender } = renderCapture({ sessionSource: null, cameraOn: true, deps: h.deps });
    await flush();
    rerender({ sessionSource: 'screen', cameraOn: true, deps: h.deps });
    await flush();
    rerender({ sessionSource: 'talk', cameraOn: true, deps: h.deps });
    await flush();
    expect(h.createSource).not.toHaveBeenCalled();
    expect(h.createUploader).not.toHaveBeenCalled();
    expect(store().status).toBe('idle');
    rerender({ sessionSource: 'paper', cameraOn: true, deps: h.deps });
    await flush();
    expect(h.starts).toHaveLength(1);
    expect(store().status).toBe('live');
  });

  it('without window.tassel.paper the controller stays idle', async () => {
    // P1's unit tests stub only the platform.
    vi.stubGlobal('tassel', { platform: 'darwin' });
    renderCapture({ sessionSource: 'paper', cameraOn: true });
    await flush();
    expect(store().status).toBe('idle');
  });
});

it('gates detector ink uploads by focus and ten seconds, allowing large changes', async () => {
  const { useStageStore } = await import('../../../src/renderer/src/features/session/stage-store');
  useStageStore.getState().reset();
  const h = harness();
  config({ source: 'fake-clip', fakeClip: true });
  const view = renderCapture({ sessionSource: 'paper', cameraOn: true, deps: h.deps });
  await flush();
  const trigger = (changedCells = 2) =>
    act(() => h.detectors[0]?.opts.onTrigger({ ...TRIGGER, changedCells }));
  trigger();
  act(() => h.clock.advance(5000));
  trigger();
  expect(h.uploader.enqueue).toHaveBeenCalledTimes(1);
  act(() => h.clock.advance(5000));
  trigger();
  expect(h.uploader.enqueue).toHaveBeenCalledTimes(2);
  trigger(500);
  expect(h.uploader.enqueue).toHaveBeenCalledTimes(3);
  act(() => useStageStore.getState().pin('board'));
  trigger(500);
  expect(h.uploader.enqueue).toHaveBeenCalledTimes(3);
  view.unmount();
  useStageStore.getState().reset();
});

it('flushes the latest throttled edit even when the student stops writing', async () => {
  const h = harness();
  config({ source: 'fake-clip', fakeClip: true });
  const view = renderCapture({ sessionSource: 'paper', cameraOn: true, deps: h.deps });
  await flush();
  act(() => h.detectors[0]?.opts.onTrigger(TRIGGER));
  act(() => h.clock.advance(5000));
  const latest = new Blob(['new ink']);
  act(() => h.detectors[0]?.opts.onTrigger({ ...TRIGGER, full: latest }));
  expect(h.uploader.enqueue).toHaveBeenCalledTimes(1);
  act(() => h.clock.advance(5000));
  expect(h.uploader.enqueue).toHaveBeenCalledTimes(2);
  expect(h.uploader.enqueue).toHaveBeenLastCalledWith(expect.objectContaining({ full: latest }));
  view.unmount();
});
