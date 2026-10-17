import { describe, expect, it } from 'vitest';
import type { Quad } from '../../../../src/renderer/src/paper/contracts';
import {
  applyH,
  compareSize,
  homography,
  invertH,
  quadShift,
} from '../../../../src/renderer/src/paper/detector/homography';

const unit: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
// The synthetic clip's Letter page at 960 × 720 (tilted −1.4°), with its bottom-right corner
// nudged 3 px for a little perspective.
const page: Quad = [
  { x: 71.9, y: 60.3 },
  { x: 872.9, y: 40.7 },
  { x: 891.1, y: 659.7 },
  { x: 87.0, y: 679.3 },
];

describe('homography', () => {
  it('maps the corners exactly and invertH round-trips within 1e-9', () => {
    const h = homography(unit, page);
    unit.forEach((corner, i) => {
      const mapped = applyH(h, corner);
      expect(mapped.x).toBeCloseTo(page[i]?.x ?? 0, 9);
      expect(mapped.y).toBeCloseTo(page[i]?.y ?? 0, 9);
    });
    const back = invertH(h);
    for (const p of [
      { x: 0.25, y: 0.75 },
      { x: 0.5, y: 0.5 },
      { x: 0.9, y: 0.1 },
    ]) {
      const there = applyH(h, p);
      const again = applyH(back, there);
      expect(Math.abs(again.x - p.x)).toBeLessThan(1e-9);
      expect(Math.abs(again.y - p.y)).toBeLessThan(1e-9);
    }
  });

  it('maps quad to quad in either direction', () => {
    const h = homography(page, unit);
    page.forEach((corner, i) => {
      const mapped = applyH(h, corner);
      expect(mapped.x).toBeCloseTo(unit[i]?.x ?? 0, 9);
      expect(mapped.y).toBeCloseTo(unit[i]?.y ?? 0, 9);
    });
  });
});

describe('quadShift', () => {
  it('is the largest corner distance', () => {
    const moved: Quad = [
      { x: 71.9, y: 60.3 },
      { x: 875.9, y: 44.7 },
      { x: 891.1, y: 659.7 },
      { x: 87.0, y: 678.3 },
    ];
    expect(quadShift(page, moved)).toBeCloseTo(5, 9);
    expect(quadShift(page, page)).toBe(0);
  });
});

describe('compareSize', () => {
  it('keeps the long side at 800 and floors the short side: Letter landscape gives 800×608', () => {
    const letter: Quad = [
      { x: 0, y: 0 },
      { x: 1100, y: 0 },
      { x: 1100, y: 850 },
      { x: 0, y: 850 },
    ];
    expect(compareSize(letter, 800, 16)).toEqual({ width: 800, height: 608 });
    const portrait: Quad = [
      { x: 0, y: 0 },
      { x: 850, y: 0 },
      { x: 850, y: 1100 },
      { x: 0, y: 1100 },
    ];
    expect(compareSize(portrait, 800, 16)).toEqual({ width: 608, height: 800 });
  });

  it('measures a tilted page by its sides', () => {
    expect(compareSize(page, 800, 16)).toEqual({ width: 800, height: 608 });
  });
});
