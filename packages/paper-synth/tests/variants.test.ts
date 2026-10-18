import { describe, expect, it } from 'vitest';
import { makeClip, renderFrame, VARIANTS, type VariantName } from '../src/index.ts';
import { strokeWidthsOf } from '../src/scene.ts';

type Row = { seconds: number; triggers: Array<['ink' | 'page', number, string[]]> };

// The plan's variant table, plus the three variants the re-review added (N1, N2).
const TABLE: Record<VariantName, Row> = {
  'dfa-demo': {
    seconds: 56,
    triggers: [
      ['ink', 26.7, ['start', 'q0', 'q0-q1', 'q1', 'q1-q2', 'q2', 'q2-q3', 'q3']],
      ['ink', 38.5, ['loop-q3']],
      ['ink', 47.1, ['loop-q0']],
    ],
  },
  'dfa-short': { seconds: 20, triggers: [['ink', 11.5, ['q0']]] },
  'hand-rests': { seconds: 18, triggers: [['ink', 13.5, ['q0']]] },
  'starts-with-hand': { seconds: 16, triggers: [['ink', 12.5, ['q1']]] },
  'shadow-pass': { seconds: 12, triggers: [] },
  'exposure-step': { seconds: 12, triggers: [] },
  'page-shift': { seconds: 12, triggers: [['page', 4.4, []]] },
  'slide-and-hold': {
    seconds: 20,
    triggers: [
      ['page', 7.5, []],
      ['ink', 15.5, ['q1']],
    ],
  },
  'page-flip': {
    seconds: 18,
    triggers: [
      ['ink', 7.5, ['q0']],
      ['page', 14.1, []],
    ],
  },
  erase: { seconds: 14, triggers: [['ink', 7.0, ['q0-label-erase']]] },
  'slow-drift': { seconds: 45, triggers: [] },
  'printed-box': { seconds: 22, triggers: [['ink', 18.5, ['q0']]] },
  'dark-desk': { seconds: 22, triggers: [['ink', 18.5, ['q0']]] },
  'bold-pen': { seconds: 12, triggers: [['ink', 7.5, ['q0']]] },
  'nudge-while-writing': { seconds: 18, triggers: [['ink', 12.5, ['q1']]] },
};

const W = 320;
const H = 240;
const frame = (name: VariantName, t: number) =>
  renderFrame(makeClip(name), t, { width: W, height: H });

/** Mean of (R + G + B) / 3 over a rectangle of a frame, in 0–255. */
function mean(rgba: Uint8ClampedArray, x0: number, y0: number, x1: number, y1: number): number {
  let sum = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      sum += ((rgba[i] ?? 0) + (rgba[i + 1] ?? 0) + (rgba[i + 2] ?? 0)) / 3;
    }
  }
  return sum / ((x1 - x0) * (y1 - y0));
}

const sameBytes = (a: Uint8ClampedArray, b: Uint8ClampedArray) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

describe('the variant table', () => {
  it('names every variant', () => {
    expect([...VARIANTS].sort()).toEqual(Object.keys(TABLE).sort());
  });

  it.each(VARIANTS)('%s has its length and its expected triggers', (name) => {
    const clip = makeClip(name);
    const row = TABLE[name];
    expect(clip.name).toBe(name);
    expect(clip.durationMs).toBe(row.seconds * 1000);
    expect(clip.truth.expectedTriggers).toEqual(
      row.triggers.map(([reason, at, groups]) => ({
        reason,
        atMs: Math.round(at * 1000),
        toleranceMs: 700,
        groups,
      })),
    );
    const ids = new Set(clip.truth.groups.map((g) => g.id));
    for (const t of clip.truth.expectedTriggers) for (const g of t.groups) expect(ids).toContain(g);
  });
});

