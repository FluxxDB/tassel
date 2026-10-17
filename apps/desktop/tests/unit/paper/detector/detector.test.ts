import { describe, expect, it } from 'vitest';
import type { Quad } from '../../../../src/renderer/src/paper/contracts';
import {
  createDetector,
  type DetectorTriggerCore,
} from '../../../../src/renderer/src/paper/detector/detector';
import type { DetectorParams } from '../../../../src/renderer/src/paper/detector/params';
import { runClip } from './harness';

// A synthetic world: a 160 × 128 page (10 × 8 cells of 16 px) of gray 240, whose content the
// test sets, and a motion image that only changes when the test says something moved.
const W = 160;
const H = 128;
const COLS = 10;
const QUAD: Quad = [
  { x: 0, y: 0 },
  { x: W, y: 0 },
  { x: W, y: H },
  { x: 0, y: H },
];

type Paint = (img: Uint8Array) => void;

const rect =
  (x0: number, y0: number, x1: number, y1: number, value: number): Paint =>
  (img) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img[y * W + x] = value;
  };

/** A dark smooth block, 60% of the page's brightness: a hand, as far as the detector knows. */
const block = rect(48, 32, 96, 80, 144);
/** Pen strokes, 3 px wide, across cells 23 and 24 (row 2, cols 3–4). */
const ink: Paint = (img) => {
  rect(50, 38, 78, 41, 60)(img);
  rect(52, 44, 76, 47, 60)(img);
};
/** Felt-tip ink: 8 px dark, 1 px paper, over 4 × 2 cells (rows 4–5, cols 2–5). It fills more
 * than half of each cell, but it's textured, so it is not dark-and-smooth. */
const bold: Paint = (img) => {
  for (let y = 64; y < 96; y++) {
    if (y % 9 < 8) for (let x = 32; x < 96; x++) img[y * W + x] = 60;
  }
};

function paint(...paints: Paint[]): Uint8Array {
  const img = new Uint8Array(W * H).fill(240);
  for (const p of paints) p(img);
  return img;
}

function world(params?: Partial<DetectorParams>) {
  const detector = createDetector(params);
  let t = 0;
  let page = paint();
  let quad = QUAD;
  let level = 0;
  const requests: Array<{ width: number; height: number } | null> = [];
  const triggers: DetectorTriggerCore[] = [];
  const w = {
    detector,
    requests,
    triggers,
    get t() {
      return t;
    },
    show(img: Uint8Array) {
      page = img;
    },
    place(q: Quad) {
      quad = q;
    },
    /** The next sample sees motion. */
    move() {
      level = (level + 60) % 240;
    },
    step() {
      const motion = { gray: new Uint8Array(16).fill(level), width: 4, height: 4 };
      const result = detector.step(t, motion, (size) => {
        requests.push(size);
        return { raw: page, width: W, height: H, quad, found: true, frameDiagonal: 204 };
      });
      t += 200;
      if (result) triggers.push(result);
      return result;
    },
    steps(n: number) {
      for (let i = 0; i < n; i++) w.step();
    },
    stats: () => detector.stats(),
  };
  return w;
}

