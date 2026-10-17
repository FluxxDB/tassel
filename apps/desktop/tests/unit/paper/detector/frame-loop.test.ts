import { describe, expect, it, vi } from 'vitest';
import type { DetectorStats, NormRect, Quad } from '../../../../src/renderer/src/paper/contracts';
import type {
  createDetector,
  DetectorTriggerCore,
  PageSample,
} from '../../../../src/renderer/src/paper/detector/detector';
import {
  createFrameLoop,
  type FrameLike,
  type FrameLoopDeps,
} from '../../../../src/renderer/src/paper/detector/frame-loop';
import type { FromWorker } from '../../../../src/renderer/src/paper/detector/messages';
import { DEFAULT_PARAMS } from '../../../../src/renderer/src/paper/detector/params';

class FakeFrame implements FrameLike {
  closed = false;
  constructor(
    readonly timestamp: number,
    readonly displayWidth: number,
    readonly displayHeight: number,
  ) {}
  close() {
    this.closed = true;
  }
}

/** `n` frames at `fps`, timestamps in microseconds like VideoFrame's, from `fromUs`. */
function frames(
  n: number,
  opts: { fps?: number; width?: number; height?: number; fromUs?: number } = {},
) {
  const { fps = 30, width = 960, height = 720, fromUs = 0 } = opts;
  return Array.from(
    { length: n },
    (_, i) => new FakeFrame(fromUs + Math.round((i * 1e6) / fps), width, height),
  );
}

type Size = { width: number; height: number } | null;
type Step = (t: number, samplePage: (size: Size) => PageSample) => DetectorTriggerCore | null;

const STATS: Omit<DetectorStats, 'opencv'> = {
  t: 0,
  busy: false,
  occluded: false,
  quiet: 0,
  cols: 0,
  rows: 0,
  changed: [],
  solid: [],
  quad: null,
  refAgeMs: null,
  triggers: 0,
};

function stubDetector(onStep: Step = () => null) {
  const steps: number[] = [];
  const detector = {
    step: (t: number, _motion: unknown, samplePage: (size: Size) => PageSample) => {
      steps.push(t);
      return onStep(t, samplePage);
    },
    stats: () => ({ ...STATS }),
    reset: vi.fn(),
  };
  return {
    detector: detector as unknown as ReturnType<typeof createDetector>,
    steps,
    reset: detector.reset,
  };
}

const NOW = Date.UTC(2026, 9, 17, 18, 0, 0);

function setup(opts: {
  onStep?: Step;
  opencv?: Promise<boolean>;
  quad?: (call: number) => Quad | null;
  contentRect?: NormRect | null;
  encodeFull?: FrameLoopDeps<FakeFrame>['encodeFull'];
}) {
  const stub = stubDetector(opts.onStep);
  const posted: FromWorker[] = [];
  const reads: Array<{ width: number; height: number; crop: NormRect | null }> = [];
  const warps: Array<{ width: number; height: number; quad: Quad; outW: number; outH: number }> =
    [];
  let finds = 0;
  const deps: FrameLoopDeps<FakeFrame> = {
    detector: stub.detector,
    params: { ...DEFAULT_PARAMS },
    contentRect: opts.contentRect ?? null,
    opencv: opts.opencv ?? Promise.resolve(true),
    readRgba: (_frame, width, height, crop) => {
      reads.push({ width, height, crop });
      return new Uint8ClampedArray(width * height * 4).fill(200);
    },
    findQuad: () => opts.quad?.(finds++) ?? null,
    warpGray: (_rgba, width, height, quad, outW, outH) => {
      warps.push({ width, height, quad, outW, outH });
      return new Uint8Array(outW * outH);
    },
    encodeFull: vi.fn(opts.encodeFull ?? (async () => new Blob(['full'], { type: 'image/jpeg' }))),
    encodeCrop: vi.fn(async () => new Blob(['crop'], { type: 'image/jpeg' })),
    now: () => NOW,
    post: (message) => posted.push(message),
  };
  const loop = createFrameLoop(deps);
  const of = <T extends FromWorker['type']>(type: T) =>
    posted.filter((m): m is Extract<FromWorker, { type: T }> => m.type === type);
  return { ...stub, deps, loop, posted, reads, warps, of, finds: () => finds };
}

async function pushAll(loop: { push(frame: FakeFrame): Promise<void> }, list: FakeFrame[]) {
  for (const frame of list) await loop.push(frame);
}

// A Letter-landscape page in a 960 × 720 image (800 × 608 to compare).
const PAGE_960: Quad = [
  { x: 72, y: 60 },
  { x: 873, y: 41 },
  { x: 888, y: 660 },
  { x: 87, y: 679 },
];

