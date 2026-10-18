// Where Ada's marks go, in panel px: a target (a piece of her ink, a point or a box on the page)
// resolves through the projection and the fit, and each mark is placed from it by fixed rules,
// so the marks keep their own size at every zoom and stay on her ink as the panel resizes
// (Review Focus 3). Callouts stay inside the panel (Review Focus 4).
import {
  type PaperElements,
  type PaperMark,
  type PaperTarget,
  type Pt,
  parseElementRef,
} from '@tassel/shared/beats';
import { type Fit, type Project, toScreen } from './project';

/** A target in panel px. */
export interface Resolved {
  /**
   * Where a callout's leader, a point's or a box's step dot, and a check aim: the point itself
   * for a point; else just outside the target toward its top right (on its circle mark's ring).
   */
  anchor: Pt;
  center: Pt;
  /** A state's radius; 0 for anything else. */
  radius: number;
  /** For an edge, its path and its label. */
  bbox: { x: number; y: number; w: number; h: number };
  /** An edge's or the start arrow's path; null for a state, a point or a box. */
  path: Pt[] | null;
  /** The side of its edge the label is on, as seen on screen; null without a label. */
  labelSide: 'above' | 'below' | null;
}

/** A state's ring, × its radius. */
const RING = 1.35;
/** Anything else's ring: its box plus this on each side. */
const PAD = 14;
/** A straight edge's step dot: this far from its midpoint, away from its label. */
const DOT_OFF_EDGE = 26;
/** A self-loop's step dot: this far left of its leftmost point. */
const DOT_LEFT_OF_LOOP = 22;
/** A state's step dot: this far beyond its radius, below and left. */
const DOT_OFF_STATE = 18;
/** The same target numbered again moves its dot this far, per repeat. */
const DOT_REPEAT = 30;
/** A callout sits this far off its target's box... */
const CALLOUT_GAP = 24;
/** ...this far inside the panel... */
const CALLOUT_INSET = 14;
/** ...and below P1's top line. */
const CALLOUT_TOP = 54;
/** An arrow mark stops this far short of a state's ink or a box... */
const ARROW_CLEAR = 8;
/** ...or of an edge's midpoint. */
const ARROW_CLEAR_EDGE = 10;
/** Its open head: two strokes this long. */
const ARROW_HEAD = 10;
const ARROW_HEAD_ANGLE = Math.PI / 6;
/** A strike across an edge: this long, at 60° to it. */
const STRIKE_HALF = 22;
const EPSILON = 1e-9;

/** `target` in panel px, or null when the paper has no such piece of ink. */
export function resolveTarget(
  target: PaperTarget,
  elements: PaperElements | null,
  project: Project,
  fit: Fit,
): Resolved | null {
  if ('at' in target) {
    const p = toScreen(target.at, project, fit);
    return {
      anchor: p,
      center: p,
      radius: 0,
      bbox: { ...p, w: 0, h: 0 },
      path: null,
      labelSide: null,
    };
  }
  if ('box' in target) {
    const { x, y, w, h } = target.box;
    const corners = [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ].map((p) => toScreen(p, project, fit));
    const bbox = boundsOf(corners);
    return {
      anchor: anchorOf(bbox),
      center: centerOf(bbox),
      radius: 0,
      bbox,
      path: null,
      labelSide: null,
    };
  }
  const detected = elements?.detected;
  const item = detected?.items.find((item) => item.id === target.el);
  if (detected && item) {
    const { x, y, w, h } = item.box;
    return resolveTarget(
      {
        box: {
          x: x / detected.width,
          y: y / detected.height,
          w: w / detected.width,
          h: h / detected.height,
        },
      },
      null,
      project,
      fit,
    );
  }
  const ref = parseElementRef(target.el);
  if (!ref || !elements) return null;
  if (ref.kind === 'state') {
    // Own keys only: a state named "constructor" must not find Object's.
    if (!Object.hasOwn(elements.states, ref.id)) return null;
    const state = elements.states[ref.id];
    const center = toScreen(state.center, project, fit);
    const rim = toScreen({ x: state.center.x + state.r, y: state.center.y }, project, fit);
    const radius = Math.hypot(rim.x - center.x, rim.y - center.y);
    return {
      anchor: {
        x: center.x + RING * radius * Math.SQRT1_2,
        y: center.y - RING * radius * Math.SQRT1_2,
      },
      center,
      radius,
      bbox: { x: center.x - radius, y: center.y - radius, w: 2 * radius, h: 2 * radius },
      path: null,
      labelSide: null,
    };
  }
  const key = ref.kind === 'edge' ? `${ref.from}>${ref.to}` : null;
  const piece: { path: Pt[]; label?: Pt } | null | undefined =
    key === null ? elements.start : Object.hasOwn(elements.edges, key) ? elements.edges[key] : null;
  if (!piece || piece.path.length < 2) return null;
  const path = piece.path.map((p) => toScreen(p, project, fit));
  const label = piece.label ? toScreen(piece.label, project, fit) : null;
  const bbox = boundsOf(label ? [...path, label] : path);
  return {
    anchor: anchorOf(bbox),
    center: centerOf(bbox),
    radius: 0,
    bbox,
    path,
    labelSide: label ? sideOf(path, label) : null,
  };
}

