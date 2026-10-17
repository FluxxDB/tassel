import { makeClip, renderFrame } from '@tassel/paper-synth';
import { describe, expect, it } from 'vitest';
import {
  compareCells,
  darkCells,
  largestCluster,
} from '../../../../src/renderer/src/paper/detector/cells';
import { toGray } from '../../../../src/renderer/src/paper/detector/gray';
import { compareSize } from '../../../../src/renderer/src/paper/detector/homography';
import { DEFAULT_PARAMS } from '../../../../src/renderer/src/paper/detector/params';
import { warpGray } from './harness';

const p = DEFAULT_PARAMS;

/** Two 3 × 2-cell images of 1.0, so cell 0 spans x 0–15, y 0–15. */
function pair() {
  const w = 48;
  const h = 32;
  return {
    w,
    h,
    reference: new Float32Array(w * h).fill(1),
    current: new Float32Array(w * h).fill(1),
  };
}

describe('compareCells', () => {
  it('a cell changes at 6 ink pixels and not at 5', () => {
    const { w, h, reference, current } = pair();
    for (let i = 0; i < 5; i++) current[i] = 0.5;
    expect(compareCells(reference, current, w, h, p).changed).toEqual([]);
    current[5] = 0.5;
    const diff = compareCells(reference, current, w, h, p);
    expect(diff).toMatchObject({
      cols: 3,
      rows: 2,
      changed: [0],
      inked: [0],
      erased: [],
      solid: [],
    });
    expect(diff.inkPixels).toBe(6);
    expect(diff.erasePixels).toBe(0);
  });

  it('erasure counts as change', () => {
    const { w, h, reference, current } = pair();
    // Ink in the reference that is gone now, in cell 4 (col 1, row 1).
    for (let x = 16; x < 22; x++) reference[20 * w + x] = 0.3;
    const diff = compareCells(reference, current, w, h, p);
    expect(diff.changed).toEqual([4]);
    expect(diff.erased).toEqual([4]);
    expect(diff.inked).toEqual([]);
    expect(diff.erasePixels).toBe(6);
  });

  it('leaves out the cells it is told to ignore', () => {
    const { w, h, reference, current } = pair();
    for (let i = 0; i < 6; i++) current[i] = 0.5;
    for (let i = 16; i < 22; i++) current[i] = 0.5;
    expect(compareCells(reference, current, w, h, p).changed).toEqual([0, 1]);
    const diff = compareCells(reference, current, w, h, p, new Set([0]));
    expect(diff).toMatchObject({ changed: [1], inkPixels: 6 });
    expect(diff.counts[0]).toBe(0);
  });

  it('counts only ink that is darker than its surroundings, and erasure of what was', () => {
    const { w, h, reference, current } = pair();
    // Paper between dense strokes reads above 1 after normalization: neither ink nor erasure.
    for (let i = 0; i < 40; i++) current[i] = 1.3;
    for (let i = 16; i < 56; i++) reference[i + w * 20] = 1.3;
    expect(compareCells(reference, current, w, h, p).changed).toEqual([]);
  });

  it('needs a change past inkDelta', () => {
    const { w, h, reference, current } = pair();
    for (let i = 0; i < 40; i++) current[i] = 0.91;
    expect(compareCells(reference, current, w, h, p).changed).toEqual([]);
  });

  it('a cell over 50% changed is solid', () => {
    const { w, h, reference, current } = pair();
    // 128 of cell 2's 256 pixels: changed, not solid. 129: solid.
    let n = 0;
    for (let y = 0; y < 16 && n < 128; y++)
      for (let x = 32; x < 48 && n < 128; x++, n++) current[y * w + x] = 0.2;
    expect(compareCells(reference, current, w, h, p)).toMatchObject({ changed: [2], solid: [] });
    current[8 * w + 40] = 0.2;
    expect(compareCells(reference, current, w, h, p)).toMatchObject({ changed: [2], solid: [2] });
  });
});

/** A 10 × 8-cell page of gray 240, painted. */
function page(paint: (img: Uint8Array, w: number) => void) {
  const w = 160;
  const h = 128;
  const img = new Uint8Array(w * h).fill(240);
  paint(img, w);
  return { img, w, h };
}

describe('darkCells', () => {
  it('marks a uniform 60%-bright block', () => {
    const { img, w, h } = page((g, w) => {
      for (let y = 32; y < 64; y++) for (let x = 48; x < 96; x++) g[y * w + x] = 144;
    });
    // Rows 2–3, cols 3–5.
    expect(darkCells(img, w, h, p)).toEqual([23, 24, 25, 33, 34, 35]);
  });

  it('does not mark a cell crossed by a pen stroke', () => {
    // A 3 px stroke barely darkens its cells; a 6 px felt-tip stroke darkens them below the
    // level, but isn't smooth.
    for (const width of [3, 6]) {
      const { img, w, h } = page((g, w) => {
        for (let y = 70; y < 70 + width; y++) for (let x = 0; x < 160; x++) g[y * w + x] = 60;
      });
      expect(darkCells(img, w, h, p), `${width} px`).toEqual([]);
    }
  });

  it('does not mark the cells of a dense handwritten label', () => {
    // The erase clip opens with q0 and its label; warp its page as the detector would see it.
    const clip = makeClip('erase');
    const gray = toGray(renderFrame(clip, 0, { width: 640, height: 480 }), 640, 480);
    const quad = clip.pageQuadAt(0, 640, 480);
    const size = compareSize(quad, 800, 16);
    const raw = warpGray(gray, 640, 480, quad, size.width, size.height);
    expect(darkCells(raw, size.width, size.height, p)).toEqual([]);
  });
});

describe('largestCluster', () => {
  it('counts 4-connected cells only', () => {
    // On a 5-wide grid: an L of 4 (0, 1, 2, 7), a diagonal pair (13, 19) that is not
    // connected, and a lone cell (23).
    expect(largestCluster([0, 1, 2, 7, 13, 19, 23], 5)).toBe(4);
    expect(largestCluster([13, 19, 23], 5)).toBe(1);
    // Cells 4 and 5 are on different rows of a 5-wide grid: not neighbors.
    expect(largestCluster([4, 5], 5)).toBe(1);
    expect(largestCluster([], 5)).toBe(0);
  });
});
