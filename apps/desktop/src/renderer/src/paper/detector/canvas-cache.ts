// The detector worker's canvases, one per size. The motion, page-finder and full-frame reads use
// the same few sizes every sample, but each trigger's crop has a size of its own. So the cache
// holds at most `limit` canvases and drops the least recently used first: the per-sample sizes
// stay, and a long session's crops never pile up (Task 8 review M1, ruling P3-R26).

export interface CanvasCache<C> {
  /** The canvas for this size, made on first use. */
  get(width: number, height: number): C;
  /** How many canvases it holds. */
  readonly size: number;
}

export function createCanvasCache<C>(
  create: (width: number, height: number) => C,
  limit = 6,
): CanvasCache<C> {
  // A Map iterates in insertion order, so its first key is the least recently used.
  const canvases = new Map<string, C>();
  return {
    get(width, height) {
      const key = `${width}x${height}`;
      let canvas = canvases.get(key);
      if (canvas === undefined) canvas = create(width, height);
      else canvases.delete(key);
      canvases.set(key, canvas);
      for (const oldest of canvases.keys()) {
        if (canvases.size <= limit) break;
        canvases.delete(oldest);
      }
      return canvas;
    },
    get size() {
      return canvases.size;
    },
  };
}
