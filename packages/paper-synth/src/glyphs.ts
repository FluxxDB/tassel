// Single-stroke glyphs, authored for this package (no third-party font data). Each glyph is a set
// of polylines on a 0–1 em box, y pointing down: the cap height runs from 0.05 to the baseline at
// 0.75, the x-height from 0.30, and descenders reach 0.98.
//
// The set is exactly what the clips write: the printed statement "Binary strings that start with
// 010", the state labels q0–q3 and the transition labels 0, 1 and "0,1".

import { arc, boundsOf, type Pt } from './geometry.ts';

export interface Glyph {
  /** The pen's advance after this glyph, in ems. */
  advance: number;
  strokes: Pt[][];
}

const p = (x: number, y: number): Pt => ({ x, y });
const line = (...points: Array<[number, number]>): Pt[] => points.map(([x, y]) => p(x, y));

/** A full ellipse, starting at `fromDeg` and going round the other way (counter-clockwise). */
const loop = (cx: number, cy: number, rx: number, ry: number, fromDeg: number): Pt[] =>
  arc(cx, cy, rx, ry, fromDeg, fromDeg - 360, 28);

const GLYPHS: Record<string, Glyph> = {
  B: {
    advance: 0.62,
    strokes: [
      line([0.08, 0.05], [0.08, 0.75]),
      [p(0.08, 0.05), ...arc(0.32, 0.21, 0.16, 0.16, -90, 90, 14), p(0.08, 0.37)],
      [p(0.08, 0.37), ...arc(0.34, 0.56, 0.19, 0.19, -90, 90, 16), p(0.08, 0.75)],
    ],
  },
  a: {
    advance: 0.56,
    strokes: [loop(0.26, 0.525, 0.17, 0.225, -20), line([0.44, 0.3], [0.44, 0.75])],
  },
  g: {
    advance: 0.56,
    strokes: [
      loop(0.26, 0.5, 0.17, 0.2, -20),
      [p(0.44, 0.3), p(0.44, 0.82), ...arc(0.27, 0.82, 0.17, 0.14, 0, 160, 10)],
    ],
  },
  h: {
    advance: 0.56,
    strokes: [
      line([0.08, 0.05], [0.08, 0.75]),
      [p(0.08, 0.47), ...arc(0.25, 0.47, 0.17, 0.16, 180, 360, 12), p(0.42, 0.75)],
    ],
  },
  i: {
    advance: 0.24,
    strokes: [line([0.1, 0.3], [0.1, 0.75]), line([0.1, 0.13], [0.11, 0.16])],
  },
  n: {
    advance: 0.54,
    strokes: [
      line([0.08, 0.3], [0.08, 0.75]),
      [p(0.08, 0.47), ...arc(0.25, 0.47, 0.17, 0.16, 180, 360, 12), p(0.42, 0.75)],
    ],
  },
  r: {
    advance: 0.4,
    strokes: [
      line([0.08, 0.3], [0.08, 0.75]),
      [p(0.08, 0.48), ...arc(0.24, 0.48, 0.16, 0.16, 180, 290, 8)],
    ],
  },
  s: {
    advance: 0.48,
    strokes: [
      line(
        [0.4, 0.36],
        [0.34, 0.31],
        [0.24, 0.3],
        [0.13, 0.32],
        [0.08, 0.38],
        [0.1, 0.45],
        [0.2, 0.5],
        [0.32, 0.54],
        [0.4, 0.6],
        [0.4, 0.68],
        [0.33, 0.74],
        [0.2, 0.75],
        [0.1, 0.73],
        [0.05, 0.68],
      ),
    ],
  },
  t: {
    advance: 0.38,
    strokes: [
      [p(0.16, 0.1), p(0.16, 0.66), ...arc(0.26, 0.66, 0.1, 0.09, 180, 90, 6)],
      line([0.04, 0.3], [0.32, 0.3]),
    ],
  },
  w: {
    advance: 0.74,
    strokes: [line([0.04, 0.3], [0.19, 0.75], [0.37, 0.38], [0.55, 0.75], [0.7, 0.3])],
  },
  y: {
    advance: 0.54,
    strokes: [
      line([0.06, 0.3], [0.27, 0.75]),
      line([0.48, 0.3], [0.27, 0.75], [0.19, 0.92], [0.08, 0.97]),
    ],
  },
  q: {
    advance: 0.56,
    strokes: [loop(0.26, 0.525, 0.17, 0.225, -20), line([0.44, 0.3], [0.44, 0.98])],
  },
  '0': { advance: 0.56, strokes: [arc(0.28, 0.4, 0.19, 0.35, -90, 270, 32)] },
  '1': { advance: 0.4, strokes: [line([0.08, 0.2], [0.24, 0.05], [0.24, 0.75])] },
  '2': {
    advance: 0.56,
    strokes: [[...arc(0.27, 0.25, 0.18, 0.19, 200, 380, 14), p(0.07, 0.75), p(0.48, 0.75)]],
  },
  '3': {
    advance: 0.54,
    strokes: [
      [...arc(0.25, 0.22, 0.17, 0.17, 200, 450, 16), ...arc(0.25, 0.565, 0.2, 0.185, -90, 150, 16)],
    ],
  },
  ',': { advance: 0.22, strokes: [line([0.1, 0.7], [0.12, 0.77], [0.07, 0.88])] },
  ' ': { advance: 0.32, strokes: [] },
};

/** Every character the glyph set draws. */
export const GLYPH_SET: string = Object.keys(GLYPHS).join('');

export function glyph(ch: string): Glyph {
  const g = GLYPHS[ch];
  if (!g) throw new Error(`paper-synth has no glyph for "${ch}"`);
  return g;
}

/** Extra space between glyphs, in ems. */
const TRACKING = 0.06;

export interface TextRun {
  strokes: Pt[][];
  /** The strokes' bounding box (their centerlines, without the pen's width). */
  box: { x: number; y: number; w: number; h: number };
}

/** Lays out `text` with the em box's top-left at `origin`, `em` units per em. */
export function layoutText(text: string, origin: Pt, em: number): TextRun {
  const strokes: Pt[][] = [];
  let x = origin.x;
  for (const ch of text) {
    const g = glyph(ch);
    for (const stroke of g.strokes) {
      strokes.push(stroke.map((q) => ({ x: x + q.x * em, y: origin.y + q.y * em })));
    }
    x += (g.advance + TRACKING) * em;
  }
  const b = boundsOf(strokes);
  return { strokes, box: { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 } };
}

/** Lays out `text` so its strokes' bounding box is centered on `center`. */
export function centeredText(text: string, center: Pt, em: number): TextRun {
  const run = layoutText(text, { x: 0, y: 0 }, em);
  const dx = center.x - (run.box.x + run.box.w / 2);
  const dy = center.y - (run.box.y + run.box.h / 2);
  return {
    strokes: run.strokes.map((s) => s.map((q) => ({ x: q.x + dx, y: q.y + dy }))),
    box: { x: run.box.x + dx, y: run.box.y + dy, w: run.box.w, h: run.box.h },
  };
}
