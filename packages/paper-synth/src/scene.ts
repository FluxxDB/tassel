// The scene behind a clip: the sheets on the desk, the ink on them, the hand that draws it, and
// the lighting, each as a pure function of time. variants.ts builds one scene per variant;
// raster.ts turns a scene and a time into pixels.

import {
  distance,
  lerp,
  type NormRect,
  type Offset,
  PAGE_ASPECT,
  type Placement,
  type Pt,
  placementOf,
  type Quad,
  quadOf,
  toFrame,
} from './geometry.ts';

/** Bump when a change to the generator changes any clip's bytes. */
export const GENERATOR_VERSION = 2;

export type VariantName =
  | 'dfa-demo'
  | 'dfa-short'
  | 'hand-rests'
  | 'starts-with-hand'
  | 'shadow-pass'
  | 'exposure-step'
  | 'page-shift'
  | 'slide-and-hold'
  | 'page-flip'
  | 'erase'
  | 'slow-drift'
  | 'printed-box'
  | 'dark-desk'
  | 'bold-pen'
  | 'nudge-while-writing';

export interface ExpectedTrigger {
  reason: 'ink' | 'page';
  atMs: number;
  toleranceMs: number;
  groups: string[];
}

export interface ClipTruth {
  /**
   * The drawn DFA, in page coordinates (0–1 from the page's top-left). A state's `radius` is a
   * fraction of the page width, so the circle is round on paper.
   */
  dfa: {
    states: Array<{ id: string; center: Pt; radius: number; accept: boolean; start: boolean }>;
    transitions: Array<{ from: string; to: string; label: string; labelAt: Pt }>;
  };
  /**
   * Each group of ink drawn, or erased, together. Ink already on the page when the clip starts
   * has startMs = endMs = 0.
   */
  groups: Array<{ id: string; startMs: number; endMs: number; bbox: NormRect }>;
  /** When the hand is in the frame: over the page, and moving or lying still. */
  hand: Array<{ fromMs: number; toMs: number; onPage: boolean; moving: boolean }>;
  expectedTriggers: ExpectedTrigger[];
}

export interface Clip {
  name: VariantName;
  durationMs: number;
  pageQuadAt(tMs: number, width: number, height: number): Quad;
  truth: ClipTruth;
}

export type Rgb = readonly [number, number, number];

/** Times of ink that is already on the page when the clip starts. */
export const PREDRAWN = -1;

/** A polyline drawn with a round pen, in page widths. */
export interface Stroke {
  group: string;
  points: Pt[];
  /** Arc length from the first point to each point. */
  cum: number[];
  /** The pen's width, in page widths. */
  width: number;
  /** Drawn from t0 to t1 ms, at constant speed; PREDRAWN for ink already there. */
  t0: number;
  t1: number;
}

/** An eraser dragged along a path; it removes the handwriting under it, never the print. */
export interface Eraser {
  group: string;
  points: Pt[];
  cum: number[];
  width: number;
  t0: number;
  t1: number;
}

/** A solid printed rectangle, in page widths. */
export interface PrintedBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: Rgb;
}

/** A sheet's position over time: piecewise linear between keyframes, in frame heights. */
export interface OffsetKey {
  t: number;
  dx: number;
  dy: number;
}

export interface Sheet {
  printed: Stroke[];
  boxes: PrintedBox[];
  /** The sheet enters the scene at this time (0 for the first sheet). */
  fromMs: number;
  offsets: OffsetKey[];
}

/** A keyframe of the pen tip: in normalized frame coordinates, or on a sheet in page widths. */
export interface HandKey {
  t: number;
  anchor: 'frame' | number;
  x: number;
  y: number;
}

/** A soft round shadow crossing the frame; positions are normalized frame coordinates. */
export interface Shadow {
  t0: number;
  t1: number;
  from: Pt;
  to: Pt;
  /** Its Gaussian sigma, in frame heights. */
  sigma: number;
  /** How much darker it is at its center: 0.25 is 25%. */
  depth: number;
}

