// A layout without Graphviz, for when its worker fails or times out (Task 5), to the same
// contract: the states on one row in spec order, SPACING px apart, with the start arrow on the
// start state's left and self-loops on top. An edge between neighbors is straight; a longer one
// bends BEND px to its left, which is above the row going forward and below it going back. The
// two edges of a pair between neighbors bend too, so they aren't drawn on top of each other
// (ruling P5-R2).
import type { AutomatonSpec, StateId } from '@tassel/shared/beats';
import { mergedEdges } from '../automata/run';
import {
  type AutomatonLayout,
  type EdgeLayout,
  LAYOUT_MARGIN,
  START_ARROW_LENGTH,
  STATE_RADIUS,
} from './types';

const SPACING = 112;
const BEND = 40;
/** How far out from its line or curve an edge's label sits. */
const LABEL_GAP = 12;
/** How far above its state's center a self-loop's label sits, about where Graphviz puts it. */
const LOOP_LABEL_RISE = 76;
/** Room for half a label's height, so every label stays inside the box. */
const LABEL_HALF = 10;

export function fallbackLayout(spec: AutomatonSpec): AutomatonLayout {
  const r = STATE_RADIUS;
  const edges = mergedEdges(spec);
  const place = new Map(spec.states.map(({ id }, i) => [id, i]));
  const pairs = new Set(edges.map(({ from, to }) => `${from}>${to}`));
  const indexOf = (id: StateId) => place.get(id) ?? 0;
  const bendOf = (from: StateId, to: StateId) =>
    Math.abs(indexOf(from) - indexOf(to)) === 1 && !pairs.has(`${to}>${from}`) ? 0 : BEND;

  const bent = edges.filter(({ from, to }) => from !== to && bendOf(from, to) !== 0);
  const arcRoom = BEND + LABEL_GAP + LABEL_HALF;
  const top = Math.max(
    r,
    edges.some(({ from, to }) => from === to) ? LOOP_LABEL_RISE + LABEL_HALF : 0,
    bent.some(({ from, to }) => indexOf(from) < indexOf(to)) ? arcRoom : 0,
  );
  const bottom = Math.max(
    r,
    bent.some(({ from, to }) => indexOf(from) > indexOf(to)) ? arcRoom : 0,
  );

  const row = LAYOUT_MARGIN + top;
  const first = LAYOUT_MARGIN + START_ARROW_LENGTH + r;
  const states: AutomatonLayout['states'] = {};
  for (const [i, { id }] of spec.states.entries()) {
    states[id] = { x: first + SPACING * i, y: row, r };
  }

  const laid: Record<string, EdgeLayout> = {};
  for (const { from, to } of edges) {
    const tail = states[from];
    const head = states[to];
    if (from === to) {
      laid[`${from}>${to}`] = {
        bend: 0,
        label: { x: tail.x, y: tail.y - LOOP_LABEL_RISE },
        loop: 'top',
      };
      continue;
    }
    const bend = bendOf(from, to);
    const chord = Math.hypot(head.x - tail.x, head.y - tail.y);
    // The left of tail → head on a y-down board.
    const left = { x: (head.y - tail.y) / chord, y: -(head.x - tail.x) / chord };
    const out = bend + LABEL_GAP;
    laid[`${from}>${to}`] = {
      bend,
      label: { x: (tail.x + head.x) / 2 + left.x * out, y: (tail.y + head.y) / 2 + left.y * out },
      loop: null,
    };
  }

  const start = states[spec.start];
  const to = { x: start.x - r, y: start.y };
  const last = first + SPACING * Math.max(0, spec.states.length - 1);
  return {
    width: last + r + LAYOUT_MARGIN,
    height: row + bottom + LAYOUT_MARGIN,
    states,
    edges: laid,
    start: { from: { x: to.x - START_ARROW_LENGTH, y: to.y }, to },
  };
}
