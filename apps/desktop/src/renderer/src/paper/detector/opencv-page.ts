// The page finder and the page warps, with OpenCV.js. Runs in the detector worker (and in
// Node's tests). @techstark/opencv-js embeds its WebAssembly in the JavaScript and needs no
// `eval`: it only instantiates WebAssembly, which the worker's own (empty) policy allows.

import type { Pt, Quad } from '../contracts';

// biome-ignore lint/suspicious/noExplicitAny: opencv-js ships loose typings; the brief types cv as any.
export type Cv = any;

/** The long side the page finder works at. */
const FIND_LONG_SIDE = 960;
/** A page covers at least this much of the image… */
const MIN_AREA = 0.2;
/** …and isn't the image's own border: no corner within this many pixels of an edge. */
const EDGE_MARGIN = 2;

/**
 * Loads OpenCV once. The package's default export is a Promise of cv; an older build exports
 * an object that calls onRuntimeInitialized when ready. It comes through opencv-module.ts (see
 * there for why). `source` is for Node's tests, which hand over `require`'s Promise of cv.
 */
let loading: Promise<Cv> | null = null;
export function loadOpenCv(
  source: () => Promise<unknown> = () =>
    import('./opencv-module').then((m) => ({ default: m.cvPromise })),
): Promise<Cv> {
  loading ??= (async () => {
    const module: Cv = await source();
    const exported: Cv = module?.default ?? module;
    if (typeof exported?.then === 'function') return await exported;
    if (exported?.Mat) return exported;
    await new Promise<void>((resolve) => {
      exported.onRuntimeInitialized = () => resolve();
    });
    return exported;
  })();
  return loading;
}

/** Deletes every Mat (or MatVector) given, whatever happened. */
function release(...mats: Array<{ delete(): void } | null | undefined>): void {
  for (const mat of mats) mat?.delete();
}

function matFromRgba(cv: Cv, rgba: Uint8ClampedArray, width: number, height: number): Cv {
  const mat = new cv.Mat(height, width, cv.CV_8UC4);
  mat.data.set(rgba);
  return mat;
}

/** Orders four points TL, TR, BR, BL: min x+y, max x−y, max x+y, min x−y. */
function orderCorners(points: Pt[]): Quad | null {
  const by = (f: (p: Pt) => number, pick: 'min' | 'max') =>
    points.reduce((best, p) => ((pick === 'min' ? f(p) < f(best) : f(p) > f(best)) ? p : best));
  const tl = by((p) => p.x + p.y, 'min');
  const br = by((p) => p.x + p.y, 'max');
  const tr = by((p) => p.x - p.y, 'max');
  const bl = by((p) => p.x - p.y, 'min');
  const quad: Quad = [tl, tr, br, bl];
  return new Set(quad).size === 4 ? quad : null;
}

/**
 * Finds the page: at a long side of 960 px, an Otsu threshold and a 5 × 5 close, then the
 * largest external contour, simplified by approxPolyDP at 2% of its length. Exactly four convex
 * corners covering at least 20% of the image, and not the image's own border, make a page.
 * Returns its corners TL, TR, BR, BL in the given image's pixels, or null.
 */
