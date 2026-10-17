// The detector worker's canvas cache (Task 8 review M1, ruling P3-R26): the per-sample reads keep
// their canvases, and a long session of trigger crops, each its own size, never piles up.
import { describe, expect, it, vi } from 'vitest';
import { createCanvasCache } from '../../../../src/renderer/src/paper/detector/canvas-cache';

const canvasFactory = () => vi.fn((width: number, height: number) => ({ width, height }));

describe('createCanvasCache', () => {
  it('reuses the canvas of a size it already holds', () => {
    const create = canvasFactory();
    const cache = createCanvasCache(create);
    const first = cache.get(160, 120);
    expect(cache.get(160, 120)).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('holds at most six canvases, dropping the least recently used', () => {
    const create = canvasFactory();
    const cache = createCanvasCache(create);
    for (let size = 1; size <= 7; size++) cache.get(size, size);
    expect(cache.size).toBe(6);
    cache.get(1, 1); // dropped: made again
    expect(create).toHaveBeenCalledTimes(8);
    cache.get(7, 7); // kept: reused
    expect(create).toHaveBeenCalledTimes(8);
  });

  it('keeps the per-sample sizes through a long session of distinct crop sizes', () => {
    const create = canvasFactory();
    const cache = createCanvasCache(create);
    const perSample: Array<[number, number]> = [
      [160, 120], // motion
      [960, 720], // the page finder, and the full frame of a 960×720 feed
      [640, 480], // the central crop, before a page is found
    ];
    for (let trigger = 0; trigger < 500; trigger++) {
      for (const [width, height] of perSample) cache.get(width, height);
      // Every crop is cell-aligned and sized by what changed, so nearly each has its own size.
      cache.get(32 * (1 + (trigger % 50)), 32 * (1 + Math.floor(trigger / 50)));
      expect(cache.size).toBeLessThanOrEqual(6);
    }
    for (const [width, height] of perSample) {
      expect(create.mock.calls.filter(([w, h]) => w === width && h === height)).toHaveLength(1);
    }
  });
});
