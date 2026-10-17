// The fixture page "dfa-wrong": the demo's wrong DFA for "starts with 010", drawn where P3's
// synthetic clip draws it (P3 Task 6), on a landscape 11:8.5 page of 1100×850 frame pixels. It
// stands in for a snapshot of her paper until P3's frames arrive, so fake scripts and tests can
// freeze it with `{ kind: 'fixture', name: 'dfa-wrong' }`. Its ink and its elements come from
// one geometry, and each piece of ink carries `data-ink` ("state:q0", "edge:q0>q0", "start"), so
// E2E specs can measure Ada's marks against the ink itself.
import type { AutomatonSpec, PaperElements, Pt } from '@tassel/shared/beats';
import type { JSX } from 'react';

const W = 1100;
const H = 850;

/** In page-width units, as PaperElements keeps radii. */
const STATE_R = 0.055;
const STATE_Y = 0.55;
const STATES = [
  { id: 'q0', x: 0.18, label: 'q0' },
  { id: 'q1', x: 0.39, label: 'q1' },
  { id: 'q2', x: 0.6, label: 'q2' },
  { id: 'q3', x: 0.81, label: 'q3' },
] as const;

const INK = '#474747';
/** 0.35% of the page's width. */
const INK_WIDTH = 0.0035 * W;
const RULE = '#e4ebf3';
const MARGIN = '#f3c9cf';
const PAGE = '#fbfaf6';

/** Frame pixels. */
const R = STATE_R * W;
/** An arrow's gap to the circle it points at. */
const GAP = 8;
/** An arrowhead's strokes, and their angle to the shaft. */
const HEAD = 17;
const HEAD_ANGLE = (38 * Math.PI) / 180;
const STATE_LABEL_SIZE = 36;
const EDGE_LABEL_SIZE = 34;
/** A straight edge's label sits this far above it; a loop's, above its top. */
const EDGE_LABEL_RISE = 30;
const LOOP_LABEL_RISE = 28;

const px = (x: number, y: number): Pt => ({ x: x * W, y: y * H });
const toPage = (p: Pt): Pt => ({ x: p.x / W, y: p.y / H });
const centerOf = (id: (typeof STATES)[number]['id']): Pt => {
  const state = STATES.find((s) => s.id === id) as (typeof STATES)[number];
  return px(state.x, STATE_Y);
};

interface InkEdge {
  key: string;
  label: string;
  /** Frame pixels. */
  path: Pt[];
  d: string;
  head: Pt[];
  labelAt: Pt;
}

/** The two strokes of an arrowhead whose tip is `tip`, coming along unit `u`. */
function headAt(tip: Pt, u: Pt): Pt[] {
  const leg = (angle: number) => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const back = { x: -u.x * cos + u.y * sin, y: -u.x * sin - u.y * cos };
    return { x: tip.x + back.x * HEAD, y: tip.y + back.y * HEAD };
  };
  return [leg(HEAD_ANGLE), tip, leg(-HEAD_ANGLE)];
}

function straightEdge(from: 'q0' | 'q1' | 'q2', to: 'q1' | 'q2' | 'q3', label: string): InkEdge {
  const a = centerOf(from);
  const b = centerOf(to);
  const start = { x: a.x + R + GAP, y: a.y };
  const end = { x: b.x - R - GAP, y: b.y };
  return {
    key: `${from}>${to}`,
    label,
    path: [start, end],
    d: `M${start.x} ${start.y}H${end.x}`,
    head: headAt(end, { x: 1, y: 0 }),
    labelAt: { x: (start.x + end.x) / 2, y: start.y - EDGE_LABEL_RISE },
  };
}

/** A self-loop over a state: a cubic from its left shoulder, over the top, into its right. */
function selfLoop(id: 'q0' | 'q3', label: string): InkEdge {
  const c = centerOf(id);
  const reach = R + GAP - 2;
  const lean = (28 * Math.PI) / 180;
  const p0 = { x: c.x - reach * Math.sin(lean), y: c.y - reach * Math.cos(lean) };
  const p1 = { x: c.x - 1.06 * R, y: c.y - 2.59 * R };
  const p2 = { x: c.x + 1.06 * R, y: c.y - 2.59 * R };
  const p3 = { x: c.x + reach * Math.sin(lean), y: c.y - reach * Math.cos(lean) };
  const at = (t: number): Pt => {
    const s = 1 - t;
    return {
      x: s * s * s * p0.x + 3 * s * s * t * p1.x + 3 * s * t * t * p2.x + t * t * t * p3.x,
      y: s * s * s * p0.y + 3 * s * s * t * p1.y + 3 * s * t * t * p2.y + t * t * t * p3.y,
    };
  };
  // Sampled finely enough that the samples' box is the curve's to a fraction of a pixel.
  const path = Array.from({ length: 33 }, (_, i) => at(i / 32));
  const top = Math.min(...path.map((p) => p.y));
  const into = { x: p3.x - p2.x, y: p3.y - p2.y };
  const length = Math.hypot(into.x, into.y);
  return {
    key: `${id}>${id}`,
    label,
    path,
    d: `M${p0.x} ${p0.y}C${p1.x} ${p1.y} ${p2.x} ${p2.y} ${p3.x} ${p3.y}`,
    head: headAt(p3, { x: into.x / length, y: into.y / length }),
    labelAt: { x: c.x, y: top - LOOP_LABEL_RISE },
  };
}

