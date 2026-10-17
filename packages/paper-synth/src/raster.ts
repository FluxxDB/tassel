// Turns a scene at a time into RGBA pixels. Layers, bottom to top: the desk with its static grain,
// the first sheet (paper, ruled lines, margin, print), its handwriting, a second sheet if one is
// being laid down, then the hand. Lighting multiplies everything: a vignette of 1 − 0.06·r², the
// scene's brightness and a passing shadow. Sensor noise goes on last.
//
// Edges are anti-aliased by distance: a pixel's coverage is how far its center lies inside the
// shape, plus half a pixel, clamped to 0–1. Finished strokes are cached in an ink layer, so a
// frame only draws the stroke in progress. Every cache holds a pure function of its key, so the
// order frames are rendered in never changes their bytes.

import {
  expNeg,
  lerp,
  PAGE_ASPECT,
  type Placement,
  type Pt,
  quadOf,
  toFrame,
  toPage,
} from './geometry.ts';
import { mulberry32u, noiseSample, noiseSeed } from './rng.ts';
import {
  type Capsule,
  cutPolyline,
  type Ellipse,
  handShapes,
  handTipAt,
  progress,
  type Rgb,
  type Scene,
  type Sheet,
  type Stroke,
  shapesBounds,
  sheetPlacement,
  sheetPresent,
} from './scene.ts';

// The mock's paper colors.
const PAPER: Rgb = [0xfb, 0xfa, 0xf6];
const RULE: Rgb = [0xe4, 0xeb, 0xf3];
const MARGIN: Rgb = [0xf3, 0xc9, 0xcf];
const PRINT: Rgb = [0x3f, 0x3f, 0x3f];
const SKIN: Rgb = [0xd9, 0xa1, 0x84];
const PEN: Rgb = [0x2b, 0x2b, 0x2b];

/** Ruled lines every 1/20 of the page height from 18%, and the margin line at 7% of the width. */
const RULE_FIRST = 0.18;
const RULE_STEP = 0.05;
const RULE_LAST = 16;
const MARGIN_X = 0.07;
/** Line widths, in page widths. */
const RULE_WIDTH = 0.0012;
const MARGIN_WIDTH = 0.0015;

const GRAIN_SEED = 0x6d65736b;
const GRAIN_LEVELS = 4;
const NOISE_SIGMA = 1.2;

interface SizeCache {
  grain: Float32Array;
  vignette: Float32Array;
  /** Scratch: the current frame's handwriting coverage. */
  ink: Float32Array;
  /** Scratch: the current frame's colors before lighting. */
  rgb: Float32Array;
}

interface SheetLayer {
  alpha: Float32Array;
  rgb: Float32Array;
}

/** A tiny least-recently-used map. */
class Lru<V> {
  private readonly map = new Map<string, V>();
  private readonly size: number;
  constructor(size: number) {
    this.size = size;
  }
  get(key: string, make: () => V): V {
    const hit = this.map.get(key);
    if (hit !== undefined) {
      this.map.delete(key);
      this.map.set(key, hit);
      return hit;
    }
    const value = make();
    this.map.set(key, value);
    if (this.map.size > this.size) this.map.delete(this.map.keys().next().value as string);
    return value;
  }
}

interface SceneCache {
  sizes: Lru<SizeCache>;
  sheets: Lru<SheetLayer>;
  inks: Lru<Float32Array>;
}

const caches = new WeakMap<Scene, SceneCache>();

function cacheOf(scene: Scene): SceneCache {
  let cache = caches.get(scene);
  if (!cache) {
    cache = { sizes: new Lru(2), sheets: new Lru(4), inks: new Lru(3) };
    caches.set(scene, cache);
  }
  return cache;
}

function makeSize(width: number, height: number): SizeCache {
  const n = width * height;
  const grain = new Float32Array(n);
  const next = mulberry32u(GRAIN_SEED);
  for (let i = 0; i < n; i++) grain[i] = (next() / 2147483648 - 1) * GRAIN_LEVELS;
  const vignette = new Float32Array(n);
  const cx = width / 2;
  const cy = height / 2;
  const corner = cx * cx + cy * cy;
  for (let y = 0; y < height; y++) {
    const dy = y + 0.5 - cy;
    for (let x = 0; x < width; x++) {
      const dx = x + 0.5 - cx;
      vignette[y * width + x] = 1 - (0.06 * (dx * dx + dy * dy)) / corner;
    }
  }
  return { grain, vignette, ink: new Float32Array(n), rgb: new Float32Array(n * 3) };
}

const placementKey = (p: Placement) => `${p.cx},${p.cy},${p.scale}`;

