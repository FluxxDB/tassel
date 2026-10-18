// The flattened page as a grid of cells: which cells changed between the reference and now, and
// which are dark enough and smooth enough to be a hand, a sleeve or a shadow rather than ink.
// Cell indices are row * cols + col, so sorting them sorts by row, then by column.

import type { DetectorParams } from './params';

export interface CellDiff {
  cols: number;
  rows: number;
  /** Cells with at least cellMinPixels ink or erasure pixels. */
  changed: number[];
  /** The changed cells, by their larger pixel count: ink… */
  inked: number[];
  /** …or erasure. */
  erased: number[];
  /** Changed cells more than solidCellFraction changed. */
  solid: number[];
  /** Ink and erasure pixels in the changed cells. */
  inkPixels: number;
  erasePixels: number;
  /** Ink plus erasure pixels, for every cell (0 for ignored cells). */
  counts: Int32Array;
}

/**
 * Compares two lighting-normalized images of the same page, cell by cell.
 *
 * A pixel is ink when reference − current > inkDelta, erasure when current − reference > inkDelta
 * (the plan's thresholds). In addition the side that carries ink must be darker than its
 * surroundings (below 1 − inkDelta): ink is dark now, and erased ink was dark before. Without it,
 * normalization's halo would count: the paper between dense strokes sits above 1.0 (dividing by a
 * mean the strokes pull down), so fresh handwriting would show its own gaps as "erasure", and a
 * sheet lifted off handwriting would show them as "ink".
 */
export function compareCells(
  reference: Float32Array,
  current: Float32Array,
  w: number,
  h: number,
  p: DetectorParams,
  /** Cells to leave out entirely (the detector's scenery). */
  ignore?: ReadonlySet<number>,
): CellDiff {
  const cell = p.cellSize;
  const cols = Math.floor(w / cell);
  const rows = Math.floor(h / cell);
  const dark = 1 - p.inkDelta;
  const ink = new Int32Array(cols * rows);
  const erase = new Int32Array(cols * rows);
  for (let y = 0; y < rows * cell; y++) {
    const rowBase = Math.floor(y / cell) * cols;
    for (let x = 0; x < cols * cell; x++) {
      const i = y * w + x;
      const ref = reference[i] as number;
      const cur = current[i] as number;
      const c = rowBase + Math.floor(x / cell);
      if (ref - cur > p.inkDelta && cur < dark) ink[c] = (ink[c] as number) + 1;
      else if (cur - ref > p.inkDelta && ref < dark) erase[c] = (erase[c] as number) + 1;
    }
  }
  const counts = new Int32Array(cols * rows);
  const diff: CellDiff = {
    cols,
    rows,
    changed: [],
    inked: [],
    erased: [],
    solid: [],
    inkPixels: 0,
    erasePixels: 0,
    counts,
  };
  const solidAt = p.solidCellFraction * cell * cell;
  for (let c = 0; c < cols * rows; c++) {
    if (ignore?.has(c)) continue;
    const i = ink[c] as number;
    const e = erase[c] as number;
    counts[c] = i + e;
    if (i + e < p.cellMinPixels) continue;
    diff.changed.push(c);
    (i >= e ? diff.inked : diff.erased).push(c);
    if (i + e > solidAt) diff.solid.push(c);
    diff.inkPixels += i;
    diff.erasePixels += e;
  }
  return diff;
}

/**
 * Cells dark and smooth enough to be an occluder: a raw (unnormalized) mean below occluderLevel
 * × the page's 90th-percentile cell mean, and a standard deviation below occluderSmoothness × that
 * same 90th percentile. Skin, a sleeve or a shadow is smooth; a cell of dense ink is not.
 */
export function darkCells(raw: Uint8Array, w: number, h: number, p: DetectorParams): number[] {
  const cell = p.cellSize;
  const cols = Math.floor(w / cell);
  const rows = Math.floor(h / cell);
  const n = cols * rows;
  if (n === 0) return [];
  const sum = new Float64Array(n);
  const sq = new Float64Array(n);
  for (let y = 0; y < rows * cell; y++) {
    const rowBase = Math.floor(y / cell) * cols;
    for (let x = 0; x < cols * cell; x++) {
      const v = raw[y * w + x] as number;
      const c = rowBase + Math.floor(x / cell);
      sum[c] = (sum[c] as number) + v;
      sq[c] = (sq[c] as number) + v * v;
    }
  }
  const area = cell * cell;
  const means = new Float64Array(n);
  for (let c = 0; c < n; c++) means[c] = (sum[c] as number) / area;
  const sorted = Float64Array.from(means).sort();
  const level = sorted[Math.floor(0.9 * (n - 1))] as number;
  const out: number[] = [];
  for (let c = 0; c < n; c++) {
    const mean = means[c] as number;
    if (mean >= p.occluderLevel * level) continue;
    const variance = Math.max(0, (sq[c] as number) / area - mean * mean);
    if (Math.sqrt(variance) < p.occluderSmoothness * level) out.push(c);
  }
  return out;
}

/** The size of the biggest 4-connected group of cells on a grid `cols` wide. */
export function largestCluster(cells: number[], cols: number): number {
  const left = new Set(cells);
  let best = 0;
  for (const start of cells) {
    if (!left.has(start)) continue;
    left.delete(start);
    const queue = [start];
    let size = 0;
    while (queue.length > 0) {
      const c = queue.pop() as number;
      size++;
      const col = c % cols;
      const neighbors = [c - cols, c + cols];
      if (col > 0) neighbors.push(c - 1);
      if (col < cols - 1) neighbors.push(c + 1);
      for (const nb of neighbors) {
        if (left.has(nb)) {
          left.delete(nb);
          queue.push(nb);
        }
      }
    }
    if (size > best) best = size;
  }
  return best;
}

/** The cells in 4-connected clusters of at least `min` cells: where a hand or sleeve lies. */
export function clusterCells(cells: number[], cols: number, min: number): Set<number> {
  const left = new Set(cells);
  const out = new Set<number>();
  for (const start of cells) {
    if (!left.has(start)) continue;
    left.delete(start);
    const queue = [start];
    const cluster: number[] = [];
    while (queue.length > 0) {
      const c = queue.pop() as number;
      cluster.push(c);
      const col = c % cols;
      const neighbors = [c - cols, c + cols];
      if (col > 0) neighbors.push(c - 1);
      if (col < cols - 1) neighbors.push(c + 1);
      for (const nb of neighbors) {
        if (left.has(nb)) {
          left.delete(nb);
          queue.push(nb);
        }
      }
    }
    if (cluster.length >= min) for (const c of cluster) out.add(c);
  }
  return out;
}