const START_FROM = px(0.08, STATE_Y);
const START_TO = { x: centerOf('q0').x - R - GAP, y: START_FROM.y };

const EDGES: InkEdge[] = [
  selfLoop('q0', '1'),
  straightEdge('q0', 'q1', '0'),
  straightEdge('q1', 'q2', '1'),
  straightEdge('q2', 'q3', '0'),
  selfLoop('q3', '0,1'),
];

/** The fixture page: its size in frame pixels, the automaton on it, and where its ink is. */
export const FIXTURE_DFA_WRONG: {
  w: 1100;
  h: 850;
  spec: AutomatonSpec;
  elements: PaperElements;
} = {
  w: W,
  h: H,
  spec: {
    kind: 'dfa',
    states: [{ id: 'q0' }, { id: 'q1' }, { id: 'q2' }, { id: 'q3', accept: true }],
    start: 'q0',
    transitions: [
      { from: 'q0', to: 'q0', symbols: ['1'] },
      { from: 'q0', to: 'q1', symbols: ['0'] },
      { from: 'q1', to: 'q2', symbols: ['1'] },
      { from: 'q2', to: 'q3', symbols: ['0'] },
      { from: 'q3', to: 'q3', symbols: ['0', '1'] },
    ],
  },
  elements: {
    states: Object.fromEntries(
      STATES.map((s) => [s.id, { center: { x: s.x, y: STATE_Y }, r: STATE_R }]),
    ),
    edges: Object.fromEntries(
      EDGES.map((e) => [e.key, { path: e.path.map(toPage), label: toPage(e.labelAt) }]),
    ),
    start: { path: [toPage(START_FROM), toPage(START_TO)] },
  },
};

const polyline = (points: Pt[]) => points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('');

/** Ruled every 1/20 of the page's height from 18% down. */
const RULED_AT = Array.from({ length: 17 }, (_, k) => (0.18 + 0.05 * k) * H);

/** The page as an inline SVG, 1100×850 in its own units; the layer scales it to fit. */
export function FixturePaper(): JSX.Element {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="100%"
      aria-hidden="true"
      focusable="false"
      className="block"
    >
      <rect width={W} height={H} fill={PAGE} />
      <path d={RULED_AT.map((y) => `M0 ${y}H${W}`).join('')} stroke={RULE} strokeWidth={1.5} />
      <path d={`M${0.07 * W} 0V${H}`} stroke={MARGIN} strokeWidth={2} />
      <g
        fill="none"
        stroke={INK}
        strokeWidth={INK_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <g data-ink="start">
          <path d={`M${START_FROM.x} ${START_FROM.y}H${START_TO.x}`} />
          <path d={polyline(headAt(START_TO, { x: 1, y: 0 }))} />
        </g>
        {STATES.map((s) => {
          const c = centerOf(s.id);
          return (
            <g key={s.id} data-ink={`state:${s.id}`}>
              <circle cx={c.x} cy={c.y} r={R} />
              {s.id === 'q3' && <circle cx={c.x} cy={c.y} r={0.8 * R} />}
              <text
                x={c.x}
                y={c.y}
                fill={INK}
                stroke="none"
                fontSize={STATE_LABEL_SIZE}
                textAnchor="middle"
                dominantBaseline="central"
                className="font-sans"
              >
                {s.label}
              </text>
            </g>
          );
        })}
        {EDGES.map((e) => (
          <g key={e.key} data-ink={`edge:${e.key}`}>
            <path d={e.d} />
            <path d={polyline(e.head)} />
          </g>
        ))}
      </g>
      {/* Labels are ink of their own: an edge's box is its stroke and head. */}
      {EDGES.map((e) => (
        <text
          key={e.key}
          data-ink-label={`edge:${e.key}`}
          x={e.labelAt.x}
          y={e.labelAt.y}
          fill={INK}
          fontSize={EDGE_LABEL_SIZE}
          textAnchor="middle"
          dominantBaseline="central"
          className="font-sans"
        >
          {e.label}
        </text>
      ))}
    </svg>
  );
}