/**
 * Draws a round-capped polyline into a coverage buffer, keeping the larger coverage per pixel.
 * Points are frame pixels; `halfWidth` is in pixels.
 */
export function strokeInto(
  cov: Float32Array,
  width: number,
  height: number,
  points: Pt[],
  halfWidth: number,
): void {
  const reach = halfWidth + 1;
  const segments = Math.max(1, points.length - 1);
  for (let s = 0; s < segments; s++) {
    const a = points[s] as Pt;
    const b = (points[s + 1] ?? a) as Pt;
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - reach));
    const x1 = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x) + reach));
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - reach));
    const y1 = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y) + reach));
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5 - a.y;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - a.x;
        let f = len2 > 0 ? (px * dx + py * dy) / len2 : 0;
        if (f < 0) f = 0;
        else if (f > 1) f = 1;
        const ex = px - f * dx;
        const ey = py - f * dy;
        const c = halfWidth + 0.5 - Math.sqrt(ex * ex + ey * ey);
        if (c <= 0) continue;
        const i = y * width + x;
        const v = c > 1 ? 1 : c;
        if (v > (cov[i] as number)) cov[i] = v;
      }
    }
  }
}

const framePoints = (p: Placement, points: Pt[]) => points.map((q) => toFrame(p, q.x, q.y));

function makeSheetLayer(sheet: Sheet, p: Placement, width: number, height: number): SheetLayer {
  const n = width * height;
  const alpha = new Float32Array(n);
  const rgb = new Float32Array(n * 3);
  const print = new Float32Array(n);
  for (const stroke of sheet.printed) {
    strokeInto(print, width, height, framePoints(p, stroke.points), (stroke.width / 2) * p.scale);
  }
  const quad = quadOf(p);
  const xs = quad.map((q) => q.x);
  const ys = quad.map((q) => q.y);
  const bx0 = Math.max(0, Math.floor(Math.min(...xs)) - 1);
  const bx1 = Math.min(width - 1, Math.ceil(Math.max(...xs)) + 1);
  const by0 = Math.max(0, Math.floor(Math.min(...ys)) - 1);
  const by1 = Math.min(height - 1, Math.ceil(Math.max(...ys)) + 1);
  const ruleHalf = (RULE_WIDTH / 2) * p.scale;
  const marginHalf = (MARGIN_WIDTH / 2) * p.scale;
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      const at = toPage(p, x + 0.5, y + 0.5);
      const inside = Math.min(at.x, 1 - at.x, at.y, PAGE_ASPECT - at.y) * p.scale;
      if (inside <= -0.5) continue;
      const i = y * width + x;
      alpha[i] = inside >= 0.5 ? 1 : inside + 0.5;
      const j = i * 3;
      rgb[j] = PAPER[0];
      rgb[j + 1] = PAPER[1];
      rgb[j + 2] = PAPER[2];
      const k = Math.round((at.y / PAGE_ASPECT - RULE_FIRST) / RULE_STEP);
      if (k >= 0 && k <= RULE_LAST) {
        const line = (RULE_FIRST + RULE_STEP * k) * PAGE_ASPECT;
        blendAt(rgb, j, RULE, ruleHalf + 0.5 - Math.abs(at.y - line) * p.scale);
      }
      blendAt(rgb, j, MARGIN, marginHalf + 0.5 - Math.abs(at.x - MARGIN_X) * p.scale);
      for (const box of sheet.boxes) {
        const inBox = Math.min(at.x - box.x0, box.x1 - at.x, at.y - box.y0, box.y1 - at.y);
        blendAt(rgb, j, box.color, 0.5 + inBox * p.scale);
      }
      blendAt(rgb, j, PRINT, print[i] as number);
    }
  }
  return { alpha, rgb };
}

/** Blends `color` over the pixel at rgb[j…j+2] with coverage c, clamped to 0–1. */
function blendAt(rgb: Float32Array, j: number, color: Rgb, c: number): void {
  if (c <= 0) return;
  const f = c > 1 ? 1 : c;
  rgb[j] = (rgb[j] as number) + (color[0] - (rgb[j] as number)) * f;
  rgb[j + 1] = (rgb[j + 1] as number) + (color[1] - (rgb[j + 1] as number)) * f;
  rgb[j + 2] = (rgb[j + 2] as number) + (color[2] - (rgb[j + 2] as number)) * f;
}

function finishedCount(strokes: Stroke[], t: number): number {
  let n = 0;
  while (
    n < strokes.length &&
    progress((strokes[n] as Stroke).t0, (strokes[n] as Stroke).t1, t) >= 1
  )
    n++;
  return n;
}