export function findPageQuad(
  cv: Cv,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Quad | null {
  const scale = Math.min(1, FIND_LONG_SIDE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  let src: Cv = null;
  let gray: Cv = null;
  let small: Cv = null;
  let binary: Cv = null;
  let closed: Cv = null;
  let kernel: Cv = null;
  let contours: Cv = null;
  let hierarchy: Cv = null;
  let approx: Cv = null;
  try {
    src = matFromRgba(cv, rgba, width, height);
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    if (scale < 1) {
      small = new cv.Mat();
      cv.resize(gray, small, new cv.Size(w, h), 0, 0, cv.INTER_AREA);
    }
    binary = new cv.Mat();
    cv.threshold(small ?? gray, binary, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
    kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
    closed = new cv.Mat();
    cv.morphologyEx(binary, closed, cv.MORPH_CLOSE, kernel);
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let best = -1;
    let bestArea = 0;
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      try {
        const area = cv.contourArea(contour);
        if (area > bestArea) {
          bestArea = area;
          best = i;
        }
      } finally {
        contour.delete();
      }
    }
    if (best < 0) return null;
    const largest = contours.get(best);
    approx = new cv.Mat();
    try {
      cv.approxPolyDP(largest, approx, 0.02 * cv.arcLength(largest, true), true);
    } finally {
      largest.delete();
    }
    if (approx.rows !== 4 || !cv.isContourConvex(approx)) return null;
    if (Math.abs(cv.contourArea(approx)) < MIN_AREA * w * h) return null;
    const points: Pt[] = [];
    for (let i = 0; i < 4; i++) {
      points.push({ x: approx.data32S[i * 2] as number, y: approx.data32S[i * 2 + 1] as number });
    }
    const onEdge = points.some(
      (p) =>
        p.x < EDGE_MARGIN ||
        p.y < EDGE_MARGIN ||
        p.x > w - 1 - EDGE_MARGIN ||
        p.y > h - 1 - EDGE_MARGIN,
    );
    if (onEdge) return null;
    const quad = orderCorners(points);
    if (!quad) return null;
    // Contour points are pixel indices; a corner of the page lies at the pixel's center.
    return quad.map((p) => ({ x: (p.x + 0.5) / scale, y: (p.y + 0.5) / scale })) as Quad;
  } finally {
    release(src, gray, small, binary, closed, kernel, contours, hierarchy, approx);
  }
}

/**
 * The perspective transform that takes the quad's region of the image to an outW × outH
 * rectangle. OpenCV puts pixel centers at whole coordinates, so both sides shift by half a pixel:
 * the quad's corners land exactly on the output's corners.
 */
function pageTransform(cv: Cv, quad: Quad, outW: number, outH: number): Cv {
  const src = cv.matFromArray(
    4,
    1,
    cv.CV_32FC2,
    quad.flatMap((p) => [p.x - 0.5, p.y - 0.5]),
  );
  const dst = cv.matFromArray(4, 1, cv.CV_32FC2, [
    -0.5,
    -0.5,
    outW - 0.5,
    -0.5,
    outW - 0.5,
    outH - 0.5,
    -0.5,
    outH - 0.5,
  ]);
  try {
    return cv.getPerspectiveTransform(src, dst);
  } finally {
    release(src, dst);
  }
}

function warp(cv: Cv, input: Cv, quad: Quad, outW: number, outH: number): Cv {
  const m = pageTransform(cv, quad, outW, outH);
  const out = new cv.Mat();
  try {
    cv.warpPerspective(
      input,
      out,
      m,
      new cv.Size(outW, outH),
      cv.INTER_LINEAR,
      cv.BORDER_REPLICATE,
    );
    return out;
  } catch (error) {
    out.delete();
    throw error;
  } finally {
    m.delete();
  }
}

/** The page, flattened to outW × outH, in gray. */
export function warpGray(
  cv: Cv,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  quad: Quad,
  outW: number,
  outH: number,
): Uint8Array {
  let src: Cv = null;
  let gray: Cv = null;
  let out: Cv = null;
  try {
    src = matFromRgba(cv, rgba, width, height);
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    out = warp(cv, gray, quad, outW, outH);
    return Uint8Array.from(out.data as Uint8Array);
  } finally {
    release(src, gray, out);
  }
}

/** The page, flattened to outW × outH, in color. */
export function warpRgba(
  cv: Cv,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  quad: Quad,
  outW: number,
  outH: number,
): Uint8ClampedArray {
  let src: Cv = null;
  let out: Cv = null;
  try {
    src = matFromRgba(cv, rgba, width, height);
    out = warp(cv, src, quad, outW, outH);
    return Uint8ClampedArray.from(out.data as Uint8Array);
  } finally {
    release(src, out);
  }
}