export interface Scene {
  name: VariantName;
  durationMs: number;
  /** The page's height, as a fraction of the frame's. */
  heightFraction: number;
  desk: Rgb;
  ink: Rgb;
  sheets: Sheet[];
  /** Handwriting, on the first sheet, sorted by t1. */
  strokes: Stroke[];
  erasers: Eraser[];
  /** Each session is one visit of the hand, from its first keyframe to its last. */
  sessions: HandKey[][];
  shadow: Shadow | null;
  brightnessAt(tMs: number): number;
  truth: ClipTruth;
}

const scenes = new WeakMap<Clip, Scene>();

export function clipOf(scene: Scene): Clip {
  const clip: Clip = {
    name: scene.name,
    durationMs: scene.durationMs,
    pageQuadAt: (tMs, width, height) => quadOf(sheetPlacement(scene, 0, tMs, width, height)),
    truth: scene.truth,
  };
  scenes.set(clip, scene);
  return clip;
}

export function sceneOf(clip: Clip): Scene {
  const scene = scenes.get(clip);
  if (!scene) throw new Error('not a paper-synth clip: make it with makeClip');
  return scene;
}

export function offsetAt(keys: OffsetKey[], t: number): Offset {
  const first = keys[0] as OffsetKey;
  if (t <= first.t) return { dx: first.dx, dy: first.dy };
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i] as OffsetKey;
    if (t <= b.t) {
      const a = keys[i - 1] as OffsetKey;
      const f = (t - a.t) / (b.t - a.t);
      return { dx: lerp(a.dx, b.dx, f), dy: lerp(a.dy, b.dy, f) };
    }
  }
  const last = keys[keys.length - 1] as OffsetKey;
  return { dx: last.dx, dy: last.dy };
}

/** Whether a sheet is on the desk at time t. */
export const sheetPresent = (scene: Scene, index: number, t: number) =>
  (scene.sheets[index] as Sheet).fromMs <= t;

export function sheetPlacement(
  scene: Scene,
  index: number,
  t: number,
  width: number,
  height: number,
): Placement {
  const sheet = scene.sheets[index] as Sheet;
  return placementOf(width, height, scene.heightFraction, offsetAt(sheet.offsets, t));
}

/** Arc lengths along a polyline. */
export function cumulative(points: Pt[]): number[] {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push((cum[i - 1] as number) + distance(points[i - 1] as Pt, points[i] as Pt));
  }
  return cum;
}

/** The polyline cut at arc length `length`: its points up to there, and the point there. */
export function cutPolyline(points: Pt[], cum: number[], length: number): Pt[] {
  const out: Pt[] = [points[0] as Pt];
  for (let i = 1; i < points.length; i++) {
    const at = cum[i] as number;
    if (at <= length) {
      out.push(points[i] as Pt);
      continue;
    }
    const before = cum[i - 1] as number;
    const f = at > before ? (length - before) / (at - before) : 0;
    const a = points[i - 1] as Pt;
    const b = points[i] as Pt;
    out.push({ x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) });
    break;
  }
  return out;
}

/** The fraction of a stroke drawn by time t: 0 before t0, 1 from t1 on. */
export function progress(t0: number, t1: number, t: number): number {
  if (t0 === PREDRAWN || t >= t1) return 1;
  if (t <= t0) return 0;
  return (t - t0) / (t1 - t0);
}

function resolve(scene: Scene, key: HandKey, t: number, width: number, height: number): Pt {
  if (key.anchor === 'frame') return { x: key.x * width, y: key.y * height };
  return toFrame(sheetPlacement(scene, key.anchor, t, width, height), key.x, key.y);
}

/** The pen tip in frame pixels at time t, or null when the hand isn't in the scene. */
export function handTipAt(scene: Scene, t: number, width: number, height: number): Pt | null {
  for (const keys of scene.sessions) {
    const first = keys[0] as HandKey;
    const last = keys[keys.length - 1] as HandKey;
    if (t < first.t || t > last.t) continue;
    let lo = 0;
    let hi = keys.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((keys[mid] as HandKey).t <= t) lo = mid;
      else hi = mid;
    }
    const a = keys[lo] as HandKey;
    const b = keys[hi] as HandKey;
    const pa = resolve(scene, a, t, width, height);
    if (b.t <= a.t) return pa;
    const pb = resolve(scene, b, t, width, height);
    const f = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
    return { x: lerp(pa.x, pb.x, f), y: lerp(pa.y, pb.y, f) };
  }
  return null;
}