function makeInkLayer(
  strokes: Stroke[],
  count: number,
  p: Placement,
  width: number,
  height: number,
) {
  const cov = new Float32Array(width * height);
  for (let s = 0; s < count; s++) {
    const stroke = strokes[s] as Stroke;
    strokeInto(cov, width, height, framePoints(p, stroke.points), (stroke.width / 2) * p.scale);
  }
  return cov;
}

/** Fills `ink` with the first sheet's handwriting coverage at time t. */
function inkAt(
  scene: Scene,
  cache: SceneCache,
  size: SizeCache,
  p: Placement,
  t: number,
  width: number,
  height: number,
) {
  const count = finishedCount(scene.strokes, t);
  const key = `${width}x${height}|${placementKey(p)}|${count}`;
  size.ink.set(cache.inks.get(key, () => makeInkLayer(scene.strokes, count, p, width, height)));
  const current = scene.strokes[count];
  if (current) {
    const f = progress(current.t0, current.t1, t);
    if (f > 0) {
      const length = f * (current.cum[current.cum.length - 1] as number);
      const drawn = cutPolyline(current.points, current.cum, length);
      strokeInto(size.ink, width, height, framePoints(p, drawn), (current.width / 2) * p.scale);
    }
  }
  for (const eraser of scene.erasers) {
    const f = progress(eraser.t0, eraser.t1, t);
    if (f <= 0) continue;
    const path = cutPolyline(
      eraser.points,
      eraser.cum,
      f * (eraser.cum[eraser.cum.length - 1] as number),
    );
    const pts = framePoints(p, path);
    const half = (eraser.width / 2) * p.scale;
    const x0 = Math.max(0, Math.floor(Math.min(...pts.map((q) => q.x)) - half - 1));
    const x1 = Math.min(width - 1, Math.ceil(Math.max(...pts.map((q) => q.x)) + half + 1));
    const y0 = Math.max(0, Math.floor(Math.min(...pts.map((q) => q.y)) - half - 1));
    const y1 = Math.min(height - 1, Math.ceil(Math.max(...pts.map((q) => q.y)) + half + 1));
    const bw = x1 - x0 + 1;
    const local = new Float32Array(bw * (y1 - y0 + 1));
    strokeInto(
      local,
      bw,
      y1 - y0 + 1,
      pts.map((q) => ({ x: q.x - x0, y: q.y - y0 })),
      half,
    );
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const c = local[(y - y0) * bw + (x - x0)] as number;
        if (c > 0) size.ink[y * width + x] = (size.ink[y * width + x] as number) * (1 - c);
      }
    }
  }
}

function capsuleCoverage(c: Capsule, px: number, py: number): number {
  const dx = c.bx - c.ax;
  const dy = c.by - c.ay;
  const qx = px - c.ax;
  const qy = py - c.ay;
  let f = (qx * dx + qy * dy) / (dx * dx + dy * dy);
  if (f < 0) f = 0;
  else if (f > 1) f = 1;
  const ex = qx - f * dx;
  const ey = qy - f * dy;
  const v = c.r + 0.5 - Math.sqrt(ex * ex + ey * ey);
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

function ellipseCoverage(e: Ellipse, px: number, py: number): number {
  const ex = (px - e.cx) / e.rx;
  const ey = (py - e.cy) / e.ry;
  const f = ex * ex + ey * ey - 1;
  const gx = (2 * ex) / e.rx;
  const gy = (2 * ey) / e.ry;
  const g = Math.sqrt(gx * gx + gy * gy);
  // The implicit function over its gradient: the signed distance, close to the edge.
  const d = g > 0 ? f / g : -Math.min(e.rx, e.ry);
  const v = 0.5 - d;
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

function drawHand(rgb: Float32Array, tip: Pt, width: number, height: number): void {
  const shapes = handShapes(tip, width, height);
  const box = shapesBounds(shapes);
  const x0 = Math.max(0, Math.floor(box.x0));
  const x1 = Math.min(width - 1, Math.ceil(box.x1));
  const y0 = Math.max(0, Math.floor(box.y0));
  const y1 = Math.min(height - 1, Math.ceil(box.y1));
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const pen = capsuleCoverage(shapes.pen, px, py);
      const skin = Math.max(
        ellipseCoverage(shapes.palm, px, py),
        capsuleCoverage(shapes.arm, px, py),
      );
      if (pen === 0 && skin === 0) continue;
      const j = (y * width + x) * 3;
      let r = rgb[j] as number;
      let g = rgb[j + 1] as number;
      let b = rgb[j + 2] as number;
      if (pen > 0) {
        r += (PEN[0] - r) * pen;
        g += (PEN[1] - g) * pen;
        b += (PEN[2] - b) * pen;
      }
      if (skin > 0) {
        r += (SKIN[0] - r) * skin;
        g += (SKIN[1] - g) * skin;
        b += (SKIN[2] - b) * skin;
      }
      rgb[j] = r;
      rgb[j + 1] = g;
      rgb[j + 2] = b;
    }
  }
}

