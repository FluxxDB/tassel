// Seeded randomness. Everything random in a clip comes from here, so a clip's bytes depend only
// on its name and the render options: never on Math.random, the clock or the platform. Only
// 32-bit integer arithmetic is used, which every JavaScript engine computes the same way.

/** mulberry32, returning raw unsigned 32-bit integers. */
export function mulberry32u(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** mulberry32, returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  const next = mulberry32u(seed);
  return () => next() / 4294967296;
}

/** A 32-bit seed from a string (FNV-1a), so each group of strokes has its own stream. */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The seed of a frame's sensor noise. */
export function noiseSeed(frameIndex: number): number {
  return (Math.imul(frameIndex >>> 0, 0x9e3779b1) ^ 0x85ebca6b) >>> 0;
}

// Sensor noise is the sum of the four bytes of one 32-bit draw (Irwin–Hall, n = 4): close to a
// Gaussian, with integer arithmetic only. Each byte is uniform on 0–255, so the sum has mean 510
// and standard deviation sqrt(4 × (256² − 1) / 12).
const IRWIN_HALL_MEAN = 510;
const IRWIN_HALL_SIGMA = Math.sqrt((4 * (256 * 256 - 1)) / 12);

/** One noise sample, in units of the given sigma, from one 32-bit draw. */
export function noiseSample(draw: number, sigma: number): number {
  const sum = (draw & 0xff) + ((draw >>> 8) & 0xff) + ((draw >>> 16) & 0xff) + (draw >>> 24);
  return ((sum - IRWIN_HALL_MEAN) * sigma) / IRWIN_HALL_SIGMA;
}
