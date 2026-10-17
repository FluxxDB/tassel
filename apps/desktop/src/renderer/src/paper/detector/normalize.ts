// Lighting normalization: each pixel over the mean of its neighborhood. A lamp, a shadow edge or
// auto-exposure changes the page slowly across it, so dividing by a wide blur cancels them while
// pen strokes, a few pixels wide, stay dark.

/**
 * A size × size box blur through an integral image. Near the edges the box shrinks to the pixels
 * inside the image, so the edges aren't darkened.
 */
export function boxBlur(
  gray: Uint8Array | Float32Array,
  w: number,
  h: number,
  size: number,
): Float32Array {
  const r = Math.floor(size / 2);
  const stride = w + 1;
  // Float64 keeps the sums exact: 2048² pixels of 255 are far below 2^53.
  const sums = new Float64Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x] as number;
      sums[(y + 1) * stride + x + 1] = (sums[y * stride + x + 1] as number) + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const total =
        (sums[y1 * stride + x1] as number) -
        (sums[y0 * stride + x1] as number) -
        (sums[y1 * stride + x0] as number) +
        (sums[y0 * stride + x0] as number);
      out[y * w + x] = total / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

/** gray / max(blur, 1): about 1 for paper, well below it for ink, whatever the lighting. */
export function normalizeLighting(
  gray: Uint8Array,
  w: number,
  h: number,
  size: number,
): Float32Array {
  const blur = boxBlur(gray, w, h, size);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++)
    out[i] = (gray[i] as number) / Math.max(blur[i] as number, 1);
  return out;
}
