import { describe, expect, it } from 'vitest';
import { boxBlur, normalizeLighting } from '../../../../src/renderer/src/paper/detector/normalize';

/** The obvious blur: the mean of the in-bounds pixels within `size`/2 of each pixel. */
function naiveBlur(gray: ArrayLike<number>, w: number, h: number, size: number): number[] {
  const r = Math.floor(size / 2);
  const out: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) {
        for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
          sum += gray[yy * w + xx] ?? 0;
          n++;
        }
      }
      out.push(sum / n);
    }
  }
  return out;
}

describe('boxBlur', () => {
  it('matches a naive blur on a 7×5 image', () => {
    const gray = new Uint8Array(35).map((_, i) => (i * 37 + 11) % 251);
    for (const size of [3, 5]) {
      const fast = boxBlur(gray, 7, 5, size);
      const slow = naiveBlur(gray, 7, 5, size);
      expect(fast).toHaveLength(35);
      for (let i = 0; i < 35; i++) expect(fast[i]).toBeCloseTo(slow[i] ?? 0, 3);
    }
  });

  it('blurs floats too', () => {
    const values = new Float32Array([0.5, 1, 1.5, 2, 2.5, 3]);
    expect([...boxBlur(values, 3, 2, 3)].map((v) => Number(v.toFixed(4)))).toEqual(
      naiveBlur(values, 3, 2, 3).map((v) => Number(v.toFixed(4))),
    );
  });
});

describe('normalizeLighting', () => {
  it('flattens a left-to-right gradient to 1.0 ± 0.02 away from the edges', () => {
    const w = 200;
    const h = 60;
    const gray = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) gray[y * w + x] = 120 + Math.round(x * 0.6);
    const norm = normalizeLighting(gray, w, h, 31);
    for (let y = 16; y < h - 16; y++) {
      for (let x = 16; x < w - 16; x++) {
        expect(Math.abs((norm[y * w + x] ?? 0) - 1), `${x},${y}`).toBeLessThanOrEqual(0.02);
      }
    }
  });

  it('keeps ink dark against a brighter page, whatever the lighting', () => {
    const w = 64;
    const h = 64;
    const lit = (scale: number) => {
      const gray = new Uint8Array(w * h).fill(Math.round(240 * scale));
      for (let y = 30; y < 33; y++)
        for (let x = 10; x < 54; x++) gray[y * w + x] = Math.round(70 * scale);
      return normalizeLighting(gray, w, h, 31);
    };
    const bright = lit(1);
    const dim = lit(0.85);
    const at = 31 * w + 32;
    expect(bright[at]).toBeLessThan(0.35);
    expect(Math.abs((bright[at] ?? 0) - (dim[at] ?? 0))).toBeLessThan(0.01);
  });

  it('never divides by zero', () => {
    const norm = normalizeLighting(new Uint8Array(16), 4, 4, 3);
    expect([...norm].every(Number.isFinite)).toBe(true);
  });
});
