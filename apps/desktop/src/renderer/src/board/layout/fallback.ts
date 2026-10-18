// A layout without Graphviz, for when its worker fails or times out (Task 5), to the same
// contract: the states on one row in spec order, SPACING px apart, with the start arrow on the
// start state's left and self-loops on top. An edge between neighbors is straight; a longer one
// bends BEND px to its left, which is above the row going forward and below it going back. The
// two edges of a pair between neighbors bend too, so they aren't drawn on top of each other
// (ruling P5-R2).
import type { AutomatonSpec, DiagramNode, DiagramSpec, StateId } from '@tassel/shared/beats';
import { mergedEdges } from '../automata/run';
import { diagramEdges } from '../scene/diagram';
import {
  type AutomatonLayout,
  type DiagramLayout,
  type DiagramSizes,
  type EdgeLayout,
  LAYOUT_MARGIN,
  type LayoutBox,
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

/** Between a diagram's bands along its direction, and between the nodes of one band. */
const BAND_GAP = 56;
const NODE_GAP = 20;
/** A group's frame around its nodes, below its label block. */
const FRAME_PAD = 12;

interface Band {
  group: StateId | null;
  nodes: DiagramNode[];
  /** Where it goes along the direction: its nodes' first rank, then its first node's place. */
  rank: number;
  first: number;
}

/**
 * A diagram without Graphviz, to the same contract, on a grid: its bands run along its direction,
 * left to right for LR and top to bottom for TB, each group one band in its frame (its label
 * block on top) and each rank of ungrouped nodes another. A node's rank is its longest path of
 * edges in from a node with none. Inside a band its nodes stack across the direction, in spec
 * order, and every edge is straight.
 */
export function fallbackDiagramLayout(spec: DiagramSpec, sizes: DiagramSizes): DiagramLayout {
  const lr = spec.direction === 'LR';
  const edges = diagramEdges(spec);
  const rank = new Map(spec.nodes.map(({ id }) => [id, 0]));
  // Longest paths, bounded by the node count so a cycle can't run forever.
  for (let pass = 0; pass < spec.nodes.length; pass += 1) {
    let moved = false;
    for (const { from, to } of edges) {
      const next = (rank.get(from) ?? 0) + 1;
      if (next > (rank.get(to) ?? 0) && next < spec.nodes.length) {
        rank.set(to, next);
        moved = true;
      }
    }
    if (!moved) break;
  }

  const bands = new Map<string, Band>();
  for (const [index, node] of spec.nodes.entries()) {
    const key = node.group === undefined ? `rank ${rank.get(node.id)}` : `group ${node.group}`;
    const band = bands.get(key) ?? {
      group: node.group ?? null,
      nodes: [],
      rank: Number.POSITIVE_INFINITY,
      first: index,
    };
    band.nodes.push(node);
    band.rank = Math.min(band.rank, rank.get(node.id) ?? 0);
    bands.set(key, band);
  }
  // An empty group still gets its frame, after the rest.
  for (const { id } of spec.groups) {
    if (!bands.has(`group ${id}`)) {
      bands.set(`group ${id}`, {
        group: id,
        nodes: [],
        rank: spec.nodes.length,
        first: spec.nodes.length,
      });
    }
  }
  const ordered = [...bands.values()].sort((a, b) => a.rank - b.rank || a.first - b.first);

  // Each band's nodes and frame, from its own top-left; along is the direction, across the other.
  const laid = ordered.map((band) => {
    const label = band.group === null ? null : sizes.groups[band.group];
    const inset = label
      ? { top: Math.max(label.h, FRAME_PAD), side: FRAME_PAD }
      : { top: 0, side: 0 };
    const boxes: Array<[StateId, LayoutBox]> = [];
    let cursor = 0;
    let thickness = 0;
    for (const node of band.nodes) {
      const { w, h } = sizes.nodes[node.id];
      boxes.push([node.id, lr ? { x: 0, y: cursor, w, h } : { x: cursor, y: 0, w, h }]);
      cursor += (lr ? h : w) + NODE_GAP;
      thickness = Math.max(thickness, lr ? w : h);
    }
    const span = Math.max(0, cursor - NODE_GAP);
    let w = lr ? thickness : span;
    let h = lr ? span : thickness;
    if (label) {
      w = Math.max(label.w, w + 2 * inset.side);
      h = h + inset.top + FRAME_PAD;
    }
    // Centered in the band across the direction: x for LR's columns, y for TB's rows.
    for (const [, box] of boxes) {
      if (lr) box.x = (w - box.w) / 2;
      else box.y = (label ? inset.top : 0) + (thickness - box.h) / 2;
      if (lr && label) box.y += inset.top;
      if (!lr && label) box.x += inset.side + Math.max(0, (w - 2 * inset.side - span) / 2);
    }
    return { band, boxes, w, h };
  });

  const across = Math.max(0, ...laid.map(({ w, h }) => (lr ? h : w)));
  const nodes: DiagramLayout['nodes'] = {};
  const groups: DiagramLayout['groups'] = {};
  let along = LAYOUT_MARGIN;
  for (const { band, boxes, w, h } of laid) {
    const x = lr ? along : LAYOUT_MARGIN + (across - w) / 2;
    const y = lr ? LAYOUT_MARGIN + (across - h) / 2 : along;
    for (const [id, box] of boxes) nodes[id] = { ...box, x: x + box.x, y: y + box.y };
    if (band.group !== null) groups[band.group] = { x, y, w, h };
    along += (lr ? w : h) + BAND_GAP;
  }
  const length = along - BAND_GAP + LAYOUT_MARGIN;
  return {
    kind: 'diagram',
    width: lr ? length : across + 2 * LAYOUT_MARGIN,
    height: lr ? across + 2 * LAYOUT_MARGIN : length,
    nodes,
    groups,
    edges: Object.fromEntries(edges.map(({ from, to }) => [`${from}>${to}`, { bend: 0 }])),
  };
}
