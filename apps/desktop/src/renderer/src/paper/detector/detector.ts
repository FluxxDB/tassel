// The change detector: decides, sample by sample, when the page shows new ink worth sending (an
// `ink` trigger) or a different page (a `page` trigger). Pure TypeScript with its browser parts
// injected, so the worker (Task 8) and Node's tests run the same code.
//
// Each step (the plan's order; the re-review's N1 and N2 are marked):
//  1. Busy: more than busyFraction of motion pixels moved. Resets the quiet and stale counts.
//  2. Below stableSamples quiet samples in a row: wait.
//  3. Sample the page. A 4-connected cluster of occlusionMinCells dark, smooth cells occludes it:
//     no reference is taken or replaced, and the quiet count starts again. (N1) A cell that has
//     stayed dark for sceneryMs is scenery (a printed fill, the desk, a hand that won't move),
//     and so are its neighbors: they don't occlude, and they are left out of the comparison.
//  4. No reference yet: this page becomes it.
//  5. A page corner moved by more than pageMoveFraction of the frame diagonal: page event.
//  6. Compare with the reference. (N2) A ghost — erasure-dominant solid cells where the
//     reference was dark, not her ink, with every change around it — for staleSamples stable
//     samples in a row: the reference held an occluder, so it is replaced without a trigger.
//  7. More than bigChangeFraction of cells changed, or pageClearFraction of her ink on this
//     sheet erased with no new ink: page event.
//  8. New ink: a cell changed for the first time since the reference was taken, by at least
//     twice cellMinPixels. (The plan says "a changed cell that wasn't in the last comparison". A
//     cell a stroke only clips hovers near cellMinPixels and flickers in and out from sample to
//     sample as the page is resampled; each return, or each crossing of a higher bar, would
//     restart the wait.)
//  9. Enough changed cells, quietInkMs since new ink and minTriggerIntervalMs since the last
//     trigger: an ink trigger, and the page becomes the reference.
// 10. A quiet reference older than referenceRefreshMs is replaced.
//
// Comparing two samples of a still page whose quad the page finder found with a pixel or two of
// noise would misalign thin strokes. So when the quads differ, the sample is also remapped into
// the reference's geometry (the same frame points the reference sampled), and the comparison
// that changed fewer cells wins: the remap is right when only the quad wobbled, the sample as
// taken is right when the page really moved and the finder followed it. Both images are blurred
// 3 × 3 first, so a stroke's darkness doesn't depend on where it falls between pixels, and a thin
// band along the page's edges (EDGE_BAND) is never compared.

import type { CellMask, DetectorStats, NormRect, Quad } from '../contracts';
import { type CellDiff, clusterCells, compareCells, darkCells } from './cells';
import { blur3, stillFraction } from './gray';
import { applyH, homography, invertH, quadShift } from './homography';
import { normalizeLighting } from './normalize';
import { DEFAULT_PARAMS, type DetectorParams } from './params';

/** The motion image, already blurred. */
export interface MotionSample {
  gray: Uint8Array;
  width: number;
  height: number;
}

/** The page warped flat: gray, not normalized. */
export interface PageSample {
  raw: Uint8Array;
  width: number;
  height: number;
  quad: Quad;
  found: boolean;
  frameDiagonal: number;
}

export interface DetectorTriggerCore {
  reason: 'ink' | 'page';
  t: number;
  mask: CellMask | null;
  cropRect: NormRect | null;
  quad: Quad;
  pageFound: boolean;
  changedCells: number;
  inkPixels: number;
  erasePixels: number;
}

type Size = { width: number; height: number };

interface Reference {
  size: Size;
  quad: Quad;
  found: boolean;
  norm: Float32Array;
  /** Cells dark in the reference: where a ghost can be. */
  dark: Set<number>;
  at: number;
}

/** Cells around a hand left out of the comparison: its shadow and the edge of the sleeve. */
const HAND_MARGIN = 1;

