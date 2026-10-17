import { describe, expect, it } from 'vitest';
import {
  blur3,
  boxDownsample,
  movingFraction,
  toGray,
} from '../../../../src/renderer/src/paper/detector/gray';

describe('toGray', () => {
  it('uses the integer BT.601 weights', () => {
    const rgba = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
    ]);
    // (77R + 150G + 29B) >> 8: pure red gives 76, green 149, blue 28, white 255.
    expect([...toGray(rgba, 4, 1)]).toEqual([76, 149, 28, 255]);
  });
});

describe('boxDownsample', () => {
  it('averages whole blocks', () => {
    const gray = new Uint8Array([
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160,
    ]);
    // 4 × 4 to 2 × 2: each output is the mean of a 2 × 2 block.
    expect([...boxDownsample(gray, 4, 4, 2, 2)]).toEqual([35, 55, 115, 135]);
  });

  it('handles sizes that do not divide evenly', () => {
    const gray = new Uint8Array(5 * 3).fill(200);
    const out = boxDownsample(gray, 5, 3, 2, 2);
    expect([...out]).toEqual([200, 200, 200, 200]);
  });
});

describe('blur3', () => {
  it('is a 3 × 3 box blur that repeats the edge pixels', () => {
    const gray = new Uint8Array(5 * 5);
    gray[12] = 90; // the center pixel
    const out = blur3(gray, 5, 5);
    expect(out[12]).toBe(10);
    expect(out[6]).toBe(10);
    expect(out[0]).toBe(0);
    const flat = blur3(new Uint8Array(9).fill(77), 3, 3);
    expect([...flat]).toEqual(new Array(9).fill(77));
  });
});

describe('movingFraction', () => {
  it('counts only pixels past delta', () => {
    const a = new Uint8Array([100, 100, 100, 100, 100, 100, 100, 100]);
    const b = new Uint8Array([100, 115, 116, 84, 85, 200, 0, 100]);
    // |Δ| = 0, 15, 16, 16, 15, 100, 100, 0: four of eight are past 15.
    expect(movingFraction(a, b, 15)).toBe(4 / 8);
    expect(movingFraction(a, a, 15)).toBe(0);
  });
});
