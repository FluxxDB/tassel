// The change detector's tunable values: research 02 §5's starting values, the plan's rules for
// occluders and page changes, and the re-review's scenery timeout (N1). Change them only here,
// and only after tuning with the heatmap. TASSEL_PAPER_PARAMS overrides them through parseParams.

export { DETECTOR_VERSION } from '../contracts';

export interface DetectorParams {
  /** Sample one frame per this many ms of frame time (5 fps). */
  sampleIntervalMs: number;
  /** The motion image: gray, this size, after a 3 × 3 box blur. */
  motionWidth: number;
  motionHeight: number;
  /** A motion pixel moves when it changes by more than this (of 255). */
  motionDelta: number;
  /** A sample is busy when more than this fraction of motion pixels move. */
  busyFraction: number;
  /** Quiet samples in a row before the page is compared. */
  stableSamples: number;
  /** The flattened page's long side; its short side is floored to a multiple of cellSize. */
  compareLongSide: number;
  /** With no page found: the central fraction of the frame, at 640 × 480. */
  fallbackCrop: number;
  /** Lighting is normalized by dividing by a box blur this many pixels across (odd). */
  lightingBlur: number;
  /** A normalized pixel is ink, or erasure, past this change. */
  inkDelta: number;
  /** A cell's edge, in compare pixels. */
  cellSize: number;
  /** A cell changes at this many ink or erasure pixels. */
  cellMinPixels: number;
  /** Changed cells needed to trigger. */
  triggerMinCells: number;
  /** …or one cell changed by at least this many pixels: a small correction is still work. */
  singleCellMinPixels: number;
  /** Time with no new ink before a trigger (tunable from 1500 to 3000). */
  quietInkMs: number;
  /** At most one trigger this often; a page event inside it is held. */
  minTriggerIntervalMs: number;
  /** More than this fraction of cells changed: a new page. */
  bigChangeFraction: number;
  /** This fraction of her ink on the sheet erased at once, with no new ink: a fresh sheet. */
  pageClearFraction: number;
  /** A page corner moved more than this fraction of the frame diagonal: the page moved. */
  pageMoveFraction: number;
  /** Replace a quiet reference after this long. */
  referenceRefreshMs: number;
  /** A cell is dark below this fraction of the page's 90th-percentile cell mean… */
  occluderLevel: number;
  /** …with a standard deviation below this fraction of that 90th percentile. */
  occluderSmoothness: number;
  /** A 4-connected cluster of this many dark cells occludes the page. */
  occlusionMinCells: number;
  /** A cell more than this fraction changed is solid. */
  solidCellFraction: number;
  /** Stable samples in a row with a ghost of solid cells before the reference is replaced. */
  staleSamples: number;
  /** A dark cell that stays dark this long is scenery, not an occluder (re-review N1). */
  sceneryMs: number;
  /** The last page quad bridges a missed detection this long, then the page counts as lost. */
  quadGraceMs: number;
}

export const DEFAULT_PARAMS: Readonly<DetectorParams> = Object.freeze({
  sampleIntervalMs: 200,
  motionWidth: 160,
  motionHeight: 120,
  motionDelta: 15,
  busyFraction: 0.005,
  stableSamples: 5,
  compareLongSide: 800,
  fallbackCrop: 0.8,
  lightingBlur: 31,
  inkDelta: 0.1,
  cellSize: 16,
  cellMinPixels: 6,
  triggerMinCells: 2,
  singleCellMinPixels: 24,
  quietInkMs: 2000,
  minTriggerIntervalMs: 5000,
  bigChangeFraction: 0.4,
  pageClearFraction: 0.8,
  pageMoveFraction: 0.02,
  referenceRefreshMs: 30000,
  occluderLevel: 0.8,
  occluderSmoothness: 0.08,
  occlusionMinCells: 4,
  solidCellFraction: 0.5,
  staleSamples: 5,
  sceneryMs: 10000,
  quadGraceMs: 2000,
});

type Range = { min: number; max: number; whole?: boolean; odd?: boolean };

/** The values parseParams accepts for each key. */
const RANGES: Record<keyof DetectorParams, Range> = {
  sampleIntervalMs: { min: 50, max: 2000, whole: true },
  motionWidth: { min: 32, max: 640, whole: true },
  motionHeight: { min: 24, max: 480, whole: true },
  motionDelta: { min: 1, max: 255 },
  busyFraction: { min: 0.0001, max: 1 },
  stableSamples: { min: 1, max: 50, whole: true },
  compareLongSide: { min: 160, max: 2048, whole: true },
  fallbackCrop: { min: 0.1, max: 1 },
  lightingBlur: { min: 3, max: 255, whole: true, odd: true },
  inkDelta: { min: 0.01, max: 1 },
  cellSize: { min: 4, max: 64, whole: true },
  cellMinPixels: { min: 1, max: 4096, whole: true },
  triggerMinCells: { min: 1, max: 1000, whole: true },
  singleCellMinPixels: { min: 1, max: 4096, whole: true },
  quietInkMs: { min: 1500, max: 3000 },
  minTriggerIntervalMs: { min: 0, max: 60000 },
  bigChangeFraction: { min: 0.05, max: 1 },
  pageClearFraction: { min: 0.05, max: 1 },
  pageMoveFraction: { min: 0.001, max: 0.5 },
  referenceRefreshMs: { min: 1000, max: 600000 },
  occluderLevel: { min: 0.05, max: 1 },
  occluderSmoothness: { min: 0.001, max: 1 },
  occlusionMinCells: { min: 1, max: 1000, whole: true },
  solidCellFraction: { min: 0.05, max: 1 },
  staleSamples: { min: 1, max: 100, whole: true },
  sceneryMs: { min: 1000, max: 120000 },
  quadGraceMs: { min: 0, max: 60000 },
};

/** Keeps the known keys whose values are finite numbers in range; drops the rest. */
export function parseParams(input: unknown): Partial<DetectorParams> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return {};
  const out: Partial<DetectorParams> = {};
  for (const [key, value] of Object.entries(input)) {
    // Own keys only, so "constructor" or "__proto__" never pass for a parameter.
    if (!Object.hasOwn(RANGES, key)) continue;
    const range = RANGES[key as keyof DetectorParams];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (value < range.min || value > range.max) continue;
    if (range.whole && !Number.isInteger(value)) continue;
    if (range.odd && value % 2 !== 1) continue;
    out[key as keyof DetectorParams] = value;
  }
  return out;
}