/** True when the paper has the piece of ink `target` names; a point or a box always resolves. */
export function targetExists(target: PaperTarget, elements: PaperElements | null): boolean {
  if (!('el' in target)) return true;
  if (elements?.detected?.items.some((item) => item.id === target.el)) return true;
  const ref = parseElementRef(target.el);
  if (!ref || !elements) return false;
  if (ref.kind === 'state') return Object.hasOwn(elements.states, ref.id);
  if (ref.kind === 'start') return elements.start !== undefined;
  // Diagram refs (node:, group:) name board items, never ink on her paper.
  if (ref.kind !== 'edge') return false;
  return Object.hasOwn(elements.edges, `${ref.from}>${ref.to}`);
}

/** Every target a mark points at: an arrow's two ends, else its one target. */
export function targetsOf(mark: PaperMark): PaperTarget[] {
  return mark.type === 'arrow' ? [mark.from, mark.to] : [mark.target];
}

/** One key per target, so the same piece of ink numbered twice counts as a repeat. */
export function targetKey(target: PaperTarget): string {
  if ('el' in target) return target.el;
  if ('at' in target) return `at:${target.at.x},${target.at.y}`;
  const { x, y, w, h } = target.box;
  return `box:${x},${y},${w},${h}`;
}

/** The ring round a target: a state's at 1.35 × its radius; anything else, its box plus 14. */
export function circleFor(r: Resolved): { cx: number; cy: number; rx: number; ry: number } {
  if (r.radius > 0) {
    return { cx: r.center.x, cy: r.center.y, rx: RING * r.radius, ry: RING * r.radius };
  }
  return {
    cx: r.bbox.x + r.bbox.w / 2,
    cy: r.bbox.y + r.bbox.h / 2,
    rx: r.bbox.w / 2 + PAD,
    ry: r.bbox.h / 2 + PAD,
  };
}

/**
 * A step dot's center:
 * - on a straight edge, its midpoint moved 26 px across it, away from its label (below when it
 *   has none); repeat k moves it 30k px along the edge, from its start toward its end;
 * - on a self-loop, 22 px left of its leftmost point; repeat k, 30k px down;
 * - on a state, `center + (−0.7, 0.7) × (radius + 18)`; on a point or a box, the anchor. A
 *   repeat moves these 30k px down too.
 */
export function stepDotFor(r: Resolved, repeat: number): Pt {
  const k = Math.max(0, repeat);
  if (r.path && r.path.length >= 2) {
    if (isLoop(r.path)) {
      const left = leftmostOf(r.path);
      return { x: left.x - DOT_LEFT_OF_LOOP, y: left.y + DOT_REPEAT * k };
    }
    const { point, tangent } = midpointOf(r.path);
    const above = normalAbove(tangent);
    const away = r.labelSide === 'below' ? above : { x: -above.x, y: -above.y };
    return {
      x: point.x + away.x * DOT_OFF_EDGE + tangent.x * DOT_REPEAT * k,
      y: point.y + away.y * DOT_OFF_EDGE + tangent.y * DOT_REPEAT * k,
    };
  }
  if (r.radius > 0) {
    const d = r.radius + DOT_OFF_STATE;
    return { x: r.center.x - 0.7 * d, y: r.center.y + 0.7 * d + DOT_REPEAT * k };
  }
  return { x: r.anchor.x, y: r.anchor.y + DOT_REPEAT * k };
}