const sameOffset = (a: Placement, b: Placement) => a.cx === b.cx && a.cy === b.cy;

export function renderScene(
  scene: Scene,
  t: number,
  width: number,
  height: number,
  noise: boolean,
  frameIndex: number,
): Uint8ClampedArray {
  const cache = cacheOf(scene);
  const size = cache.sizes.get(`${width}x${height}`, () => makeSize(width, height));
  const n = width * height;

  const p0 = sheetPlacement(scene, 0, t, width, height);
  const top =
    scene.sheets.length > 1 && sheetPresent(scene, 1, t)
      ? sheetPlacement(scene, 1, t, width, height)
      : null;
  // A sheet laid exactly over the first one hides it, and its handwriting, completely.
  const hidden = top !== null && sameOffset(top, p0);
  const layer = (index: number, p: Placement) =>
    cache.sheets.get(`${index}|${width}x${height}|${placementKey(p)}`, () =>
      makeSheetLayer(scene.sheets[index] as Sheet, p, width, height),
    );
  const under = hidden ? null : layer(0, p0);
  const over = top ? layer(1, top) : null;
  if (under) inkAt(scene, cache, size, p0, t, width, height);

  const { grain, vignette, ink, rgb } = size;
  const [deskR, deskG, deskB] = scene.desk;
  const [inkR, inkG, inkB] = scene.ink;
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const gr = grain[i] as number;
    let r = deskR + gr;
    let g = deskG + gr;
    let b = deskB + gr;
    if (under) {
      const a = under.alpha[i] as number;
      if (a > 0) {
        r += ((under.rgb[j] as number) - r) * a;
        g += ((under.rgb[j + 1] as number) - g) * a;
        b += ((under.rgb[j + 2] as number) - b) * a;
      }
      const c = ink[i] as number;
      if (c > 0) {
        r += (inkR - r) * c;
        g += (inkG - g) * c;
        b += (inkB - b) * c;
      }
    }
    if (over) {
      const a = over.alpha[i] as number;
      if (a > 0) {
        r += ((over.rgb[j] as number) - r) * a;
        g += ((over.rgb[j + 1] as number) - g) * a;
        b += ((over.rgb[j + 2] as number) - b) * a;
      }
    }
    rgb[j] = r;
    rgb[j + 1] = g;
    rgb[j + 2] = b;
  }

  const tip = handTipAt(scene, t, width, height);
  if (tip) drawHand(rgb, tip, width, height);

  const out = new Uint8ClampedArray(n * 4);
  const brightness = scene.brightnessAt(t);
  const shadow = scene.shadow;
  const shadowOn = shadow !== null && t >= shadow.t0 && t <= shadow.t1;
  const f = shadowOn ? (t - shadow.t0) / (shadow.t1 - shadow.t0) : 0;
  const sx = shadowOn ? lerp(shadow.from.x, shadow.to.x, f) * width : 0;
  const sy = shadowOn ? lerp(shadow.from.y, shadow.to.y, f) * height : 0;
  const sigma = shadowOn ? shadow.sigma * height : 1;
  const twoSigma2 = 2 * sigma * sigma;
  const reach2 = 36 * sigma * sigma;
  const depth = shadowOn ? shadow.depth : 0;
  const next = noise ? mulberry32u(noiseSeed(frameIndex)) : null;
  for (let y = 0, i = 0; y < height; y++) {
    const dy = y + 0.5 - sy;
    for (let x = 0; x < width; x++, i++) {
      let light = (vignette[i] as number) * brightness;
      if (shadowOn) {
        const dx = x + 0.5 - sx;
        const d2 = dx * dx + dy * dy;
        if (d2 < reach2) light *= 1 - depth * expNeg(-d2 / twoSigma2);
      }
      const j = i * 3;
      const k = i * 4;
      // Uint8ClampedArray rounds half to even and clamps, as the spec defines on every platform.
      if (next) {
        out[k] = (rgb[j] as number) * light + noiseSample(next(), NOISE_SIGMA);
        out[k + 1] = (rgb[j + 1] as number) * light + noiseSample(next(), NOISE_SIGMA);
        out[k + 2] = (rgb[j + 2] as number) * light + noiseSample(next(), NOISE_SIGMA);
      } else {
        out[k] = (rgb[j] as number) * light;
        out[k + 1] = (rgb[j + 1] as number) * light;
        out[k + 2] = (rgb[j + 2] as number) * light;
      }
      out[k + 3] = 255;
    }
  }
  return out;
}
