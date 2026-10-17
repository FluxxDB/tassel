// The frames of Ada's two effects, at a time since each began: the pulse's ring around a state and
// the glide's token along edges. MOTION's durations and easings; pure, with no tldraw.
import type { Pt } from '@tassel/shared/beats';
import { MOTION } from '../motion';

/** A CSS easing ('linear' or 'cubic-bezier(x1, y1, x2, y2)') as a function of progress 0–1. */
export function cubicBezier(css: string): (t: number) => number {
  if (css === 'linear') return (t) => t;
  const match = /^cubic-bezier\(([^,]+),([^,]+),([^,]+),([^)]+)\)$/.exec(css.replace(/\s/g, ''));
  const [x1, y1, x2, y2] = (match?.slice(1) ?? []).map(Number);
  if (!match || ![x1, y1, x2, y2].every(Number.isFinite)) {
    throw new Error(`Not an easing: ${css}`);
  }
  // Each coordinate of the curve at parameter s, with P0 = (0, 0) and P3 = (1, 1).
  const at = (a: number, b: number, s: number) =>
    3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;
  const slope = (a: number, b: number, s: number) =>
    3 * (1 - s) * (1 - s) * a + 6 * (1 - s) * s * (b - a) + 3 * s * s * (1 - b);
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // Find s with x(s) = t: Newton's method, then bisection if it stalls.
    let s = t;
    for (let i = 0; i < 8; i++) {
      const dx = at(x1, x2, s) - t;
      if (Math.abs(dx) < 1e-7) return at(y1, y2, s);
      const d = slope(x1, x2, s);
      if (Math.abs(d) < 1e-6) break;
      s -= dx / d;
    }
    let lo = 0;
    let hi = 1;
    s = t;
    for (let i = 0; i < 40; i++) {
      const x = at(x1, x2, s);
      if (Math.abs(x - t) < 1e-7) break;
      if (x < t) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return at(y1, y2, s);
  };
}

const ease = cubicBezier(MOTION.ease);
const glideEase = cubicBezier(MOTION.glideEase);

/**
 * The pulse around a state of radius `r`, `elapsedMs` in: a ring from r + 4 to r + 14 on
 * MOTION.ease, fading evenly over MOTION.pulseMs. (On the ease the fade was a flash: 85% gone a
 * quarter of the way in.)
 */
export function pulseRingAt(r: number, elapsedMs: number): { r: number; alpha: number } {
  const progress = Math.min(1, Math.max(0, elapsedMs / MOTION.pulseMs));
  return { r: r + 4 + 10 * ease(progress), alpha: 1 - progress };
}

/**
 * Where the glide's token is, `elapsedMs` in: MOTION.glideMs along each edge in turn, each edge a
 * path of points. Null with no edges.
 */
export function glideTokenAt(edges: readonly (readonly Pt[])[], elapsedMs: number): Pt | null {
  if (edges.length === 0) return null;
  const elapsed = Math.max(0, elapsedMs);
  const index = Math.min(Math.floor(elapsed / MOTION.glideMs), edges.length - 1);
  const local = Math.min(1, (elapsed - index * MOTION.glideMs) / MOTION.glideMs);
  return pointAlong(edges[index], glideEase(local));
}

/** The point `fraction` of the way along a path, by length. */
function pointAlong(path: readonly Pt[], fraction: number): Pt {
  const first = path[0] ?? { x: 0, y: 0 };
  const last = path[path.length - 1] ?? first;
  if (fraction <= 0 || path.length < 2) return { x: first.x, y: first.y };
  if (fraction >= 1) return { x: last.x, y: last.y };
  const lengths = path
    .slice(1)
    .map((point, i) => Math.hypot(point.x - path[i].x, point.y - path[i].y));
  let left = fraction * lengths.reduce((sum, length) => sum + length, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] && lengths[i] > 0) {
      const k = left / lengths[i];
      return {
        x: path[i].x + (path[i + 1].x - path[i].x) * k,
        y: path[i].y + (path[i + 1].y - path[i].y) * k,
      };
    }
    left -= lengths[i];
  }
  return { x: last.x, y: last.y };
}