describe('the step order', () => {
  it('detector ignores busy samples, waits for five quiet ones, and makes the first stable, clear page the reference', () => {
    const w = world();
    w.step(); // The first sample has nothing to compare with: busy.
    expect(w.stats()).toMatchObject({ busy: true, quiet: 0, refAgeMs: null });
    w.move();
    w.step();
    expect(w.stats().busy).toBe(true);
    w.steps(4);
    expect(w.stats()).toMatchObject({ busy: false, quiet: 4, refAgeMs: null });
    expect(w.requests).toEqual([]);
    w.step();
    // The fifth quiet sample is stable: the page is sampled at its own size and becomes the
    // reference.
    expect(w.requests).toEqual([null]);
    expect(w.stats()).toMatchObject({ quiet: 5, refAgeMs: 0, cols: COLS, rows: 8, quad: QUAD });
    w.step();
    // From then on the page is sampled at the reference's fixed size.
    expect(w.requests).toEqual([null, { width: W, height: H }]);
    expect(w.stats().refAgeMs).toBe(200);
    expect(w.triggers).toEqual([]);
  });

  it('detector never takes a reference while dark cells cover the page', () => {
    const w = world();
    w.show(paint(block));
    w.steps(40); // 8 s: less than the scenery timeout.
    expect(w.stats()).toMatchObject({ occluded: true, refAgeMs: null });
    // Each occluded sample starts the count of quiet samples again.
    expect(w.requests.length).toBe(7);
    w.show(paint());
    w.move();
    w.steps(6);
    expect(w.stats()).toMatchObject({ occluded: false, refAgeMs: 0 });
  });

  it('an ink trigger waits for quietInkMs without new ink, and carries a mask and a padded crop', () => {
    const w = world();
    w.steps(6);
    w.show(paint(ink));
    w.move();
    w.steps(6); // Busy, then five quiet: the first stable comparison sees the ink.
    expect(w.stats().changed).toEqual([23, 24]);
    w.steps(9);
    expect(w.triggers).toEqual([]);
    w.step(); // 2000 ms after the ink was first seen.
    expect(w.triggers).toHaveLength(1);
    const [trigger] = w.triggers;
    expect(trigger).toMatchObject({
      reason: 'ink',
      mask: {
        cols: COLS,
        rows: 8,
        cells: [
          [3, 2],
          [4, 2],
        ],
      },
      cropRect: { x: 0.2, y: 0.125, w: 0.4, h: 0.375 },
      quad: QUAD,
      pageFound: true,
      changedCells: 2,
    });
    expect(trigger?.inkPixels).toBeGreaterThan(0);
    expect(trigger?.erasePixels).toBe(0);
    // The page became the reference: nothing is changed now.
    w.step();
    expect(w.stats()).toMatchObject({ changed: [], refAgeMs: 200, triggers: 1 });
  });

  it('ink in new cells before the quiet time is up restarts the wait', () => {
    const w = world();
    w.steps(6);
    w.show(paint(ink));
    w.move();
    w.steps(6 + 5); // Seen, and a second of quiet.
    w.show(paint(ink, rect(50, 100, 78, 103, 60)));
    w.move();
    w.steps(6 + 9); // A stroke in new cells (63, 64) resets the clock: still nothing.
    expect(w.triggers).toEqual([]);
    w.step();
    expect(w.triggers).toHaveLength(1);
    expect(w.triggers[0]?.mask?.cells).toEqual([
      [3, 2],
      [4, 2],
      [3, 6],
      [4, 6],
    ]);
  });

  it('a page whose corners move by more than 2% of the diagonal is a page event', () => {
    const w = world();
    w.steps(6);
    w.place(QUAD.map((c) => ({ x: c.x + 5, y: c.y })) as Quad);
    w.move();
    w.steps(6);
    expect(w.triggers).toHaveLength(1);
    expect(w.triggers[0]).toMatchObject({ reason: 'page', mask: null, cropRect: null });
    expect(w.requests.at(-1)).toBeNull(); // The new reference takes its size from its own quad.
  });

  it('a page event inside the minimum interval is held, then sent on the first stable, clear sample after it', () => {
    const w = world();
    w.steps(6);
    w.show(paint(ink));
    w.move();
    w.steps(16);
    expect(w.triggers.map((t) => t.reason)).toEqual(['ink']);
    const inkAt = w.t - 200;
    w.place(QUAD.map((c) => ({ x: c.x + 5, y: c.y })) as Quad);
    w.move();
    w.steps(6);
    expect(w.triggers).toHaveLength(1); // Held: it came 1.2 s after the ink.
    while (w.t < inkAt + 5000) w.step();
    expect(w.triggers).toHaveLength(1);
    w.step();
    expect(w.triggers.map((t) => [t.reason, t.t])).toEqual([
      ['ink', inkAt],
      ['page', inkAt + 5000],
    ]);
  });

  it('a sheet cleared of her ink is a page event, not an erasure', () => {
    const w = world();
    w.steps(6);
    w.show(paint(ink));
    w.move();
    w.steps(16);
    w.steps(25); // Past the minimum interval.
    w.show(paint());
    w.move();
    w.steps(6);
    expect(w.triggers.map((t) => t.reason)).toEqual(['ink', 'page']);
  });

  it('more than 40% of cells changing at once is a page event', () => {
    const w = world();
    w.steps(6);
    w.show(
      paint((img) => {
        for (let y = 4; y < H; y += 8) rect(0, y, W, y + 3, 60)(img);
      }),
    );
    w.move();
    w.steps(6);
    expect(w.triggers.map((t) => t.reason)).toEqual(['page']);
  });

  it('reset() forgets the reference, the sheet and the counts', () => {
    const w = world();
    w.steps(6);
    w.show(paint(ink));
    w.move();
    w.steps(16);
    expect(w.stats().triggers).toBe(1);
    w.detector.reset();
    expect(w.stats()).toMatchObject({ refAgeMs: null, triggers: 0, quiet: 0, changed: [] });
    w.steps(6);
    expect(w.stats().refAgeMs).toBe(0);
  });
});

