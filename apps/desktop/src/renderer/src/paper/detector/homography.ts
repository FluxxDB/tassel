// Plane-to-plane maps for the page: between the flattened page and the frame, and between two
// samples of the same page.

import type { Pt, Quad } from '../contracts';

/** A 3 × 3 matrix, row by row. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

/**
 * The homography from the unit square (TL, TR, BR, BL = (0,0), (1,0), (1,1), (0,1)) to a quad,
 * in closed form (Heckbert, "Fundamentals of Texture Mapping", 1989).
 */
function squareToQuad(q: Quad): Mat3 {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = den === 0 ? 0 : (dx3 * dy2 - dx2 * dy3) / den;
  const h = den === 0 ? 0 : (dx1 * dy3 - dx3 * dy1) / den;
  return [
    p1.x - p0.x + g * p1.x,
    p3.x - p0.x + h * p3.x,
    p0.x,
    p1.y - p0.y + g * p1.y,
    p3.y - p0.y + h * p3.y,
    p0.y,
    g,
    h,
    1,
  ];
}

function multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9) as Mat3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

/** The inverse of a homography (any nonzero scale of it maps the same). */
export function invertH(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (det === 0) throw new Error('homography is singular');
  return [
    A / det,
    -(b * i - c * h) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    -(a * f - c * d) / det,
    C / det,
    -(a * h - b * g) / det,
    (a * e - b * d) / det,
  ];
}

/** The homography that maps each corner of `from` to the same corner of `to`. */
export function homography(from: Quad, to: Quad): Mat3 {
  return multiply(squareToQuad(to), invertH(squareToQuad(from)));
}

export function applyH(m: Mat3, p: Pt): Pt {
  const w = m[6] * p.x + m[7] * p.y + m[8];
  return { x: (m[0] * p.x + m[1] * p.y + m[2]) / w, y: (m[3] * p.x + m[4] * p.y + m[5]) / w };
}

const distance = (a: Pt, b: Pt) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

/** The largest distance between corresponding corners. */
export function quadShift(a: Quad, b: Quad): number {
  return Math.max(...a.map((corner, i) => distance(corner, b[i] as Pt)));
}

/**
 * The flattened page's size for a quad: the long side `longSide`, the short side in proportion,
 * floored to a multiple of `cell` (at least one cell). Each side is the mean of its two edges.
 */
export function compareSize(
  quad: Quad,
  longSide: number,
  cell: number,
): { width: number; height: number } {
  const [tl, tr, br, bl] = quad;
  const across = (distance(tl, tr) + distance(bl, br)) / 2;
  const down = (distance(tl, bl) + distance(tr, br)) / 2;
  const short = (side: number, long: number) =>
    Math.max(cell, Math.floor((longSide * side) / long / cell) * cell);
  return across >= down
    ? { width: longSide, height: short(down, across) }
    : { width: short(across, down), height: longSide };
}
