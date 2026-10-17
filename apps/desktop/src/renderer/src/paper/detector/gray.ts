// Gray images for the change detector: conversion, downsampling, a small blur and the motion
// measure. Pure functions over typed arrays, so the worker and Node's tests share them.

/** RGBA to gray with the integer BT.601 weights: (77R + 150G + 29B) >> 8. */
export function toGray(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const n = width * height;
  const gray = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    gray[i] =
      (77 * (rgba[j] as number) + 150 * (rgba[j + 1] as number) + 29 * (rgba[j + 2] as number)) >>
      8;
  }
  return gray;
}

/** Each output pixel is the mean of the source pixels in its footprint. */
export function boxDownsample(
  gray: Uint8Array,
  w: number,
  h: number,
  outW: number,
  outH: number,
): Uint8Array {
  const out = new Uint8Array(outW * outH);
  for (let oy = 0; oy < outH; oy++) {
    const y0 = Math.floor((oy * h) / outH);
    const y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * h) / outH));
    for (let ox = 0; ox < outW; ox++) {
      const x0 = Math.floor((ox * w) / outW);
      const x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * w) / outW));
      let sum = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * w;
        for (let x = x0; x < x1; x++) sum += gray[row + x] as number;
      }
      out[oy * outW + ox] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
    }
  }
  return out;
}

/** A 3 × 3 box blur; pixels past the edge repeat the edge. */
export function blur3(gray: Uint8Array, w: number, h: number): Uint8Array {
  const rows = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const left = gray[row + (x > 0 ? x - 1 : 0)] as number;
      const right = gray[row + (x < w - 1 ? x + 1 : w - 1)] as number;
      rows[row + x] = left + (gray[row + x] as number) + right;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const up = (y > 0 ? y - 1 : 0) * w;
    const down = (y < h - 1 ? y + 1 : h - 1) * w;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      out[row + x] = Math.round(
        ((rows[up + x] as number) + (rows[row + x] as number) + (rows[down + x] as number)) / 9,
      );
    }
  }
  return out;
}

/** The fraction of pixels that changed by more than `delta`. */
export function movingFraction(a: Uint8Array, b: Uint8Array, delta: number): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let moved = 0;
  for (let i = 0; i < n; i++) {
    const d = (a[i] as number) - (b[i] as number);
    if (d > delta || d < -delta) moved++;
  }
  return moved / n;
}