export interface Capsule {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
}

export interface Ellipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface HandShapes {
  pen: Capsule;
  palm: Ellipse;
  arm: Capsule;
}

// The forearm runs from the palm toward the bottom-right corner, far past the frame's edge.
const ARM_LENGTH = Math.sqrt(0.75 * 0.75 + 0.65 * 0.65);
const ARM_DX = 0.75 / ARM_LENGTH;
const ARM_DY = 0.65 / ARM_LENGTH;

/**
 * The hand around a pen tip, in frame pixels: a pen capsule from the tip toward the
 * bottom-right, a palm ellipse 16% × 11% of the frame, and a forearm capsule.
 */
export function handShapes(tip: Pt, width: number, height: number): HandShapes {
  const palm = {
    cx: tip.x + 0.105 * height,
    cy: tip.y + 0.095 * height,
    rx: 0.08 * width,
    ry: 0.055 * height,
  };
  return {
    pen: {
      ax: tip.x,
      ay: tip.y,
      bx: tip.x + 0.055 * height,
      by: tip.y + 0.085 * height,
      r: 0.0065 * height,
    },
    palm,
    arm: {
      ax: palm.cx,
      ay: palm.cy,
      bx: palm.cx + 1.6 * height * ARM_DX,
      by: palm.cy + 1.6 * height * ARM_DY,
      r: 0.052 * height,
    },
  };
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function shapesBounds(s: HandShapes): Box {
  const capsule = (c: Capsule): Box => ({
    x0: Math.min(c.ax, c.bx) - c.r,
    y0: Math.min(c.ay, c.by) - c.r,
    x1: Math.max(c.ax, c.bx) + c.r,
    y1: Math.max(c.ay, c.by) + c.r,
  });
  const boxes = [
    capsule(s.pen),
    capsule(s.arm),
    {
      x0: s.palm.cx - s.palm.rx,
      y0: s.palm.cy - s.palm.ry,
      x1: s.palm.cx + s.palm.rx,
      y1: s.palm.cy + s.palm.ry,
    },
  ];
  // One more pixel all round for anti-aliasing.
  return {
    x0: Math.min(...boxes.map((b) => b.x0)) - 1,
    y0: Math.min(...boxes.map((b) => b.y0)) - 1,
    x1: Math.max(...boxes.map((b) => b.x1)) + 1,
    y1: Math.max(...boxes.map((b) => b.y1)) + 1,
  };
}

/** The bounding box of the hand, pen and forearm in frame pixels, or null with no hand. */
export function handBounds(clip: Clip, tMs: number, width: number, height: number): Box | null {
  const tip = handTipAt(sceneOf(clip), tMs, width, height);
  return tip ? shapesBounds(handShapes(tip, width, height)) : null;
}

/**
 * Every handwriting point in frame pixels, at the time the pen puts it down (ink already on the
 * page: at t = 0, and again at the end, in case the page moved). For tests.
 */
export function strokeSamples(
  clip: Clip,
  width: number,
  height: number,
): Array<Pt & { tMs: number }> {
  const scene = sceneOf(clip);
  const out: Array<Pt & { tMs: number }> = [];
  for (const stroke of scene.strokes) {
    const times =
      stroke.t0 === PREDRAWN
        ? [0, scene.durationMs]
        : stroke.points.map(
            (_, i) =>
              stroke.t0 +
              ((stroke.t1 - stroke.t0) * (stroke.cum[i] as number)) /
                (stroke.cum[stroke.cum.length - 1] || 1),
          );
    for (const [i, p] of stroke.points.entries()) {
      for (const tMs of stroke.t0 === PREDRAWN ? times : [times[i] as number]) {
        const at = toFrame(sheetPlacement(scene, 0, tMs, width, height), p.x, p.y);
        out.push({ ...at, tMs });
      }
    }
  }
  return out;
}

/** The distinct pen widths of a clip's handwriting, in page widths. For tests. */
export function strokeWidthsOf(clip: Clip): number[] {
  return [...new Set(sceneOf(clip).strokes.map((s) => s.width))];
}

/** Page-width coordinates to the truth's page coordinates. */
export const toPageCoords = (p: Pt): Pt => ({ x: p.x, y: p.y / PAGE_ASPECT });