const UNIT: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** Cells within `reach` cells (in both directions) of any of `cells`. */
function around(cells: Iterable<number>, cols: number, rows: number, reach: number): Set<number> {
  const out = new Set<number>();
  for (const c of cells) {
    const col = c % cols;
    const row = Math.floor(c / cols);
    for (let r = Math.max(0, row - reach); r <= Math.min(rows - 1, row + reach); r++) {
      for (let k = Math.max(0, col - reach); k <= Math.min(cols - 1, col + reach); k++)
        out.add(r * cols + k);
    }
  }
  return out;
}

/**
 * Resamples a page sample (taken through `from`) at the frame points another sample took
 * through `to`, bilinearly. Pixel centers are at +0.5.
 */
function remap(raw: Uint8Array, w: number, h: number, from: Quad, to: Quad): Uint8Array {
  // Unit-square coordinates in `to`'s sample → frame → unit-square coordinates in `from`'s.
  const m = homography(UNIT, to);
  const back = invertH(homography(UNIT, from));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const there = applyH(back, applyH(m, { x: (x + 0.5) / w, y: (y + 0.5) / h }));
      const fx = Math.min(w - 1, Math.max(0, there.x * w - 0.5));
      const fy = Math.min(h - 1, Math.max(0, there.y * h - 0.5));
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = Math.min(w - 1, x0 + 1);
      const y1 = Math.min(h - 1, y0 + 1);
      const ax = fx - x0;
      const ay = fy - y0;
      const top = (raw[y0 * w + x0] as number) * (1 - ax) + (raw[y0 * w + x1] as number) * ax;
      const bottom = (raw[y1 * w + x0] as number) * (1 - ax) + (raw[y1 * w + x1] as number) * ax;
      out[y * w + x] = Math.round(top * (1 - ay) + bottom * ay);
    }
  }
  return out;
}

const sameQuad = (a: Quad, b: Quad) => a.every((c, i) => c.x === b[i]?.x && c.y === b[i]?.y);

/**
 * The band along the flattened page's edges that is never compared, as a fraction of its long
 * side (6 px of 800). A quad off by a pixel or two takes in, or loses, a sliver of desk there
 * from one sample to the next; nobody writes that close to the paper's edge.
 */
export const EDGE_BAND = 0.0075;

/** Sets the edge band of a normalized image to 1: plain paper, the same in every sample. */
function blankEdges(norm: Float32Array, w: number, h: number): Float32Array {
  const band = Math.round(EDGE_BAND * Math.max(w, h));
  for (let y = 0; y < h; y++) {
    const inner = y >= band && y < h - band;
    for (let x = 0; x < w; x++) {
      if (inner && x >= band && x < w - band) continue;
      norm[y * w + x] = 1;
    }
  }
  return norm;
}

