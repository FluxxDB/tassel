// The frames of Ada's two effects: the pulse's ring and the glide's token, at time t of each.
import { describe, expect, it } from 'vitest';
import { MOTION } from '../../../../src/renderer/src/board/motion';
import {
  cubicBezier,
  glideTokenAt,
  pulseRingAt,
} from '../../../../src/renderer/src/board/tldraw/effect-frames';

describe('cubicBezier', () => {
  it("reads MOTION's easings and runs from 0 to 1", () => {
    for (const css of [MOTION.ease, MOTION.glideEase]) {
      const ease = cubicBezier(css);
      expect(ease(0)).toBe(0);
      expect(ease(1)).toBe(1);
    }
  });

  it('matches CSS: the exponential ease-out is mostly done by halfway, the glide symmetric', () => {
    expect(cubicBezier(MOTION.ease)(0.5)).toBeGreaterThan(0.85);
    expect(cubicBezier(MOTION.glideEase)(0.5)).toBeCloseTo(0.5, 5);
    expect(cubicBezier(MOTION.glideEase)(0.25)).toBeLessThan(0.25);
    expect(cubicBezier('linear')(0.3)).toBeCloseTo(0.3, 5);
  });
});

describe('pulseRingAt', () => {
  it('grows from r + 4 to r + 14 and fades out over its time', () => {
    expect(pulseRingAt(32, 0)).toEqual({ r: 36, alpha: 1 });
    const end = pulseRingAt(32, MOTION.pulseMs);
    expect(end.r).toBeCloseTo(46, 5);
    expect(end.alpha).toBeCloseTo(0, 5);
    const mid = pulseRingAt(32, MOTION.pulseMs / 2);
    expect(mid.r).toBeGreaterThan(36);
    expect(mid.r).toBeLessThan(46);
    expect(mid.alpha).toBeGreaterThan(0);
    expect(mid.alpha).toBeLessThan(1);
  });

  it('holds its last frame past its time', () => {
    expect(pulseRingAt(32, MOTION.pulseMs * 3)).toEqual(pulseRingAt(32, MOTION.pulseMs));
  });
});

describe('glideTokenAt', () => {
  const edges = [
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    [
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 100, y: 100 },
    ],
  ];

  it('takes MOTION.glideMs per edge, along each edge in turn', () => {
    expect(glideTokenAt(edges, 0)).toEqual({ x: 0, y: 0 });
    expect(glideTokenAt(edges, MOTION.glideMs)).toEqual({ x: 100, y: 0 });
    expect(glideTokenAt(edges, 2 * MOTION.glideMs)).toEqual({ x: 100, y: 100 });
    // Halfway through the second edge, by its eased progress and its length.
    const half = glideTokenAt(edges, 1.5 * MOTION.glideMs);
    expect(half?.x).toBe(100);
    expect(half?.y).toBeCloseTo(50, 5);
  });

  it('stays at the end once done, and at the start with no edges', () => {
    expect(glideTokenAt(edges, 10 * MOTION.glideMs)).toEqual({ x: 100, y: 100 });
    expect(glideTokenAt([], 100)).toBeNull();
  });
});
