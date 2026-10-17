import { type DfaReading, EPSILON } from '@tassel/shared/vision';

export interface CardState {
  id: string;
  label: string;
  x: number;
  y: number;
  r: number;
  accept: boolean;
  start: boolean;
  uncertain: boolean;
}

export interface CardEdge {
  id: string;
  d: string;
  head: Array<[number, number]>;
  label: string;
  lx: number;
  ly: number;
  uncertain: boolean;
}

export interface CardLayout {
  width: number;
  height: number;
  states: CardState[];
  edges: CardEdge[];
  start: { d: string; head: Array<[number, number]> } | null;
  missingMoves: boolean;
}

type Point = [number, number];
interface Curve {
  command: 'L' | 'Q' | 'C';
  points: Point[];
  head: Point[];
}
interface MergedEdge {
  id: string;
  source: string;
  target: string;
  symbols: Set<string>;
  uncertain: boolean;
}

const PADDING = 20;
const RADIUS = 17;
const RANK_GAP = 92;
const ROW_GAP = 72;
const HEAD_LENGTH = 7;

/** A triangle whose tip ends on the circle, with its base perpendicular to the tangent. */
function arrowHead(tip: Point, previous: Point): Point[] {
  const dx = tip[0] - previous[0];
  const dy = tip[1] - previous[1];
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  const bx = tip[0] - HEAD_LENGTH * ux;
  const by = tip[1] - HEAD_LENGTH * uy;
  return [tip, [bx - 3.5 * uy, by + 3.5 * ux], [bx + 3.5 * uy, by - 3.5 * ux]];
}

function circleEdge(state: CardState, toward: Point): Point {
  const dx = toward[0] - state.x;
  const dy = toward[1] - state.y;
  const length = Math.hypot(dx, dy);
  return [state.x + (state.r * dx) / length, state.y + (state.r * dy) / length];
}

function path(curve: Curve, shift: (point: Point) => Point): string {
  const [first, ...rest] = curve.points.map(shift);
  return `M${first.join(' ')} ${curve.command}${rest.map((p) => p.join(' ')).join(' ')}`;
}

