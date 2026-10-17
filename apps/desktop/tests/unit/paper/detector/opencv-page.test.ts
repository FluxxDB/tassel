// @vitest-environment node
import { createRequire } from 'node:module';
import { makeClip, renderFrame } from '@tassel/paper-synth';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Quad } from '../../../../src/renderer/src/paper/contracts';
import {
  type Cv,
  findPageQuad,
  loadOpenCv,
  warpGray,
  warpRgba,
} from '../../../../src/renderer/src/paper/detector/opencv-page';

// Node's require hands over the package's Promise of cv as it is (see loadOpenCv).
const require = createRequire(import.meta.url);

let cv: Cv;
beforeAll(async () => {
  cv = await loadOpenCv(async () => require('@techstark/opencv-js'));
}, 30_000);

const W = 960;
const H = 720;

/** A frame of nothing but desk: #cdc4b6 with a seeded grain, like the clips' desk. */
function plainDesk(): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(W * H * 4);
  let s = 12345;
  for (let i = 0; i < W * H; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const grain = (s / 4294967296) * 8 - 4;
    rgba[i * 4] = 0xcd + grain;
    rgba[i * 4 + 1] = 0xc4 + grain;
    rgba[i * 4 + 2] = 0xb6 + grain;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/** Mean gray of a square patch of a gray image. */
function patchMean(gray: Uint8Array, width: number, x0: number, y0: number, size = 10): number {
  let sum = 0;
  for (let y = y0; y < y0 + size; y++)
    for (let x = x0; x < x0 + size; x++) sum += gray[y * width + x] ?? 0;
  return sum / (size * size);
}

describe('loadOpenCv', () => {
  it('resolves to a ready cv', () => {
    expect(typeof cv.Mat).toBe('function');
    expect(typeof cv.findContours).toBe('function');
    const mat = new cv.Mat(4, 4, cv.CV_8UC1);
    expect([mat.rows, mat.cols]).toEqual([4, 4]);
    mat.delete();
  });
});

describe('findPageQuad', () => {
  it('finds the dfa-demo page within 4 px of its true corners', () => {
    const clip = makeClip('dfa-demo');
    const rgba = renderFrame(clip, 0, { width: W, height: H });
    const quad = findPageQuad(cv, rgba, W, H);
    expect(quad).not.toBeNull();
    const truth = clip.pageQuadAt(0, W, H);
    quad?.forEach((corner, i) => {
      const t = truth[i] ?? { x: 0, y: 0 };
      expect(Math.hypot(corner.x - t.x, corner.y - t.y), `corner ${i}`).toBeLessThanOrEqual(4);
    });
  }, 30_000);

  it('scales back to the frame’s pixels when the frame is bigger than 960', () => {
    const clip = makeClip('dfa-demo');
    const rgba = renderFrame(clip, 0, { width: 1920, height: 1440 });
    const quad = findPageQuad(cv, rgba, 1920, 1440);
    const truth = clip.pageQuadAt(0, 1920, 1440);
    quad?.forEach((corner, i) => {
      const t = truth[i] ?? { x: 0, y: 0 };
      expect(Math.hypot(corner.x - t.x, corner.y - t.y), `corner ${i}`).toBeLessThanOrEqual(8);
    });
    expect(quad).not.toBeNull();
  }, 30_000);

  it('finds a page with handwriting on it, through sensor noise', () => {
    // dfa-short at 12 s: q0 drawn, the hand gone.
    const clip = makeClip('dfa-short');
    const rgba = renderFrame(clip, 12000, { width: W, height: H, noise: true, frameIndex: 180 });
    const quad = findPageQuad(cv, rgba, W, H);
    const truth = clip.pageQuadAt(12000, W, H);
    expect(quad).not.toBeNull();
    quad?.forEach((corner, i) => {
      const t = truth[i] ?? { x: 0, y: 0 };
      expect(Math.hypot(corner.x - t.x, corner.y - t.y), `corner ${i}`).toBeLessThanOrEqual(4);
    });
  }, 30_000);

  it('returns null on a frame of plain desk', () => {
    expect(findPageQuad(cv, plainDesk(), W, H)).toBeNull();
  });

  it('returns null on a frame that is all one color', () => {
    const white = new Uint8ClampedArray(W * H * 4).fill(255);
    expect(findPageQuad(cv, white, W, H)).toBeNull();
  });
});

describe('warping', () => {
  const clip = makeClip('dfa-demo');
  const rgba = renderFrame(clip, 0, { width: W, height: H });
  const quad: Quad = clip.pageQuadAt(0, W, H);

  it('warpGray fills the output with page', () => {
    const gray = warpGray(cv, rgba, W, H, quad, 800, 608);
    expect(gray).toHaveLength(800 * 608);
    for (const [x, y] of [
      [0, 0],
      [790, 0],
      [790, 598],
      [0, 598],
    ] as const) {
      expect(patchMean(gray, 800, x, y), `corner patch at ${x},${y}`).toBeGreaterThan(235);
    }
    // The printed statement starts 10% across and 10% down: dark strokes there.
    let darkest = 255;
    for (let y = 60; y < 90; y++)
      for (let x = 80; x < 140; x++) darkest = Math.min(darkest, gray[y * 800 + x] ?? 255);
    expect(darkest).toBeLessThan(150);
  });

  it('warpRgba gives the same page in color', () => {
    const color = warpRgba(cv, rgba, W, H, quad, 400, 304);
    expect(color).toHaveLength(400 * 304 * 4);
    const at = (200 * 400 + 380) * 4; // A spot of plain paper.
    expect(color[at]).toBeGreaterThan(230);
    expect(color[at + 3]).toBe(255);
  });
});
