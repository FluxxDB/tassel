// MJPEG files for Chromium's fake camera and the Desk View helper's clip producer.
//
// Chromium plays an .mjpeg file at a constant 30 fps (kMJpegFrameRate) and loops at its end; it
// picks the parser by a case-insensitive suffix check, so the name must end in .mjpeg. A frame
// that fails to parse hits a CHECK and crashes the capture process, so the file is nothing but
// whole JPEGs, back to back: no byte before the first SOI or after the last EOI.

import { createHash } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import jpeg from 'jpeg-js';
import { renderScene } from './raster.ts';
import { type Clip, sceneOf } from './scene.ts';

export interface MjpegOptions {
  width: number;
  height: number;
  /** Frames per second in the file. Chromium plays MJPEG at 30. */
  fps?: number;
  /** Frames rendered per second; each one is written fps / motionFps times. */
  motionFps?: number;
  /** JPEG quality, 1–100. */
  quality?: number;
  noise?: boolean;
}

export interface MjpegResult {
  frames: number;
  bytes: number;
  sha256: string;
}

function sameBytes(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Writes the clip as an MJPEG file: durationMs / 1000 × fps frames. Motion is rendered at
 * motionFps; a frame identical to the one before reuses its JPEG bytes. The file is written
 * beside `path` and renamed into place, so a half-written clip never has the final name.
 */
export async function writeMjpeg(
  clip: Clip,
  path: string,
  opts: MjpegOptions,
): Promise<MjpegResult> {
  const { width, height } = opts;
  const fps = opts.fps ?? 30;
  const motionFps = opts.motionFps ?? 15;
  const quality = opts.quality ?? 80;
  const noise = opts.noise ?? false;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16) {
    throw new Error(`writeMjpeg needs whole-pixel sizes of at least 16, got ${width}×${height}`);
  }
  const scene = sceneOf(clip);
  const frames = Math.round((clip.durationMs / 1000) * fps);
  const partial = `${path}.partial`;
  const hash = createHash('sha256');
  const file = await open(partial, 'w');
  let bytes = 0;
  try {
    let shown = -1;
    let pixels: Uint8ClampedArray | null = null;
    let frame: Uint8Array = new Uint8Array(0);
    for (let i = 0; i < frames; i++) {
      const k = Math.floor((i * motionFps) / fps);
      if (k !== shown) {
        const next = renderScene(scene, (k * 1000) / motionFps, width, height, noise, k);
        if (!pixels || !sameBytes(next, pixels)) {
          frame = jpeg.encode({ data: next, width, height }, quality).data;
        }
        pixels = next;
        shown = k;
      }
      await file.write(frame);
      hash.update(frame);
      bytes += frame.length;
    }
  } catch (error) {
    await file.close();
    await rm(partial, { force: true });
    throw error;
  }
  await file.close();
  await rename(partial, path);
  return { frames, bytes, sha256: hash.digest('hex') };
}