/** A pure layered drawing, independent of camera coordinates and problem content. */
export function layoutReading(reading: DfaReading): CardLayout {
  const uncertain = new Set(reading.uncertain);
  const ids = new Set(reading.states.map((state) => state.id));
  // Dangling arrows cannot be drawn; retaining them would invent a state the reader didn't see.
  const transitions = reading.transitions.filter((t) => ids.has(t.source) && ids.has(t.target));
  const adjacency = new Map<string, string[]>();
  for (const t of transitions) {
    if (t.source === t.target) continue;
    const neighbors = adjacency.get(t.source) ?? [];
    neighbors.push(t.target);
    adjacency.set(t.source, neighbors);
  }
  const ranks = new Map<string, { rank: number; row: number }>();
  const rows = new Map<number, number>();
  const root = reading.states.find((state) => state.start) ?? reading.states[0];
  const queue: string[] = [];
  const discover = (id: string, rank: number) => {
    const row = rows.get(rank) ?? 0;
    ranks.set(id, { rank, row });
    rows.set(rank, row + 1);
    queue.push(id);
  };
  if (root) discover(root.id, 0);
  for (let i = 0; i < queue.length; i++) {
    const source = queue[i];
    for (const target of adjacency.get(source) ?? []) {
      if (!ranks.has(target)) discover(target, (ranks.get(source)?.rank ?? 0) + 1);
    }
  }
  const lastRank = Math.max(0, ...[...ranks.values()].map(({ rank }) => rank)) + 1;
  for (const state of reading.states) {
    if (!ranks.has(state.id)) discover(state.id, lastRank);
  }
  const states: CardState[] = reading.states.map((state) => {
    const position = ranks.get(state.id);
    if (!position) throw new Error('State missing from layout ranks');
    const { rank, row } = position;
    return {
      id: state.id,
      label: state.label,
      x: PADDING + 28 + rank * RANK_GAP,
      y: PADDING + row * ROW_GAP,
      r: RADIUS,
      accept: state.accept,
      start: state.start,
      uncertain: uncertain.has(state.id),
    };
  });
  const byId = new Map(states.map((state) => [state.id, state]));
  const pair = (source: string, target: string) => JSON.stringify([source, target]);
  const merged = new Map<string, MergedEdge>();
  for (const t of transitions) {
    const key = pair(t.source, t.target);
    const edge = merged.get(key) ?? {
      id: t.id,
      source: t.source,
      target: t.target,
      symbols: new Set<string>(),
      uncertain: false,
    };
    for (const symbol of t.symbols) edge.symbols.add(symbol);
    edge.uncertain ||= uncertain.has(t.id);
    merged.set(key, edge);
  }

  const edges = [...merged.values()].map((edge) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) throw new Error('Transition missing a layout state');
    let command: Curve['command'];
    let points: Point[];
    let label: Point;
    if (source === target) {
      const { x, y, r } = source;
      command = 'C';
      points = [
        [x - 0.5 * r, y - 0.85 * r],
        [x - 1.4 * r, y - 3 * r],
        [x + 1.4 * r, y - 3 * r],
        [x + 0.5 * r, y - 0.85 * r],
      ];
      label = [x, y - 3.1 * r];
    } else if (
      target.x - source.x === RANK_GAP &&
      target.y === source.y &&
      !merged.has(pair(edge.target, edge.source))
    ) {
      command = 'L';
      points = [circleEdge(source, [target.x, target.y]), circleEdge(target, [source.x, source.y])];
      label = [(source.x + target.x) / 2, source.y - 8];
    } else {
      // The right-hand normal points up on a rightward edge and down on its reverse.
      const control: Point = [
        (source.x + target.x) / 2 + 0.35 * (target.y - source.y),
        (source.y + target.y) / 2 - 0.35 * (target.x - source.x),
      ];
      command = 'Q';
      points = [circleEdge(source, control), control, circleEdge(target, control)];
      label = control;
    }
    return {
      edge,
      label,
      command,
      points,
      head: arrowHead(points[points.length - 1], points[points.length - 2]),
    };
  });
  const startState = states.find((state) => state.start);
  let start: Curve | null = null;
  if (startState) {
    const tip: Point = [startState.x - startState.r, startState.y];
    const tail: Point = [tip[0] - 28, tip[1]];
    start = { command: 'L', points: [tail, tip], head: arrowHead(tip, tail) };
  }
  // Include controls, arrowhead corners and label anchors, not only path endpoints.
  const bounds: Point[] = states.flatMap((s) => [
    [s.x - s.r, s.y - s.r],
    [s.x + s.r, s.y + s.r],
  ]);
  for (const edge of edges) bounds.push(...edge.points, ...edge.head, edge.label);
  if (start) bounds.push(...start.points, ...start.head);
  const minX = bounds.length ? Math.min(...bounds.map(([x]) => x)) : 0;
  const minY = bounds.length ? Math.min(...bounds.map(([, y]) => y)) : 0;
  const maxX = bounds.length ? Math.max(...bounds.map(([x]) => x)) : 0;
  const maxY = bounds.length ? Math.max(...bounds.map(([, y]) => y)) : 0;
  const shift = ([x, y]: Point): Point => [x - minX + PADDING, y - minY + PADDING];
  const moves = new Map<string, Set<string>>();
  for (const t of transitions) {
    const symbols = moves.get(t.source) ?? new Set<string>();
    for (const symbol of t.symbols) symbols.add(symbol);
    moves.set(t.source, symbols);
  }
  return {
    width: maxX - minX + 2 * PADDING,
    height: maxY - minY + 2 * PADDING,
    states: states.map((s) => {
      const [x, y] = shift([s.x, s.y]);
      return { ...s, x, y };
    }),
    edges: edges.map((curve) => {
      const [lx, ly] = shift(curve.label);
      return {
        id: curve.edge.id,
        d: path(curve, shift),
        head: curve.head.map(shift),
        label: [...curve.edge.symbols].sort().join(','),
        lx,
        ly,
        uncertain: curve.edge.uncertain,
      };
    }),
    start: start ? { d: path(start, shift), head: start.head.map(shift) } : null,
    missingMoves: reading.states.some((state) =>
      reading.alphabet.some((symbol) => symbol !== EPSILON && !moves.get(state.id)?.has(symbol)),
    ),
  };
}
