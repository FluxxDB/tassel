// Runs a paper-synth clip through the change detector the way the worker will (Task 8), with
// test-only stand-ins for its browser parts:
// - frames rendered at 640 × 480, at t = 0, 200, 400 … ms, noise off unless asked (frameIndex =
//   t / 200);
// - motion is blur3(boxDownsample(toGray(frame), 160 × 120));
// - samplePage(size) warps the frame by the clip's true page quad, plus optional seeded jitter of
//   up to ±2 px per corner, to `size` or compareSize(quad, 800, 16), with bilinear sampling;
// - `fallback` stands in for a run where OpenCV never finds the page: the central 80% of the
//   frame at 640 × 480, found: false.

import { makeClip, renderFrame, type VariantName } from '@tassel/paper-synth';
import { expect } from 'vitest';
import type { DetectorStats, Pt, Quad } from '../../../../src/renderer/src/paper/contracts';
import {
  createDetector,
  type DetectorTriggerCore,
  type PageSample,
} from '../../../../src/renderer/src/paper/detector/detector';
import { blur3, boxDownsample, toGray } from '../../../../src/renderer/src/paper/detector/gray';
import {
  applyH,
  compareSize,
  homography,
} from '../../../../src/renderer/src/paper/detector/homography';
import {
  DEFAULT_PARAMS,
  type DetectorParams,
} from '../../../../src/renderer/src/paper/detector/params';

export const FRAME_W = 640;
export const FRAME_H = 480;
const UNIT: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** Bilinear warp of a gray frame: output pixel centers map through the quad. Test-only. */
export function warpGray(
  gray: Uint8Array,
  width: number,
  height: number,
  quad: Quad,
  outW: number,
  outH: number,
): Uint8Array {
  const h = homography(UNIT, quad);
  const out = new Uint8Array(outW * outH);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const p = applyH(h, { x: (x + 0.5) / outW, y: (y + 0.5) / outH });
      const fx = Math.min(width - 1, Math.max(0, p.x - 0.5));
      const fy = Math.min(height - 1, Math.max(0, p.y - 0.5));
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = Math.min(width - 1, x0 + 1);
      const y1 = Math.min(height - 1, y0 + 1);
      const ax = fx - x0;
      const ay = fy - y0;
      const top = (gray[y0 * width + x0] ?? 0) * (1 - ax) + (gray[y0 * width + x1] ?? 0) * ax;
      const bottom = (gray[y1 * width + x0] ?? 0) * (1 - ax) + (gray[y1 * width + x1] ?? 0) * ax;
      out[y * outW + x] = Math.round(top * (1 - ay) + bottom * ay);
    }
  }
  return out;
}

/** A small seeded generator, so jitter is the same on every run. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface HarnessOptions {
  noise?: boolean;
  /** Up to this many pixels of seeded jitter per corner coordinate (the brief's ±2 px). */
  jitter?: number;
  /** No page found: the central fallbackCrop of the frame, at 640 × 480. */
  fallback?: boolean;
  params?: Partial<DetectorParams>;
  /** Stop before this time (default: the clip's length). */
  untilMs?: number;
}

export interface HarnessSample {
  t: number;
  stats: Omit<DetectorStats, 'opencv'>;
}

export interface HarnessRun {
  triggers: DetectorTriggerCore[];
  stats: Omit<DetectorStats, 'opencv'>;
  log: HarnessSample[];
  /** Every quad samplePage answered with, and the size it warped to. */
  pages: Array<{ t: number; quad: Quad; width: number; height: number }>;
}