export function createDetector(params?: Partial<DetectorParams>) {
  const p: DetectorParams = { ...DEFAULT_PARAMS, ...params };

  let previous: Uint8Array | null = null;
  let quiet = 0;
  let stale = 0;
  let reference: Reference | null = null;
  /** The cells she has inked on this sheet. */
  let sheetInk = new Set<number>();
  /** Every cell seen changed since the reference was taken. */
  let seen = new Set<number>();
  let lastNewInkAt = Number.NEGATIVE_INFINITY;
  let lastTriggerAt = Number.NEGATIVE_INFINITY;
  let heldPage = false;
  let wasOccluded = false;
  /** N1: when each cell was first seen dark, in this run of samples where it stayed dark. */
  let darkSince = new Map<number, number>();
  let darkGrid = '';
  let triggers = 0;
  let stats: Omit<DetectorStats, 'opencv'> = initialStats();

  function initialStats(): Omit<DetectorStats, 'opencv'> {
    return {
      t: 0,
      busy: true,
      occluded: false,
      quiet: 0,
      cols: 0,
      rows: 0,
      changed: [],
      solid: [],
      quad: null,
      refAgeMs: null,
      triggers: 0,
    };
  }

  const prepare = (raw: Uint8Array, size: Size) =>
    blankEdges(
      normalizeLighting(
        blur3(raw, size.width, size.height),
        size.width,
        size.height,
        p.lightingBlur,
      ),
      size.width,
      size.height,
    );

  function adopt(page: PageSample, norm: Float32Array, dark: number[], t: number): void {
    reference = {
      size: { width: page.width, height: page.height },
      quad: page.quad,
      found: page.found,
      norm,
      dark: new Set(dark),
      at: t,
    };
    seen = new Set();
    stale = 0;
  }

  /** The comparison, with the remapped sample too when the quads differ (see the top). */
  function compare(
    ref: Reference,
    page: PageSample,
    norm: Float32Array,
    scenery: ReadonlySet<number>,
  ): CellDiff {
    const { width: w, height: h } = ref.size;
    const asTaken = compareCells(ref.norm, norm, w, h, p, scenery);
    if (!page.found || !ref.found || sameQuad(ref.quad, page.quad)) return asTaken;
    const remapped = prepare(remap(page.raw, w, h, page.quad, ref.quad), ref.size);
    const aligned = compareCells(ref.norm, remapped, w, h, p, scenery);
    const cost = (d: CellDiff) => d.changed.length * 1e6 + d.inkPixels + d.erasePixels;
    return cost(aligned) < cost(asTaken) ? aligned : asTaken;
  }

  function trackDark(dark: number[], cols: number, rows: number, t: number): Set<number> {
    const grid = `${cols}x${rows}`;
    if (grid !== darkGrid) {
      darkSince = new Map();
      darkGrid = grid;
    }
    const now = new Set(dark);
    for (const c of [...darkSince.keys()]) if (!now.has(c)) darkSince.delete(c);
    const scenery = new Set<number>();
    for (const c of dark) {
      const since = darkSince.get(c);
      if (since === undefined) darkSince.set(c, t);
      else if (t - since >= p.sceneryMs) scenery.add(c);
    }
    return scenery;
  }

  function pageEvent(
    t: number,
    samplePage: (size: Size | null) => PageSample,
    diff: CellDiff | null,
  ): DetectorTriggerCore | null {
    // The new reference takes its size from its own quad.
    const fresh = samplePage(null);
    const dark = darkCells(fresh.raw, fresh.width, fresh.height, p);
    adopt(fresh, prepare(fresh.raw, fresh), dark, t);
    sheetInk = new Set();
    stats.cols = Math.floor(fresh.width / p.cellSize);
    stats.rows = Math.floor(fresh.height / p.cellSize);
    stats.changed = [];
    stats.solid = [];
    stats.quad = fresh.quad;
    stats.refAgeMs = 0;
    if (t - lastTriggerAt < p.minTriggerIntervalMs) {
      heldPage = true;
      return null;
    }
    heldPage = false;
    lastTriggerAt = t;
    triggers++;
    stats.triggers = triggers;
    return {
      reason: 'page',
      t,
      mask: null,
      cropRect: null,
      quad: fresh.quad,
      pageFound: fresh.found,
      changedCells: diff?.changed.length ?? 0,
      inkPixels: diff?.inkPixels ?? 0,
      erasePixels: diff?.erasePixels ?? 0,
    };
  }

  function inkTrigger(
    t: number,
    page: PageSample,
    norm: Float32Array,
    dark: number[],
    diff: CellDiff,
  ): DetectorTriggerCore {
    const { cols, rows } = diff;
    const cells = diff.changed.map((c) => [c % cols, Math.floor(c / cols)] as [number, number]);
    const colsUsed = cells.map(([c]) => c);
    const rowsUsed = cells.map(([, r]) => r);
    const c0 = Math.max(0, Math.min(...colsUsed) - 1);
    const c1 = Math.min(cols - 1, Math.max(...colsUsed) + 1);
    const r0 = Math.max(0, Math.min(...rowsUsed) - 1);
    const r1 = Math.min(rows - 1, Math.max(...rowsUsed) + 1);
    // In whole pixels first, then page coordinates, so cell-aligned crops come out exact.
    const cell = p.cellSize;
    const x0 = c0 * cell;
    const y0 = r0 * cell;
    const x1 = Math.min(page.width, (c1 + 1) * cell);
    const y1 = Math.min(page.height, (r1 + 1) * cell);
    const cropRect: NormRect = {
      x: x0 / page.width,
      y: y0 / page.height,
      w: (x1 - x0) / page.width,
      h: (y1 - y0) / page.height,
    };
    for (const c of diff.inked) sheetInk.add(c);
    for (const c of diff.erased) sheetInk.delete(c);
    adopt(page, norm, dark, t);
    lastTriggerAt = t;
    triggers++;
    stats.triggers = triggers;
    stats.refAgeMs = 0;
    return {
      reason: 'ink',
      t,
      mask: { cols, rows, cells },
      cropRect,
      quad: page.quad,
      pageFound: page.found,
      changedCells: diff.changed.length,
      inkPixels: diff.inkPixels,
      erasePixels: diff.erasePixels,
    };
  }

  function step(
    t: number,
    motion: MotionSample,
    samplePage: (size: Size | null) => PageSample,
  ): DetectorTriggerCore | null {
    stats.t = t;
    stats.refAgeMs = reference ? t - reference.at : null;

    // 1. Motion.
    const busy =
      previous === null ||
      previous.length !== motion.gray.length ||
      stillFraction(previous, motion.gray, motion.width, motion.height, p.motionDelta) >
        p.busyFraction;
    previous = motion.gray.slice();
    if (busy) {
      quiet = 0;
      stale = 0;
      stats.busy = true;
      stats.occluded = false;
      stats.quiet = 0;
      return null;
    }

    // 2. Stable?
    quiet++;
    stats.busy = false;
    stats.quiet = quiet;
    if (quiet < p.stableSamples) return null;

    // 3. The page, and whether something covers it.
    const page = samplePage(reference ? reference.size : null);
    const cols = Math.floor(page.width / p.cellSize);
    const rows = Math.floor(page.height / p.cellSize);
    stats.quad = page.quad;
    const dark = darkCells(page.raw, page.width, page.height, p);
    // Scenery, and the cells around it: a printed box's edge cells are dark in one sample and
    // not the next as the page is resampled, so they never stay dark long enough themselves.
    const scenery = around(trackDark(dark, cols, rows, t), cols, rows, 1);
    const occluders = dark.filter((c) => !scenery.has(c));
    // A hand or sleeve on the page no longer stops it (owner's live test, 2026-10-18): its cells
    // are left out of the comparison and never enter the reference, the quiet count and pending
    // ink carry on, and a trigger waits only until it leaves, so the image shows no hand.
    const handCells = clusterCells(occluders, cols, p.occlusionMinCells);
    const occluded = handCells.size > 0;
    // What lay under the hand is new from the moment it shows: the ink's quiet time starts then.
    if (wasOccluded && !occluded) lastNewInkAt = Math.max(lastNewInkAt, t);
    wasOccluded = occluded;
    stats.occluded = occluded;
    const hand = occluded ? around(handCells, cols, rows, HAND_MARGIN) : new Set<number>();
    const norm = prepare(page.raw, page);

    // 4. The first reference, never with a hand on the page.
    if (!reference && occluded) {
      quiet = 0;
      stale = 0;
      stats.quiet = 0;
      return null;
    }
    if (!reference) {
      adopt(page, norm, dark, t);
      sheetInk = new Set();
      stats.cols = cols;
      stats.rows = rows;
      stats.changed = [];
      stats.solid = [];
      stats.refAgeMs = 0;
      return null;
    }
    const ref: Reference = reference;

    // A page event never takes a hand into its new reference: it waits until the hand leaves.
    // A page event held by the minimum interval goes out on the first stable, clear sample after.
    if (!occluded && heldPage && t - lastTriggerAt >= p.minTriggerIntervalMs)
      return pageEvent(t, samplePage, null);

    // A sample that doesn't match the reference's size can't be compared: treat it as a new page.
    if (page.width !== ref.size.width || page.height !== ref.size.height)
      return occluded ? null : pageEvent(t, samplePage, null);

    // 5. The page moved.
    if (
      !occluded &&
      page.found &&
      ref.found &&
      quadShift(ref.quad, page.quad) > p.pageMoveFraction * page.frameDiagonal
    ) {
      return pageEvent(t, samplePage, null);
    }

    // 6. Compare, and look for a stale reference.
    // Scenery is left out: a printed fill is in the reference anyway, and a hand that has lain
    // still for sceneryMs is neither ink nor allowed into the reference by a trigger's mask.
    const ignore = occluded ? new Set([...scenery, ...hand]) : scenery;
    const diff = compare(ref, page, norm, ignore);
    stats.cols = diff.cols;
    stats.rows = diff.rows;
    stats.changed = diff.changed;
    stats.solid = diff.solid;
    const nearDark = around(ref.dark, diff.cols, diff.rows, 1);
    const erased = new Set(diff.erased);
    const ghost = diff.solid.filter((c) => erased.has(c) && nearDark.has(c) && !sheetInk.has(c));
    if (!occluded && ghost.length >= p.occlusionMinCells) {
      const zone = around(ref.dark, diff.cols, diff.rows, 2);
      if (diff.changed.every((c) => zone.has(c))) {
        stale++;
        if (stale >= p.staleSamples) {
          adopt(page, norm, dark, t);
          stats.refAgeMs = 0;
        }
        return null;
      }
    }
    stale = 0;

    // 7. A new page, or this sheet cleared of her ink.
    if (!occluded && diff.changed.length > p.bigChangeFraction * diff.cols * diff.rows)
      return pageEvent(t, samplePage, diff);
    if (!occluded && sheetInk.size >= p.triggerMinCells && diff.inked.length === 0) {
      const cleared = diff.erased.filter((c) => sheetInk.has(c)).length;
      if (cleared >= p.pageClearFraction * sheetInk.size) return pageEvent(t, samplePage, diff);
    }

    // 8. New ink.
    const strong = 2 * p.cellMinPixels;
    for (const c of diff.changed) {
      if (seen.has(c)) continue;
      seen.add(c);
      if ((diff.counts[c] as number) >= strong) lastNewInkAt = t;
    }

    // 9. An ink trigger: enough changed cells, or one strong one (a small correction is work),
    // once no hand is on the page.
    const enough =
      diff.changed.length >= p.triggerMinCells ||
      diff.changed.some((c) => (diff.counts[c] as number) >= p.singleCellMinPixels);
    if (
      enough &&
      !occluded &&
      t - lastNewInkAt >= p.quietInkMs &&
      t - lastTriggerAt >= p.minTriggerIntervalMs
    ) {
      return inkTrigger(t, page, norm, dark, diff);
    }

    // 10. Refresh a quiet reference: only with nothing pending and no hand on the page, so a
    // refresh never absorbs an edit that hasn't gone out (Perry's audit) or takes in the hand.
    if (!occluded && diff.changed.length === 0 && t - ref.at >= p.referenceRefreshMs) {
      adopt(page, norm, dark, t);
      stats.refAgeMs = 0;
    }
    return null;
  }

  return {
    /** samplePage(size): the page warped to `size`, or to compareSize(quad) when size is null. Called only when stable. */
    step,
    /** The frame loop adds `opencv`. */
    stats(): Omit<DetectorStats, 'opencv'> {
      return { ...stats, changed: [...stats.changed], solid: [...stats.solid] };
    },
    reset(): void {
      previous = null;
      quiet = 0;
      stale = 0;
      reference = null;
      sheetInk = new Set();
      seen = new Set();
      lastNewInkAt = Number.NEGATIVE_INFINITY;
      lastTriggerAt = Number.NEGATIVE_INFINITY;
      heldPage = false;
      wasOccluded = false;
      darkSince = new Map();
      darkGrid = '';
      triggers = 0;
      stats = initialStats();
    },
  };
}