describe('the frame loop', () => {
  it('frame loop samples every 200 ms and closes every frame it doesn’t keep', async () => {
    const opencv = Promise.resolve(true);
    const s = setup({ opencv });
    await opencv;
    const list = frames(60);
    await pushAll(s.loop, list);
    // 60 frames at 30 fps are 2 s: samples at frames 0, 6, 12 … 54.
    expect(s.steps).toHaveLength(10);
    expect(s.steps).toEqual([0, 200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800]);
    const open = list.filter((f) => !f.closed);
    expect(open).toEqual([list[54]]);
    s.loop.stop();
    expect(list[54]?.closed).toBe(true);
    // After stop, a frame is closed at once and never sampled.
    const late = new FakeFrame(3_000_000, 960, 720);
    await s.loop.push(late);
    expect(late.closed).toBe(true);
    expect(s.steps).toHaveLength(10);
  });

  it('frame loop posts stats once per sample', async () => {
    const opencv = Promise.resolve(true);
    const s = setup({ opencv });
    await opencv;
    await pushAll(s.loop, frames(60));
    const stats = s.of('stats');
    expect(stats).toHaveLength(10);
    expect(stats.every((m) => m.stats.opencv)).toBe(true);
    // Motion is read small, for every sample.
    expect(s.reads.filter((r) => r.width === 160 && r.height === 120)).toHaveLength(10);
  });

  it('frame loop never steps the detector before OpenCV settles, and falls back to the central crop when it fails', async () => {
    let settle: (ok: boolean) => void = () => {};
    const opencv = new Promise<boolean>((resolve) => {
      settle = resolve;
    });
    const pages: PageSample[] = [];
    const s = setup({
      opencv,
      onStep: (_t, samplePage) => {
        pages.push(samplePage(null));
        return null;
      },
      quad: () => PAGE_960,
    });
    await pushAll(s.loop, frames(30));
    expect(s.steps).toEqual([]);
    const early = s.of('stats');
    expect(early).toHaveLength(5);
    expect(early.every((m) => m.stats.opencv === false)).toBe(true);
    expect(early[0]?.stats.busy).toBe(true);
    expect(early[1]?.stats.busy).toBe(false);

    settle(false);
    await opencv;
    await pushAll(s.loop, frames(30, { fromUs: 1_000_000 }));
    expect(s.steps).toHaveLength(5);
    expect(s.of('error')).toHaveLength(1);
    expect(s.of('ready')).toEqual([{ type: 'ready', opencv: false }]);
    expect(s.of('stats').every((m) => m.stats.opencv === false)).toBe(true);
    // The page finder never runs; each page is the central 80% at 640 × 480.
    expect(s.finds()).toBe(0);
    expect(s.warps).toEqual([]);
    expect(pages[0]).toMatchObject({ width: 640, height: 480, found: false });
    expect(pages[0]?.quad).toEqual([
      { x: 96, y: 72 },
      { x: 864, y: 72 },
      { x: 864, y: 648 },
      { x: 96, y: 648 },
    ]);
    expect(s.reads).toContainEqual({
      width: 640,
      height: 480,
      crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
    });
  });

  it('falls back to the central crop until a quad has been found, then keeps the last good quad', async () => {
    const pages: PageSample[] = [];
    const answers = [null, PAGE_960, null];
    const opencv = Promise.resolve(true);
    const s = setup({
      opencv,
      quad: (call) => answers[call] ?? null,
      onStep: (_t, samplePage) => {
        pages.push(samplePage(null));
        return null;
      },
    });
    await opencv;
    await pushAll(s.loop, frames(18));
    expect(pages.map((p) => p.found)).toEqual([false, true, true]);
    expect(pages[2]?.quad).toEqual(PAGE_960);
    expect(pages[1]).toMatchObject({ width: 800, height: 608 });
  });

  it('frame loop warps to the detector’s fixed size once a reference exists', async () => {
    // Native 1920 × 1440 frames: the finder sees them at 960 × 720, and quads come back doubled.
    const taller: Quad = [
      { x: 72, y: 40 },
      { x: 873, y: 21 },
      { x: 888, y: 680 },
      { x: 87, y: 699 },
    ];
    const pages: PageSample[] = [];
    let reference: Size = null;
    const opencv = Promise.resolve(true);
    const s = setup({
      opencv,
      quad: (call) => (call === 0 ? PAGE_960 : taller),
      onStep: (_t, samplePage) => {
        const page = samplePage(reference);
        reference ??= { width: page.width, height: page.height };
        pages.push(page);
        return null;
      },
    });
    await opencv;
    await pushAll(s.loop, frames(12, { width: 1920, height: 1440 }));
    expect(s.reads.filter((r) => r.width === 960 && r.height === 720)).toHaveLength(2);
    expect(s.warps.map((w) => [w.width, w.height, w.outW, w.outH])).toEqual([
      [960, 720, 800, 608],
      // The second quad alone would compare at 800 × 656; the reference's size wins.
      [960, 720, 800, 608],
    ]);
    expect(s.warps[1]?.quad).toEqual(taller);
    expect(pages[1]?.quad).toEqual(taller.map((p) => ({ x: p.x * 2, y: p.y * 2 })));
    expect(pages[1]?.frameDiagonal).toBe(2400);
  });

  it('frame loop encodes the full frame at native size on trigger, and the crop inside the page', async () => {
    const contentRect = { x: 0, y: 0.05, w: 1, h: 0.95 };
    const quad: Quad = [
      { x: 100, y: 80 },
      { x: 860, y: 70 },
      { x: 870, y: 640 },
      { x: 90, y: 650 },
    ];
    const ink: DetectorTriggerCore = {
      reason: 'ink',
      t: 200,
      mask: { cols: 50, rows: 38, cells: [[3, 2]] },
      cropRect: { x: 0.04, y: 0.02, w: 0.08, h: 0.1 },
      quad,
      pageFound: true,
      changedCells: 1,
      inkPixels: 40,
      erasePixels: 2,
    };
    const opencv = Promise.resolve(true);
    const s = setup({
      opencv,
      contentRect,
      onStep: (t) =>
        t === 200 ? ink : t === 400 ? { ...ink, reason: 'page', mask: null, cropRect: null } : null,
    });
    await opencv;
    const list = frames(14);
    await pushAll(s.loop, list);
    const [first, second] = s.of('trigger');
    expect(s.deps.encodeFull).toHaveBeenCalledWith(list[6], contentRect);
    expect(s.deps.encodeCrop).toHaveBeenCalledTimes(1);
    expect(s.deps.encodeCrop).toHaveBeenCalledWith(list[6], quad, ink.cropRect, 1600, 1216);
    expect(first?.trigger).toMatchObject({
      reason: 'ink',
      capturedAt: new Date(NOW).toISOString(),
      width: 960,
      height: 684,
      pageFound: true,
      pageQuad: quad,
      cropRect: ink.cropRect,
      mask: ink.mask,
      changedCells: 1,
      inkPixels: 40,
      erasePixels: 2,
    });
    expect(first?.trigger.full.type).toBe('image/jpeg');
    expect(first?.trigger.crop?.type).toBe('image/jpeg');
    // A page trigger sends the full frame only.
    expect(second?.trigger).toMatchObject({
      reason: 'page',
      crop: null,
      cropRect: null,
      mask: null,
    });
    expect(s.deps.encodeFull).toHaveBeenCalledTimes(2);
  });

  it('reports an encoding failure and keeps going', async () => {
    const opencv = Promise.resolve(true);
    const s = setup({
      opencv,
      onStep: (t) =>
        t === 0
          ? {
              reason: 'page',
              t,
              mask: null,
              cropRect: null,
              quad: PAGE_960,
              pageFound: true,
              changedCells: 0,
              inkPixels: 0,
              erasePixels: 0,
            }
          : null,
      encodeFull: async () => {
        throw new Error('convertToBlob gave image/png');
      },
    });
    await opencv;
    await pushAll(s.loop, frames(12));
    expect(s.of('trigger')).toEqual([]);
    expect(s.of('error').map((m) => m.message)).toEqual([expect.stringContaining('image/png')]);
    expect(s.of('stats').length).toBeGreaterThanOrEqual(2);
  });

  it('a frame of a new size resets the detector and forgets the page', async () => {
    const pages: PageSample[] = [];
    const answers: Array<Quad | null> = [PAGE_960, null];
    const opencv = Promise.resolve(true);
    const s = setup({
      opencv,
      quad: (call) => answers[call] ?? null,
      onStep: (_t, samplePage) => {
        pages.push(samplePage(null));
        return null;
      },
    });
    await opencv;
    await pushAll(s.loop, frames(6));
    await pushAll(s.loop, frames(6, { fromUs: 1_000_000, width: 1280, height: 960 }));
    expect(s.reset).toHaveBeenCalledTimes(1);
    expect(pages.map((p) => p.found)).toEqual([true, false]);
  });
});