export function runClip(name: VariantName, opts: HarnessOptions = {}): HarnessRun {
  const clip = makeClip(name);
  const detector = createDetector(opts.params);
  const params = { ...DEFAULT_PARAMS, ...opts.params };
  const random = lcg(0x5eed);
  const triggers: DetectorTriggerCore[] = [];
  const log: HarnessSample[] = [];
  const pages: HarnessRun['pages'] = [];
  const until = opts.untilMs ?? clip.durationMs;
  const crop = params.fallbackCrop;
  const fallbackQuad: Quad = [
    { x: ((1 - crop) / 2) * FRAME_W, y: ((1 - crop) / 2) * FRAME_H },
    { x: ((1 + crop) / 2) * FRAME_W, y: ((1 - crop) / 2) * FRAME_H },
    { x: ((1 + crop) / 2) * FRAME_W, y: ((1 + crop) / 2) * FRAME_H },
    { x: ((1 - crop) / 2) * FRAME_W, y: ((1 + crop) / 2) * FRAME_H },
  ];
  for (let t = 0; t < until; t += params.sampleIntervalMs) {
    const rgba = renderFrame(clip, t, {
      width: FRAME_W,
      height: FRAME_H,
      noise: opts.noise ?? false,
      frameIndex: t / params.sampleIntervalMs,
    });
    const gray = toGray(rgba, FRAME_W, FRAME_H);
    const small = boxDownsample(gray, FRAME_W, FRAME_H, params.motionWidth, params.motionHeight);
    const motion = {
      gray: blur3(small, params.motionWidth, params.motionHeight),
      width: params.motionWidth,
      height: params.motionHeight,
    };
    const samplePage = (size: { width: number; height: number } | null): PageSample => {
      let quad: Quad;
      let out: { width: number; height: number };
      if (opts.fallback) {
        quad = fallbackQuad;
        out = size ?? { width: 640, height: 480 };
      } else {
        const truth = clip.pageQuadAt(t, FRAME_W, FRAME_H);
        const j = opts.jitter ?? 0;
        quad = truth.map((c: Pt) => ({
          x: c.x + (random() * 2 - 1) * j,
          y: c.y + (random() * 2 - 1) * j,
        })) as Quad;
        out = size ?? compareSize(quad, params.compareLongSide, params.cellSize);
      }
      pages.push({ t, quad, width: out.width, height: out.height });
      return {
        raw: warpGray(gray, FRAME_W, FRAME_H, quad, out.width, out.height),
        width: out.width,
        height: out.height,
        quad,
        found: !opts.fallback,
        frameDiagonal: Math.sqrt(FRAME_W * FRAME_W + FRAME_H * FRAME_H),
      };
    };
    const trigger = detector.step(t, motion, samplePage);
    if (trigger) triggers.push(trigger);
    log.push({ t, stats: detector.stats() });
  }
  return { triggers, stats: detector.stats(), log, pages };
}

/** The cells of a page-coordinate box on a cols × rows grid, widened by `margin` cells. */
export function cellsOf(
  box: { x: number; y: number; w: number; h: number },
  cols: number,
  rows: number,
  margin = 1,
): Set<number> {
  const c0 = Math.max(0, Math.floor(box.x * cols) - margin);
  const c1 = Math.min(cols - 1, Math.floor((box.x + box.w) * cols) + margin);
  const r0 = Math.max(0, Math.floor(box.y * rows) - margin);
  const r1 = Math.min(rows - 1, Math.floor((box.y + box.h) * rows) + margin);
  const cells = new Set<number>();
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells.add(r * cols + c);
  return cells;
}

/** Every expected trigger matches one actual trigger of its reason within its tolerance, in order, and there are no others. */
export function expectTheTriggers(name: VariantName, result: HarnessRun) {
  const expected = makeClip(name).truth.expectedTriggers;
  const actual = result.triggers.map((t) => `${t.reason}@${t.t}`);
  expect(
    result.triggers.map((t) => t.reason),
    `${name}: ${actual.join(', ')}`,
  ).toEqual(expected.map((e) => e.reason));
  result.triggers.forEach((trigger, i) => {
    const want = expected[i];
    if (!want) return;
    expect(
      Math.abs(trigger.t - want.atMs),
      `${name}: ${trigger.reason} at ${trigger.t}, expected ${want.atMs}`,
    ).toBeLessThanOrEqual(want.toleranceMs);
  });
}

/** The trigger's mask lies within its groups' boxes (one cell of slack), and touches each one. */
export function expectMaskOn(
  name: VariantName,
  trigger: DetectorTriggerCore | undefined,
  groups: string[],
) {
  expect(trigger?.mask, `${name} has a mask`).toBeTruthy();
  const { cols, rows, cells } = trigger?.mask ?? { cols: 0, rows: 0, cells: [] };
  const boxes = makeClip(name).truth.groups.filter((g) => groups.includes(g.id));
  expect(boxes.map((b) => b.id).sort()).toEqual([...groups].sort());
  const allowed = new Set<number>();
  for (const g of boxes) for (const c of cellsOf(g.bbox, cols, rows, 1)) allowed.add(c);
  for (const [c, r] of cells)
    expect(
      allowed.has(r * cols + c),
      `${name}: cell [${c}, ${r}] is outside ${groups.join(', ')}`,
    ).toBe(true);
  for (const g of boxes) {
    const own = cellsOf(g.bbox, cols, rows, 0);
    expect(
      cells.some(([c, r]) => own.has(r * cols + c)),
      `${name}: no cell of ${g.id}`,
    ).toBe(true);
  }
}