describe('a dark region that never moves (re-review N1)', () => {
  it('becomes scenery after sceneryMs, so the reference is taken with it', () => {
    const w = world();
    w.show(paint(block));
    w.steps(54); // Dark from the first stable sample (1.0 s) to 10.8 s.
    expect(w.stats()).toMatchObject({ occluded: true, refAgeMs: null });
    w.steps(2); // 11.0 s: ten seconds dark.
    expect(w.stats()).toMatchObject({ occluded: false, refAgeMs: 0 });
  });

  it('still lets real ink trigger beside it', () => {
    const w = world();
    w.show(paint(block));
    w.steps(56);
    w.show(paint(block, rect(10, 100, 40, 103, 60), rect(10, 106, 40, 109, 60)));
    w.move();
    w.steps(16);
    expect(w.triggers.map((t) => t.reason)).toEqual(['ink']);
    expect(w.triggers[0]?.mask?.cells).toEqual([
      [0, 6],
      [1, 6],
      [2, 6],
    ]);
  });

  it('a hand that rests longer than sceneryMs after the reference is never sent, and leaves no ghost', () => {
    const w = world();
    w.steps(6); // A clear page: the reference.
    w.show(paint(block));
    w.move();
    w.steps(80); // 16 s of a still hand: scenery after ten.
    expect(w.stats().occluded).toBe(false);
    expect(w.triggers).toEqual([]);
    // Ink beside the resting hand is sent, without the hand's cells.
    w.show(paint(block, rect(10, 100, 40, 103, 60), rect(10, 106, 40, 109, 60)));
    w.move();
    w.steps(16);
    expect(w.triggers.map((t) => t.reason)).toEqual(['ink']);
    expect(w.triggers[0]?.mask?.cells).toEqual([
      [0, 6],
      [1, 6],
      [2, 6],
    ]);
    // The hand lifts: nothing more is sent.
    w.show(paint(rect(10, 100, 40, 103, 60), rect(10, 106, 40, 109, 60)));
    w.move();
    w.steps(40);
    expect(w.triggers.map((t) => t.reason)).toEqual(['ink']);
  });

  it('stops being scenery once it is gone, so a hand resting there later is an occluder again', () => {
    const w = world({ sceneryMs: 2000 });
    w.show(paint(block));
    w.steps(20);
    expect(w.stats().refAgeMs).not.toBeNull();
    w.show(paint());
    w.move();
    w.steps(16); // Gone: replaced as stale, or compared clean.
    w.show(paint(block));
    w.move();
    w.steps(6);
    expect(w.stats().occluded).toBe(true);
  });
});

describe('the stale rule (re-review N2)', () => {
  it('a stale reference is replaced silently after five clear samples with solid cells', () => {
    // The reference holds a dark block (taken as scenery), then the block goes: its ghost
    // shows as solid erasure where the reference was dark.
    const w = world({ sceneryMs: 1000 });
    w.show(paint(block));
    w.steps(11);
    expect(w.stats().refAgeMs).toBe(0);
    w.show(paint());
    w.move();
    w.steps(5); // Busy, then four quiet.
    for (let i = 1; i <= 4; i++) {
      w.step();
      expect(w.stats().refAgeMs, `stale sample ${i}`).toBeGreaterThan(0);
      expect(w.stats().solid.length).toBeGreaterThanOrEqual(4);
    }
    w.step();
    expect(w.stats().refAgeMs).toBe(0);
    w.steps(20);
    expect(w.triggers).toEqual([]);
  });

  it('bold ink that fills its cells is never absorbed: it triggers', () => {
    const w = world();
    w.steps(6);
    w.show(paint(bold));
    w.move();
    w.steps(6);
    expect(w.stats().solid.length).toBeGreaterThanOrEqual(4);
    w.steps(10);
    expect(w.triggers.map((t) => t.reason)).toEqual(['ink']);
    expect(w.triggers[0]?.mask?.cells.length).toBeGreaterThanOrEqual(8);
  });

  it('erasing bold ink that was on the page from the start still triggers', () => {
    const w = world();
    w.show(paint(bold));
    w.steps(6);
    expect(w.stats().refAgeMs).toBe(0);
    w.show(paint());
    w.move();
    w.steps(16);
    expect(w.triggers.map((t) => t.reason)).toEqual(['ink']);
  });
});

describe('quad jitter', () => {
  it('±2 px quad jitter over 50 stable samples emits no page event and keeps the compare size', () => {
    // slow-drift holds a still page with its printed statement: 1 busy sample, 4 quiet, then 50
    // stable ones, each warped by a freshly jittered quad.
    const run = runClip('slow-drift', { jitter: 2, untilMs: 11000 });
    expect(run.triggers).toEqual([]);
    const stable = run.log.filter((s) => s.stats.quiet >= 5);
    expect(stable).toHaveLength(50);
    expect(new Set(run.pages.map((p) => `${p.width}x${p.height}`))).toEqual(new Set(['800x608']));
    expect(stable.every((s) => s.stats.cols === 50 && s.stats.rows === 38)).toBe(true);
    expect(stable.every((s) => s.stats.changed.length === 0)).toBe(true);
  }, 60_000);
});
