// The change detector with a hand resting on the page and the sheet nudged (owner's live tests,
// 2026-10-18; Perry's audit, docs/research/2026-10-17-paper-detection-audit.md): a one-pixel
// shift of the page or camera isn't motion, a resting hand blocks only the cells near it, ink
// beside the hand waits until it leaves, and the hand never enters the reference.
import { describe, expect, it } from 'vitest';
import type { Quad } from '../../../../src/renderer/src/paper/contracts';
import {
  createDetector,
  type DetectorTriggerCore,
} from '../../../../src/renderer/src/paper/detector/detector';
import { blur3, stillFraction } from '../../../../src/renderer/src/paper/detector/gray';
import { DEFAULT_PARAMS } from '../../../../src/renderer/src/paper/detector/params';

const W = 160;
const H = 128;
const QUAD: Quad = [
  { x: 0, y: 0 },
  { x: W, y: 0 },
  { x: W, y: H },
  { x: 0, y: H },
];
const MOTION_W = 160;
const MOTION_H = 120;

const blank = () => new Uint8Array(W * H).fill(240);

function stroke(page: Uint8Array, x: number, y: number, width: number): Uint8Array {
  const out = page.slice();
  for (let row = y; row < y + 3; row++)
    for (let col = x; col < x + width; col++) out[row * W + col] = 40;
  return out;
}

/** A resting hand: a smooth, darker block over cells (0..2, 0..2), the page's top left. */
function withHand(page: Uint8Array): Uint8Array {
  const out = page.slice();
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) out[y * W + x] = 120;
  return out;
}

/** A still motion image with the page's bright block shifted by (dx, dy). */
function motionImage(dx = 0, dy = 0): Uint8Array {
  const gray = new Uint8Array(MOTION_W * MOTION_H).fill(45);
  for (let y = 20 + dy; y < 100 + dy; y++)
    for (let x = 40 + dx; x < 120 + dx; x++) gray[y * MOTION_W + x] = 240;
  return blur3(gray, MOTION_W, MOTION_H);
}

function scene() {
  const detector = createDetector();
  let page: Uint8Array = blank();
  let motion = motionImage();
  let t = 0;
  const triggers: DetectorTriggerCore[] = [];
  const step = () => {
    const result = detector.step(t, { gray: motion, width: MOTION_W, height: MOTION_H }, () => ({
      raw: page,
      width: W,
      height: H,
      quad: QUAD,
      found: true,
      frameDiagonal: 204,
    }));
    t += DEFAULT_PARAMS.sampleIntervalMs;
    if (result) triggers.push(result);
  };
  return {
    detector,
    triggers,
    show(value: Uint8Array) {
      page = value;
    },
    move(dx: number, dy: number) {
      motion = motionImage(dx, dy);
    },
    steps(n: number) {
      for (let i = 0; i < n; i++) step();
    },
  };
}

/**
 * Enough samples for the quiet wait, the ink's quiet time and the trigger interval, and under
 * sceneryMs (10 s): a dark patch perfectly still for longer is taken for the desk or a print.
 */
const SETTLE = 40;

describe('slight movement', () => {
  it('a one-pixel shift of the page or camera is no motion, and a moving hand still is', () => {
    const delta = DEFAULT_PARAMS.motionDelta;
    expect(stillFraction(motionImage(0), motionImage(1), MOTION_W, MOTION_H, delta)).toBe(0);
    expect(stillFraction(motionImage(0), motionImage(0, -2), MOTION_W, MOTION_H, delta)).toBe(0);
    const hand = motionImage();
    for (let y = 30; y < 70; y++) for (let x = 50; x < 90; x++) hand[y * MOTION_W + x] = 90;
    expect(stillFraction(motionImage(), hand, MOTION_W, MOTION_H, delta)).toBeGreaterThan(
      DEFAULT_PARAMS.busyFraction,
    );
  });

  it('a sheet nudged back and forth between samples still reaches a quiet, compared page', () => {
    const s = scene();
    for (let i = 0; i < 20; i++) {
      s.move(i % 2, 0);
      s.steps(1);
    }
    expect(s.detector.stats()).toMatchObject({ busy: false });
    expect(s.detector.stats().quiet).toBeGreaterThanOrEqual(DEFAULT_PARAMS.stableSamples);
    expect(s.detector.stats().refAgeMs).not.toBeNull();
  });
});

describe('a hand resting on the page', () => {
  it('keeps comparing under a resting hand, and sends the ink the moment it leaves', () => {
    const s = scene();
    s.steps(10);
    const ink = stroke(blank(), 110, 100, 30);
    s.show(withHand(ink));
    s.steps(SETTLE);
    // No image with a hand in it, but the page is still compared and the ink is pending.
    expect(s.triggers).toHaveLength(0);
    expect(s.detector.stats()).toMatchObject({ occluded: true, busy: false });
    expect(s.detector.stats().changed.length).toBeGreaterThan(0);
    s.show(ink);
    s.steps(SETTLE);
    expect(s.triggers).toHaveLength(1);
    const trigger = s.triggers[0] as DetectorTriggerCore;
    expect(trigger.reason).toBe('ink');
    // The hand's 3 × 3 cells at the page's top left, as (col, row) pairs in the mask.
    const mask = trigger.mask?.cells ?? [];
    expect(mask.length).toBeGreaterThan(0);
    expect(mask.filter(([col, row]) => col <= 2 && row <= 2)).toEqual([]);
  });

  it('holds ink beside the hand until the hand leaves', () => {
    const s = scene();
    s.steps(10);
    const ink = stroke(blank(), 52, 20, 20);
    s.show(withHand(ink));
    s.steps(SETTLE);
    expect(s.triggers).toHaveLength(0);
    s.show(ink);
    s.steps(SETTLE);
    expect(s.triggers).toHaveLength(1);
    expect(s.triggers[0]?.reason).toBe('ink');
  });

  it('never takes the hand into the reference: a hand that comes and goes is no change', () => {
    const s = scene();
    s.steps(10);
    s.show(withHand(blank()));
    s.steps(SETTLE);
    s.show(blank());
    s.steps(SETTLE);
    expect(s.triggers).toHaveLength(0);
    expect(s.detector.stats().changed).toEqual([]);
    // And ink written meanwhile, under or beside it, still goes out once.
    const ink = stroke(blank(), 52, 20, 20);
    s.show(withHand(ink));
    s.steps(SETTLE);
    s.show(ink);
    s.steps(SETTLE * 2);
    expect(s.triggers).toHaveLength(1);
  });
});
