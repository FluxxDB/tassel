// Points, the page and where it lies in the frame.
//
// Page geometry is in page widths: X runs 0–1 across the page and Y runs 0–PAGE_ASPECT down it,
// so a circle stays round on paper. Page coordinates (the truth's, 0–1 on both axes) are
// (X, Y / PAGE_ASPECT). Frame positions are pixels from the frame's top-left.
//
// Only +, −, ×, ÷ and Math.sqrt (correctly rounded by IEEE 754) are used, so every platform gives
// the same bits. sin, cos and exp below are polynomials for that reason, rather than Math's, whose
// last bits are left to each engine.

export interface Pt {
  x: number;
  y: number;
}

/** TL, TR, BR, BL. */
export type Quad = [Pt, Pt, Pt, Pt];

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** US Letter in landscape: 8.5 high for 11 wide. */
export const PAGE_ASPECT = 8.5 / 11;
/** The page is tilted by −1.4° (counter-clockwise on screen, where y points down). */
export const PAGE_TILT_DEG = -1.4;
/** The page's height, as a fraction of the frame's. */
export const PAGE_HEIGHT_FRACTION = 0.86;

// Constants are exact doubles, the same everywhere; only Math's functions vary by engine.
const PI = Math.PI;
const HALF_PI = Math.PI / 2;
const LN2 = Math.LN2;

function sinPoly(y: number): number {
  const y2 = y * y;
  return (
    y *
    (1 +
      y2 *
        (-1 / 6 +
          y2 *
            (1 / 120 +
              y2 * (-1 / 5040 + y2 * (1 / 362880 + y2 * (-1 / 39916800 + y2 / 6227020800))))))
  );
}

function cosPoly(y: number): number {
  const y2 = y * y;
  return (
    1 +
    y2 *
      (-1 / 2 +
        y2 *
          (1 / 24 +
            y2 *
              (-1 / 720 +
                y2 * (1 / 40320 + y2 * (-1 / 3628800 + y2 * (1 / 479001600 - y2 / 87178291200))))))
  );
}

/** sin, the same on every platform. Accurate to about 1e-15 for |x| up to a few hundred. */
export function sin(x: number): number {
  const q = Math.round(x / HALF_PI);
  const y = x - q * HALF_PI;
  switch (((q % 4) + 4) % 4) {
    case 0:
      return sinPoly(y);
    case 1:
      return cosPoly(y);
    case 2:
      return -sinPoly(y);
    default:
      return -cosPoly(y);
  }
}

export function cos(x: number): number {
  return sin(x + HALF_PI);
}

// 2^-k for k = 0…64, by exact halvings.
const HALVES: number[] = [1];
for (let k = 1; k <= 64; k++) HALVES.push((HALVES[k - 1] as number) / 2);

/** exp for x ≤ 0, the same on every platform. Returns 0 below −40, where exp is under 1e-17. */
export function expNeg(x: number): number {
  if (x > 0) throw new Error(`expNeg needs x ≤ 0, got ${x}`);
  if (x < -40) return 0;
  const k = Math.round(x / LN2);
  const r = x - k * LN2;
  let term = 1;
  let sum = 1;
  for (let n = 1; n <= 14; n++) {
    term = (term * r) / n;
    sum += term;
  }
  return sum * (HALVES[-k] as number);
}

export const toRadians = (degrees: number) => (degrees * PI) / 180;

const TILT_COS = cos(toRadians(PAGE_TILT_DEG));
const TILT_SIN = sin(toRadians(PAGE_TILT_DEG));

/** Where a sheet lies: its offset from the centered position, in frame heights. */
export interface Offset {
  dx: number;
  dy: number;
}

/** A sheet's pose in one frame: its center, its tilt, and its width in pixels. */
export interface Placement {
  cx: number;
  cy: number;
  cos: number;
  sin: number;
  scale: number;
}

export function placementOf(
  width: number,
  height: number,
  heightFraction: number,
  offset: Offset,
): Placement {
  return {
    cx: width / 2 + offset.dx * height,
    cy: height / 2 + offset.dy * height,
    cos: TILT_COS,
    sin: TILT_SIN,
    scale: (heightFraction * height) / PAGE_ASPECT,
  };
}

/** A point in page widths to frame pixels. */
export function toFrame(p: Placement, X: number, Y: number): Pt {
  const lx = (X - 0.5) * p.scale;
  const ly = (Y - PAGE_ASPECT / 2) * p.scale;
  return { x: p.cx + lx * p.cos - ly * p.sin, y: p.cy + lx * p.sin + ly * p.cos };
}

/** Frame pixels to a point in page widths. */
export function toPage(p: Placement, x: number, y: number): Pt {
  const dx = x - p.cx;
  const dy = y - p.cy;
  const lx = dx * p.cos + dy * p.sin;
  const ly = -dx * p.sin + dy * p.cos;
  return { x: lx / p.scale + 0.5, y: ly / p.scale + PAGE_ASPECT / 2 };
}

export function quadOf(p: Placement): Quad {
  return [
    toFrame(p, 0, 0),
    toFrame(p, 1, 0),
    toFrame(p, 1, PAGE_ASPECT),
    toFrame(p, 0, PAGE_ASPECT),
  ];
}

/** True when p lies inside the convex quad (or on its edge). */
export function insideQuad(q: Quad, p: Pt): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i] as Pt;
    const b = q[(i + 1) % 4] as Pt;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross === 0) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

export const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

export function distance(a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Points along an ellipse, from `fromDeg` to `toDeg` (increasing is clockwise on screen). */
export function arc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  fromDeg: number,
  toDeg: number,
  steps: number,
): Pt[] {
  const points: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = toRadians(fromDeg + ((toDeg - fromDeg) * i) / steps);
    points.push({ x: cx + rx * cos(a), y: cy + ry * sin(a) });
  }
  return points;
}

/** The bounding box of a set of polylines. */
export function boundsOf(strokes: Pt[][]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const stroke of strokes) {
    for (const p of stroke) {
      if (p.x < x0) x0 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x;
      if (p.y > y1) y1 = p.y;
    }
  }
  return { x0, y0, x1, y1 };
}
