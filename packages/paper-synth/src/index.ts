// @tassel/paper-synth: deterministic synthetic clips of the demo DFA being drawn on paper, with
// the truth of what was drawn, where and when. The detector's tests (Task 7) render them frame by
// frame; the app's E2E plays them through Chromium's fake camera as MJPEG files.
//
// Determinism: all randomness comes from a seeded mulberry32 (noise is seeded by frameIndex);
// nothing reads Math.random or the clock; and the arithmetic is plain IEEE 754, so a clip's bytes
// match on macOS and Windows.

import { renderScene } from './raster.ts';
import { type Clip, sceneOf } from './scene.ts';

export type { NormRect, Pt, Quad } from './geometry.ts';
export { type MjpegOptions, type MjpegResult, writeMjpeg } from './mjpeg.ts';
export {
  type Clip,
  type ClipTruth,
  type ExpectedTrigger,
  GENERATOR_VERSION,
  type VariantName,
} from './scene.ts';
export { truthJson } from './truth.ts';
export { makeClip, VARIANTS } from './variants.ts';

/** One RGBA frame of the clip at tMs. Noise, when on, is seeded by frameIndex (default 0). */
export function renderFrame(
  clip: Clip,
  tMs: number,
  opts: { width: number; height: number; noise?: boolean; frameIndex?: number },
): Uint8ClampedArray {
  const { width, height } = opts;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`renderFrame needs whole-pixel sizes, got ${width}×${height}`);
  }
  if (!Number.isFinite(tMs)) throw new Error(`renderFrame needs a finite time, got ${tMs}`);
  return renderScene(sceneOf(clip), tMs, width, height, opts.noise ?? false, opts.frameIndex ?? 0);
}
