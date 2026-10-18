// Diagnostic reproductions of the ORIGINAL detector's limitations, not desired behavior.
// Replace these expectations with corrective regression tests when addressing each finding.
import { describe, expect, it } from 'vitest';
import type { Quad } from '../../../src/renderer/src/paper/contracts';
import {
  createDetector,
  type DetectorTriggerCore,
  type PageSample,
} from '../../../src/renderer/src/paper/detector/detector';
import { createFrameLoop } from '../../../src/renderer/src/paper/detector/frame-loop';
import { blur3, movingFraction } from '../../../src/renderer/src/paper/detector/gray';
import { DEFAULT_PARAMS } from '../../../src/renderer/src/paper/detector/params';

const W = 160;
const H = 128;
const QUAD: Quad = [
  { x: 0, y: 0 },
  { x: W, y: 0 },
  { x: W, y: H },
  { x: 0, y: H },
];
const blank = () => new Uint8Array(W * H).fill(240);
function stroke(page: Uint8Array, x: number, y: number, width: number) {
  for (let row = y; row < y + 3; row++)
    for (let col = x; col < x + width; col++) page[row * W + col] = 40;
}
function scene(found = true) {
  const detector = createDetector();
  let page: Uint8Array = blank();
  let t = 0;
  let lookups = 0;
  const triggers: DetectorTriggerCore[] = [];
  const step = (motion = new Uint8Array(160 * 120).fill(128)) => {
    const result = detector.step(t, { gray: motion, width: 160, height: 120 }, () => {
      lookups++;
      return { raw: page, width: W, height: H, quad: QUAD, found, frameDiagonal: 204 };
    });
    t += 200;
    if (result) triggers.push(result);
  };
  return {
    detector,
    triggers,
    step,
    show(value: Uint8Array) {
      page = value;
    },
    steps(n: number) {
      for (let i = 0; i < n; i++) step();
    },
    lookups: () => lookups,
  };
}

describe('original pipeline audit: known limitations', () => {
  it('does not upload an already-written stationary page (confirms the first-upload addition is reverted)', () => {
    const s = scene();
    const page = blank();
    stroke(page, 50, 38, 28);
    s.show(page);
    s.steps(100);
    expect(s.detector.stats().refAgeMs).not.toBeNull();
    expect(s.triggers).toHaveLength(0);
  });

  it('97 moving motion pixels outside the paper prevent ALL page lookup for 10 seconds', () => {
    const s = scene();
    for (let tick = 0; tick < 50; tick++) {
      const motion = new Uint8Array(160 * 120).fill(128);
      if (tick % 2) motion.fill(160, 0, 97);
      s.step(motion);
    }
    expect(s.lookups()).toBe(0);
    expect(s.detector.stats()).toMatchObject({ busy: true, quiet: 0 });
    // 97/19200 = 0.5052%, just over the global 0.5% threshold.
  });

  it('a one-pixel horizontal shift of a clean page exceeds the whole-frame motion threshold', () => {
    const image = (shift: number) => {
      const gray = new Uint8Array(160 * 120).fill(45);
      for (let y = 20; y < 100; y++)
        for (let x = 40 + shift; x < 120 + shift; x++) gray[y * 160 + x] = 240;
      return blur3(gray, 160, 120);
    };
    const fraction = movingFraction(image(0), image(1), DEFAULT_PARAMS.motionDelta);
    console.log(
      `audit: one-pixel page shift changes ${(fraction * 100).toFixed(3)}% of motion pixels; limit is ${DEFAULT_PARAMS.busyFraction * 100}%`,
    );
    expect(fraction).toBeGreaterThan(DEFAULT_PARAMS.busyFraction);
  });

  it('the displayed changed count remains stale while later frames are busy', () => {
    const s = scene();
    s.steps(6);
    const page = blank();
    stroke(page, 50, 38, 28);
    s.show(page);
    s.step();
    const before = s.detector.stats().changed;
    expect(before.length).toBeGreaterThan(0);
    s.step(new Uint8Array(160 * 120).fill(180));
    expect(s.detector.stats()).toMatchObject({ quiet: 0, busy: true, changed: before });
  });

  it('a small stroke confined to one cell never uploads and is absorbed into the refreshed reference', () => {
    const s = scene();
    s.steps(6);
    const page = blank();
    stroke(page, 52, 38, 8);
    s.show(page);
    s.step();
    expect(s.detector.stats().changed).toHaveLength(1);
    s.steps(160);
    expect(s.triggers).toHaveLength(0);
    expect(s.detector.stats().changed).toHaveLength(0);
  });

  it('can emit an ink upload from a fallback crop with NO detected paper', () => {
    const s = scene(false);
    s.steps(6);
    const background = blank();
    stroke(background, 50, 38, 28);
    s.show(background);
    s.steps(20);
    expect(s.triggers.length).toBeGreaterThan(0);
    expect(s.triggers[0]).toMatchObject({ reason: 'ink', pageFound: false });
  });

  it('continues to label the last page quad as found after 30 seconds of failed detections', async () => {
    const observed: PageSample[] = [];
    let attempts = 0;
    const quad: Quad = [
      { x: 80, y: 60 },
      { x: 880, y: 60 },
      { x: 880, y: 660 },
      { x: 80, y: 660 },
    ];
    const original = createDetector();
    const loop = createFrameLoop({
      detector: {
        ...original,
        step: (_t, _motion, sample) => {
          observed.push(sample(null));
          return null;
        },
      },
      params: { ...DEFAULT_PARAMS },
      contentRect: null,
      opencv: Promise.resolve(true),
      readRgba: (_frame, width, height) => new Uint8ClampedArray(width * height * 4).fill(200),
      findQuad: () => (attempts++ === 0 ? quad : null),
      warpGray: (_rgba, _w, _h, _q, outW, outH) => new Uint8Array(outW * outH).fill(240),
      encodeFull: async () => new Blob(),
      encodeCrop: async () => new Blob(),
      now: () => 0,
      post: () => {},
    });
    await Promise.resolve();
    for (const timestamp of [0, 200_000, 30_000_000]) {
      await loop.push({ timestamp, displayWidth: 960, displayHeight: 720, close() {} });
    }
    expect(attempts).toBe(3);
    expect(observed.map((p) => p.found)).toEqual([true, true, true]);
    expect(observed[2]?.quad).toEqual(quad);
    loop.stop();
  });
});