/**
 * Where a callout's pill goes in a `box`-sized panel: above and right of its target, 24 px off
 * its box; flipped left or below when it would overflow; then held 14 px inside the panel and
 * below y 54 (P1's top line). Its leader is a quadratic curve, `[start, control, end]`, from the
 * pill's edge midpoint nearest the anchor to the anchor.
 */
export function calloutFor(
  target: Resolved,
  pill: { w: number; h: number },
  box: { w: number; h: number },
): { x: number; y: number; leader: [Pt, Pt, Pt] } {
  const b = target.bbox;
  let x = b.x + b.w + CALLOUT_GAP;
  let y = b.y - CALLOUT_GAP - pill.h;
  if (x + pill.w > box.w - CALLOUT_INSET) x = b.x - CALLOUT_GAP - pill.w;
  if (y < CALLOUT_TOP) y = b.y + b.h + CALLOUT_GAP;
  x = clamp(x, CALLOUT_INSET, box.w - CALLOUT_INSET - pill.w);
  y = clamp(y, CALLOUT_TOP, box.h - CALLOUT_INSET - pill.h);

  const end = target.anchor;
  const sides = [
    { side: 'x', point: { x, y: y + pill.h / 2 } },
    { side: 'x', point: { x: x + pill.w, y: y + pill.h / 2 } },
    { side: 'y', point: { x: x + pill.w / 2, y } },
    { side: 'y', point: { x: x + pill.w / 2, y: y + pill.h } },
  ] as const;
  let start: (typeof sides)[number] = sides[0];
  for (const candidate of sides) {
    if (distance(candidate.point, end) < distance(start.point, end)) start = candidate;
  }
  // It leaves the pill square to the edge it starts from, and bends into the anchor.
  const control =
    start.side === 'x' ? { x: end.x, y: start.point.y } : { x: start.point.x, y: end.y };
  return { x, y, leader: [start.point, control, end] };
}

/**
 * An arrow mark from one target to another: its line, stopping short of a state's ink, a box or
 * an edge's midpoint, and its open head `[tip, point, tip]`. Null when the two overlap.
 */
export function arrowFor(
  from: Resolved,
  to: Resolved,
): { line: [Pt, Pt]; head: [Pt, Pt, Pt] } | null {
  const a = aimOf(from);
  const b = aimOf(to);
  const length = distance(a, b);
  if (length < EPSILON) return null;
  const u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  const startOff = clearanceOf(from, u);
  const endOff = clearanceOf(to, u);
  if (startOff + endOff + ARROW_HEAD >= length) return null;
  const start = { x: a.x + u.x * startOff, y: a.y + u.y * startOff };
  const end = { x: b.x - u.x * endOff, y: b.y - u.y * endOff };
  const tip = (angle: number) => {
    const back = rotate({ x: -u.x, y: -u.y }, angle);
    return { x: end.x + back.x * ARROW_HEAD, y: end.y + back.y * ARROW_HEAD };
  };
  return { line: [start, end], head: [tip(ARROW_HEAD_ANGLE), end, tip(-ARROW_HEAD_ANGLE)] };
}

/** A strike through a target: across a state, a slash over an edge, corner to corner on a box. */
export function strikeFor(r: Resolved): [Pt, Pt] {
  if (r.radius > 0) {
    const d = 1.15 * r.radius * Math.SQRT1_2;
    return [
      { x: r.center.x - d, y: r.center.y + d },
      { x: r.center.x + d, y: r.center.y - d },
    ];
  }
  if (r.path && r.path.length >= 2) {
    const { point, tangent } = midpointOf(r.path);
    const slash = rotate(tangent, -Math.PI / 3);
    return [
      { x: point.x - slash.x * STRIKE_HALF, y: point.y - slash.y * STRIKE_HALF },
      { x: point.x + slash.x * STRIKE_HALF, y: point.y + slash.y * STRIKE_HALF },
    ];
  }
  const { x, y, w, h } = r.bbox;
  if (w > 0 || h > 0) {
    return [
      { x, y: y + h },
      { x: x + w, y },
    ];
  }
  const d = 12 * Math.SQRT1_2;
  return [
    { x: r.center.x - d, y: r.center.y + d },
    { x: r.center.x + d, y: r.center.y - d },
  ];
}