describe('the scripts', () => {
  it('opens both app clips with 6 s of blank page', () => {
    for (const name of ['dfa-demo', 'dfa-short'] as const) {
      const { truth } = makeClip(name);
      expect(Math.min(...truth.groups.map((g) => g.startMs)), name).toBe(6000);
      expect(truth.hand[0]?.fromMs, name).toBe(5600);
      expect(sameBytes(frame(name, 0), frame(name, 5500)), name).toBe(true);
    }
  });

  it('page-shift slides the page 60 px right between 3.0 and 3.4 s', () => {
    const clip = makeClip('page-shift');
    const before = clip.pageQuadAt(3000, 960, 720);
    const after = clip.pageQuadAt(3400, 960, 720);
    for (let k = 0; k < 4; k++) {
      expect((after[k]?.x ?? 0) - (before[k]?.x ?? 0)).toBeCloseTo(60, 9);
      expect(after[k]?.y).toBeCloseTo(before[k]?.y ?? 0, 9);
    }
    expect(clip.pageQuadAt(0, 960, 720)).toEqual(before);
    expect(clip.pageQuadAt(12000, 960, 720)).toEqual(after);
    expect(clip.truth.hand).toEqual([]);
  });

  it('slide-and-hold slides the page while the hand holds it, then the hand leaves by 6.5 s', () => {
    const clip = makeClip('slide-and-hold');
    const dx =
      (clip.pageQuadAt(2400, 960, 720)[0]?.x ?? 0) - (clip.pageQuadAt(2000, 960, 720)[0]?.x ?? 0);
    expect(dx).toBeCloseTo(60, 9);
    expect(clip.truth.hand).toContainEqual({
      fromMs: 2400,
      toMs: 6000,
      onPage: true,
      moving: false,
    });
    expect(clip.truth.hand.find((h) => h.fromMs === 6000)?.toMs).toBe(6500);
  });

  it('page-flip lays a fresh sheet of the same worksheet in the same place', () => {
    // Before any handwriting, and after the fresh sheet lies down and the hand leaves, the
    // frames are the same bytes: the same quad, the same print, no handwriting.
    expect(sameBytes(frame('page-flip', 1000), frame('page-flip', 14000))).toBe(true);
    expect(sameBytes(frame('page-flip', 1000), frame('page-flip', 8000))).toBe(false);
    const clip = makeClip('page-flip');
    expect(clip.pageQuadAt(14000, 960, 720)).toEqual(clip.pageQuadAt(1000, 960, 720));
  });

  it('erase removes the label and nothing else by 3.5 s', () => {
    const clip = makeClip('erase');
    const label = clip.truth.groups.find((g) => g.id === 'q0-label-erase');
    expect(label).toMatchObject({ startMs: 2000, endMs: 3500 });
    // The erased label's box shows the same page as a blank sheet.
    const [tl, tr, , bl] = clip.pageQuadAt(0, W, H);
    // The page is a rotated rectangle, so page coordinates map to pixels affinely.
    const px = (u: number, v: number) => ({
      x: tl.x + u * (tr.x - tl.x) + v * (bl.x - tl.x),
      y: tl.y + u * (tr.y - tl.y) + v * (bl.y - tl.y),
    });
    const b = label?.bbox ?? { x: 0, y: 0, w: 0, h: 0 };
    const corners = [
      px(b.x, b.y),
      px(b.x + b.w, b.y),
      px(b.x + b.w, b.y + b.h),
      px(b.x, b.y + b.h),
    ];
    // The largest pixel rectangle inside the rotated box.
    const xs = corners.map((c) => c.x).sort((m, n) => m - n);
    const ys = corners.map((c) => c.y).sort((m, n) => m - n);
    const x0 = Math.ceil(xs[1] ?? 0);
    const x1 = Math.floor(xs[2] ?? 0);
    const y0 = Math.ceil(ys[1] ?? 0);
    const y1 = Math.floor(ys[2] ?? 0);
    expect(x1 - x0).toBeGreaterThan(4);
    expect(y1 - y0).toBeGreaterThan(4);
    const blank = frame('shadow-pass', 0);
    expect(mean(frame('erase', 5000), x0, y0, x1, y1)).toBeCloseTo(mean(blank, x0, y0, x1, y1), 6);
    expect(mean(frame('erase', 1000), x0, y0, x1, y1)).toBeLessThan(
      mean(blank, x0, y0, x1, y1) - 5,
    );
  });

  it('exposure-step drops the brightness 15% at 3.0 s, and it stays', () => {
    const at = (t: number) => mean(frame('exposure-step', t), 0, 0, W, H);
    expect(at(2900) / at(1000)).toBeCloseTo(1, 3);
    expect(at(3000) / at(1000)).toBeCloseTo(0.85, 2);
    expect(at(11900) / at(1000)).toBeCloseTo(0.85, 2);
  });

  it('slow-drift loses 8% of its brightness across 40 s', () => {
    const at = (t: number) => mean(frame('slow-drift', t), 0, 0, W, H);
    expect(at(20000) / at(0)).toBeCloseTo(0.96, 2);
    expect(at(40000) / at(0)).toBeCloseTo(0.92, 2);
    // A sample interval apart, the change is far below anything the detector calls motion.
    expect(at(20200) - at(20000)).toBeGreaterThan(-0.2);
  });

  it('shadow-pass darkens the page at most 25% as it crosses, between 2.0 and 5.0 s', () => {
    const blank = mean(frame('shadow-pass', 0), 0, 0, W, H);
    expect(mean(frame('shadow-pass', 3500), 0, 0, W, H)).toBeLessThan(blank - 5);
    expect(sameBytes(frame('shadow-pass', 0), frame('shadow-pass', 6000))).toBe(true);
    let darkest = 1;
    const a = frame('shadow-pass', 0);
    for (let t = 2000; t <= 5000; t += 250) {
      const b = frame('shadow-pass', t);
      for (let i = 0; i < a.length; i += 4) darkest = Math.min(darkest, (b[i] ?? 0) / (a[i] ?? 1));
    }
    expect(darkest).toBeGreaterThan(0.73);
    expect(darkest).toBeLessThan(0.78);
  });

  it('hand-rests holds the hand still from 4.4 to 10.0 s', () => {
    expect(sameBytes(frame('hand-rests', 5000), frame('hand-rests', 9800))).toBe(true);
    expect(sameBytes(frame('hand-rests', 5000), frame('hand-rests', 10200))).toBe(false);
  });

  it('printed-box prints a dark solid box on the worksheet', () => {
    const box = makeClip('printed-box');
    const plain = mean(frame('dfa-short', 0), 0, 0, W, H);
    expect(mean(frame('printed-box', 0), 0, 0, W, H)).toBeLessThan(plain - 1);
    expect(box.truth.groups.map((g) => g.id)).toEqual(['q0']);
  });

  it('dark-desk lays a smaller page on a dark desk, so the central 80% shows desk', () => {
    const rgba = frame('dark-desk', 0);
    const quad = makeClip('dark-desk').pageQuadAt(0, W, H);
    // The page is 70% of the frame high.
    expect((quad[3]?.y ?? 0) - (quad[0]?.y ?? 0)).toBeCloseTo(0.7 * H, 0);
    // Inside the central 80% (x from 32 to 288), left of the page: dark desk.
    expect(mean(rgba, 34, 100, 44, 140)).toBeLessThan(100);
    expect(mean(rgba, 150, 100, 170, 140)).toBeGreaterThan(230);
  });

  it('keeps the hand moving while it draws: never five quiet samples in a row', () => {
    // The detector's motion rule (Task 7): 5 fps samples, gray at 160 × 120 after a 3 × 3 box
    // blur; a sample is quiet unless more than 0.5% of pixels change by more than 15/255. Five
    // quiet samples make a stable one, which must never come while the hand is moving.
    const motion = (rgba: Uint8ClampedArray) => {
      const [w, h, mw, mh] = [640, 480, 160, 120];
      const small = new Float64Array(mw * mh);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const gray =
            (77 * (rgba[i] ?? 0) + 150 * (rgba[i + 1] ?? 0) + 29 * (rgba[i + 2] ?? 0)) >> 8;
          small[(y >> 2) * mw + (x >> 2)] += gray / 16;
        }
      }
      const out = new Float64Array(mw * mh);
      for (let y = 0; y < mh; y++) {
        for (let x = 0; x < mw; x++) {
          let sum = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const xx = Math.min(mw - 1, Math.max(0, x + dx));
              const yy = Math.min(mh - 1, Math.max(0, y + dy));
              sum += small[yy * mw + xx] ?? 0;
            }
          }
          out[y * mw + x] = sum / 9;
        }
      }
      return out;
    };
    for (const name of VARIANTS) {
      const clip = makeClip(name);
      for (const interval of clip.truth.hand.filter((h) => h.moving)) {
        let previous = motion(renderFrame(clip, interval.fromMs, { width: 640, height: 480 }));
        let quietRun = 0;
        for (let t = interval.fromMs + 200; t <= interval.toMs; t += 200) {
          const current = motion(renderFrame(clip, t, { width: 640, height: 480 }));
          let moved = 0;
          for (let i = 0; i < current.length; i++) {
            if (Math.abs((current[i] ?? 0) - (previous[i] ?? 0)) > 15) moved++;
          }
          quietRun = moved > 0.005 * current.length ? 0 : quietRun + 1;
          expect(quietRun, `${name} at ${t}`).toBeLessThan(5);
          previous = current;
        }
      }
    }
  }, 60_000);

  it('bold-pen draws q0 with a felt-tip, strokes 0.625% of the page width', () => {
    expect(strokeWidthsOf(makeClip('bold-pen'))).toEqual([0.00625]);
    expect(strokeWidthsOf(makeClip('dfa-short'))).toEqual([0.0035]);
  });
});
