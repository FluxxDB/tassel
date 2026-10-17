// Graphviz's json0 output as an AutomatonLayout. Its points are already board px (one pt each),
// but its origin is bottom-left, so y flips against `bb`, and everything moves LAYOUT_MARGIN in.
// Each edge's curve becomes a bend, which tldraw's arrows reproduce (Task 5), a label point and,
// for a self-loop, the side of its state it sits on.
import type { AutomatonSpec, Pt } from '@tassel/shared/beats';
import { mergedEdges } from '../automata/run';
import {
  type AutomatonLayout,
  type EdgeLayout,
  LAYOUT_MARGIN,
  type LoopSide,
  START_ARROW_LENGTH,
  STATE_RADIUS,
} from './types';

/** The parts of Graphviz's json0 output that the layout reads. */
export interface GraphvizJson0 {
  /** "llx,lly,urx,ury", in points. */
  bb: string;
  objects?: Array<{ name: string; pos?: string }>;
  edges?: Array<{ id?: string; tail: number; head: number; pos?: string; lp?: string }>;
}

/** A bend under this many px is drawn straight. */
const MIN_BEND = 4;
/** A bend is at most this many chords. */
const MAX_BEND = 0.6;
/** Points sampled along each cubic piece of an edge, to find the curve's middle. */
const SAMPLES = 24;

export function fromGraphvizJson(json: GraphvizJson0, spec: AutomatonSpec): AutomatonLayout {
  const [llx, lly, urx, ury] = numbers(json.bb, 4, 'bb');
  const toBoard = ({ x, y }: Pt): Pt => ({
    x: x - llx + LAYOUT_MARGIN,
    y: ury - y + LAYOUT_MARGIN,
  });

  const placed = new Map<string, Pt>();
  for (const { name, pos } of json.objects ?? []) {
    if (pos) placed.set(name, toBoard(point(pos)));
  }
  const centerOf = (name: string): Pt => {
    const center = placed.get(name);
    if (!center) throw new Error(`Graphviz placed no ${name}`);
    return center;
  };

  const states: AutomatonLayout['states'] = {};
  for (const { id } of spec.states) states[id] = { ...centerOf(id), r: STATE_RADIUS };

  const drawn = new Map((json.edges ?? []).map((edge) => [edge.id, edge]));
  const edges: Record<string, EdgeLayout> = {};
  for (const { from, to } of mergedEdges(spec)) {
    const key = `${from}>${to}`;
    const edge = drawn.get(key);
    if (!edge?.pos) throw new Error(`Graphviz drew no edge ${key}`);
    const middle = halfway(spline(edge.pos).map(toBoard));
    const label = edge.lp ? toBoard(point(edge.lp)) : middle;
    edges[key] =
      from === to
        ? { bend: 0, label, loop: sideOf(states[from], label) }
        : { bend: bendOf(states[from], states[to], middle), label, loop: null };
  }

  return {
    width: urx - llx + 2 * LAYOUT_MARGIN,
    height: ury - lly + 2 * LAYOUT_MARGIN,
    states,
    edges,
    start: startArrow(states[spec.start], centerOf('__start')),
  };
}

/** The start arrow points into the start state's edge from `tail`'s side. */
function startArrow(
  state: { x: number; y: number; r: number },
  tail: Pt,
): AutomatonLayout['start'] {
  const length = Math.hypot(tail.x - state.x, tail.y - state.y);
  const u =
    length > 0
      ? { x: (tail.x - state.x) / length, y: (tail.y - state.y) / length }
      : { x: -1, y: 0 };
  const to = { x: state.x + u.x * state.r, y: state.y + u.y * state.r };
  return {
    from: { x: to.x + u.x * START_ARROW_LENGTH, y: to.y + u.y * START_ARROW_LENGTH },
    to,
  };
}

/**
 * The middle's signed distance from the chord between the states: positive to the left of
 * tail → head on a y-down board, where the left of (dx, dy) is (dy, −dx). Clamped to MAX_BEND
 * chords; under MIN_BEND px it is 0.
 */
function bendOf(tail: Pt, head: Pt, middle: Pt): number {
  const dx = head.x - tail.x;
  const dy = head.y - tail.y;
  const chord = Math.hypot(dx, dy);
  if (chord === 0) return 0;
  const offset = ((middle.x - tail.x) * dy - (middle.y - tail.y) * dx) / chord;
  const bend = Math.max(-MAX_BEND * chord, Math.min(MAX_BEND * chord, offset));
  return Math.abs(bend) < MIN_BEND ? 0 : bend;
}

/** Which side of `center` a self-loop's label is on. */
function sideOf(center: Pt, label: Pt): LoopSide {
  const dx = label.x - center.x;
  const dy = label.y - center.y;
  if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? 'top' : 'bottom';
  return dx > 0 ? 'right' : 'left';
}

/**
 * An edge's curve from its `pos`: "[e,x,y] [s,x,y] p0 p1 …", cubic Bézier pieces sharing their
 * ends (Graphviz's splineType). The e and s end points are where the arrowheads go, not the curve.
 * Only the first spline counts, should there be several (separated by ';').
 */
function spline(pos: string): Pt[] {
  const [first = ''] = pos.split(';');
  const points = first
    .trim()
    .split(/\s+/)
    .filter((token) => token !== '' && !token.startsWith('e,') && !token.startsWith('s,'))
    .map(point);
  if (points.length === 0) throw new Error(`An edge with no points: "${pos}"`);
  return points;
}

/** The point at half the curve's length, measured along SAMPLES points per cubic piece. */
function halfway(curve: Pt[]): Pt {
  const line = sample(curve);
  const lengths = [0];
  for (let i = 1; i < line.length; i += 1) {
    lengths.push(lengths[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y));
  }
  const half = lengths[lengths.length - 1] / 2;
  for (let i = 1; i < line.length; i += 1) {
    if (lengths[i] >= half) {
      const piece = lengths[i] - lengths[i - 1];
      const t = piece > 0 ? (half - lengths[i - 1]) / piece : 0;
      return {
        x: line[i - 1].x + (line[i].x - line[i - 1].x) * t,
        y: line[i - 1].y + (line[i].y - line[i - 1].y) * t,
      };
    }
  }
  return line[0];
}

/** The curve as a polyline. Points that don't make cubic pieces are taken as one already. */
function sample(curve: Pt[]): Pt[] {
  if (curve.length < 4 || (curve.length - 1) % 3 !== 0) return curve;
  const line = [curve[0]];
  for (let i = 0; i + 3 < curve.length; i += 3) {
    const [p0, p1, p2, p3] = curve.slice(i, i + 4);
    for (let k = 1; k <= SAMPLES; k += 1) {
      const t = k / SAMPLES;
      const a = (1 - t) ** 3;
      const b = 3 * (1 - t) ** 2 * t;
      const c = 3 * (1 - t) * t ** 2;
      const d = t ** 3;
      line.push({
        x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
        y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
      });
    }
  }
  return line;
}

/** "x,y" as a point. */
function point(text: string): Pt {
  const [x, y] = numbers(text, 2, 'point');
  return { x, y };
}

/** `count` comma-separated finite numbers, or an error naming `what`. */
function numbers(text: unknown, count: number, what: string): number[] {
  const parts = typeof text === 'string' ? text.split(',') : [];
  // Number('') is 0, so an empty part has to be caught before it reads as one.
  const values = parts.map((part) => (part.trim() === '' ? Number.NaN : Number(part)));
  if (values.length !== count || !values.every(Number.isFinite)) {
    throw new Error(`Graphviz gave a bad ${what}: ${JSON.stringify(text)}`);
  }
  return values;
}