/** A check mark at the anchor: down to its corner, then up. */
export function checkFor(r: Resolved): [Pt, Pt, Pt] {
  const { x, y } = r.anchor;
  return [
    { x: x - 8, y },
    { x: x - 2, y: y + 7 },
    { x: x + 11, y: y - 10 },
  ];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function distance(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function rotate(v: Pt, angle: number): Pt {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

function boundsOf(points: Pt[]): Resolved['bbox'] {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function centerOf(bbox: Resolved['bbox']): Pt {
  return { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 };
}

/** The top right of the ring circleFor draws round a box. */
function anchorOf(bbox: Resolved['bbox']): Pt {
  const c = centerOf(bbox);
  return {
    x: c.x + (bbox.w / 2 + PAD) * Math.SQRT1_2,
    y: c.y - (bbox.h / 2 + PAD) * Math.SQRT1_2,
  };
}

/** The point halfway along a path, and the path's direction there. */
function midpointOf(path: Pt[]): { point: Pt; tangent: Pt } {
  let left = lengthOf(path) / 2;
  // Where the last segment ends, should rounding leave a sliver of `left` at the end.
  let last = { point: path[0], tangent: { x: 1, y: 0 } };
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    const length = distance(a, b);
    if (length < EPSILON) continue;
    const tangent = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    if (left <= length) {
      const t = left / length;
      return { point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, tangent };
    }
    left -= length;
    last = { point: b, tangent };
  }
  return last;
}

function lengthOf(path: Pt[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += distance(path[i - 1], path[i]);
  return total;
}

/** A path that comes back near where it began: a self-loop, around its state. */
function isLoop(path: Pt[]): boolean {
  const total = lengthOf(path);
  return total > EPSILON && distance(path[0], path[path.length - 1]) < 0.5 * total;
}

function leftmostOf(path: Pt[]): Pt {
  return path.reduce((a, b) => (b.x < a.x ? b : a));
}

/** Of a direction's two normals, the one pointing up the screen (left, for a vertical one). */
function normalAbove(tangent: Pt): Pt {
  const n = { x: tangent.y, y: -tangent.x };
  if (n.y < -EPSILON || (Math.abs(n.y) <= EPSILON && n.x < 0)) return n;
  return { x: -n.x, y: -n.y };
}

/** Which side of a path its label is on, by the path's normal at its midpoint. */
function sideOf(path: Pt[], label: Pt): 'above' | 'below' {
  const { point, tangent } = midpointOf(path);
  const above = normalAbove(tangent);
  return (label.x - point.x) * above.x + (label.y - point.y) * above.y >= 0 ? 'above' : 'below';
}

/** The point an arrow aims at: a state's center, an edge's midpoint, a box's or a point's center. */
function aimOf(r: Resolved): Pt {
  if (r.radius > 0) return r.center;
  if (r.path && r.path.length >= 2) return midpointOf(r.path).point;
  return r.center;
}

/** How far from its aim an arrow's end stops, coming along `u`. */
function clearanceOf(r: Resolved, u: Pt): number {
  if (r.radius > 0) return r.radius + ARROW_CLEAR;
  if (r.path && r.path.length >= 2) return ARROW_CLEAR_EDGE;
  const halfW = r.bbox.w / 2;
  const halfH = r.bbox.h / 2;
  if (halfW <= 0 && halfH <= 0) return 0;
  const tx = Math.abs(u.x) > EPSILON ? halfW / Math.abs(u.x) : Number.POSITIVE_INFINITY;
  const ty = Math.abs(u.y) > EPSILON ? halfH / Math.abs(u.y) : Number.POSITIVE_INFINITY;
  return Math.min(tx, ty) + ARROW_CLEAR;
}
