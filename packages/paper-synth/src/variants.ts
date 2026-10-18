// The clips: the demo DFA's layout, the handwriting that draws it, and each variant's script.
// Times are milliseconds; page geometry is in page widths (see geometry.ts).

import {
  arc,
  boundsOf,
  cos,
  distance,
  type NormRect,
  PAGE_ASPECT,
  PAGE_HEIGHT_FRACTION,
  type Pt,
  sin,
  toRadians,
} from './geometry.ts';
import { centeredText, layoutText } from './glyphs.ts';
import { mulberry32, seedOf } from './rng.ts';
import {
  type Clip,
  type ClipTruth,
  clipOf,
  cumulative,
  type Eraser,
  type ExpectedTrigger,
  type HandKey,
  type OffsetKey,
  PREDRAWN,
  type Rgb,
  type Scene,
  type Shadow,
  type Sheet,
  type Stroke,
  type VariantName,
} from './scene.ts';

export const VARIANTS: readonly VariantName[] = [
  'dfa-demo',
  'dfa-short',
  'hand-rests',
  'starts-with-hand',
  'shadow-pass',
  'exposure-step',
  'page-shift',
  'slide-and-hold',
  'page-flip',
  'erase',
  'slow-drift',
  'printed-box',
  'dark-desk',
  'bold-pen',
  'nudge-while-writing',
];

const A = PAGE_ASPECT;

const DESK: Rgb = [0xcd, 0xc4, 0xb6];
const DARK_DESK: Rgb = [0x5a, 0x46, 0x36];
const HANDWRITING: Rgb = [0x47, 0x47, 0x47];
const FELT_TIP: Rgb = [0x26, 0x26, 0x26];
const PRINTED_BOX: Rgb = [0x5c, 0x5c, 0x5c];

/** Pen widths and the handwriting's wobble, in page widths. */
const PEN_WIDTH = 0.0035;
/** A felt-tip: about 5 px on an 800 px compare page. */
const BOLD_WIDTH = 0.00625;
const PRINT_WIDTH = 0.0022;
const JITTER = 0.0015;
/** The wobble changes direction about every 2% of the page width along a stroke. */
const JITTER_SPAN = 0.02;
const RESAMPLE = 0.004;

/** The printed statement: cap height 3.5% of the page height, at page (0.10, 0.10). */
const STATEMENT = 'Binary strings that start with 010';
const PRINT_EM = (0.035 * A) / 0.7;

/** States: radius 0.055 of the page width, at y 0.55 of the page height. */
const RADIUS = 0.055;
const INNER = 0.8;
const STATE_Y = 0.55 * A;
const STATE_X: Record<string, number> = { q0: 0.18, q1: 0.39, q2: 0.6, q3: 0.81 };
const LABEL_EM = 0.042;
/** Gap between a circle and an arrow's end, and between an arrow and its label. */
const GAP = 0.008;
const LABEL_GAP = 0.012;
const HEAD = 0.016;
const LOOP_RADIUS = 0.032;
const LOOP_FROM_DEG = 140;
const LOOP_TO_DEG = 400;

/** Where the hand comes from and goes: past the frame's bottom-right corner. */
const OFF_FRAME = { x: 1.3, y: 1.35 };
/** Moving between strokes with the pen up is this much faster than drawing. */
const TRAVEL = 0.6;
/** The page shifts by 60 px of a 960 × 720 frame: 60/720 of the frame height. */
const SHIFT = 60 / 720;

const at = (u: number, v: number): Pt => ({ x: u, y: v * A });

interface Shape {
  strokes: Pt[][];
  state?: ClipTruth['dfa']['states'][number];
  transition?: Omit<ClipTruth['dfa']['transitions'][number], 'labelAt'> & { labelCenter: Pt };
}

const circle = (cx: number, cy: number, r: number) => arc(cx, cy, r, r, -100, 270, 64);

function arrowHead(tip: Pt, dx: number, dy: number): Pt[] {
  const barb = (deg: number) => {
    const a = toRadians(deg);
    const rx = dx * cos(a) - dy * sin(a);
    const ry = dx * sin(a) + dy * cos(a);
    return { x: tip.x - HEAD * rx, y: tip.y - HEAD * ry };
  };
  return [barb(28), tip, barb(-28)];
}

/** A label whose strokes' box sits `gap` above `y`, centered on x. */
function labelAbove(text: string, x: number, y: number) {
  const h = layoutText(text, { x: 0, y: 0 }, LABEL_EM).box.h;
  return centeredText(text, { x, y: y - LABEL_GAP - h / 2 }, LABEL_EM);
}

function stateCircles(id: string): Shape {
  const x = STATE_X[id] as number;
  const accept = id === 'q3';
  return {
    strokes: [circle(x, STATE_Y, RADIUS), ...(accept ? [circle(x, STATE_Y, RADIUS * INNER)] : [])],
    state: { id, center: { x, y: STATE_Y / A }, radius: RADIUS, accept, start: id === 'q0' },
  };
}

const stateLabel = (id: string): Shape => ({
  strokes: centeredText(id, { x: STATE_X[id] as number, y: STATE_Y }, LABEL_EM).strokes,
});

/** A state: its circle (two for q3, the accepting state) and its label inside. */
function stateShape(id: string): Shape {
  const circles = stateCircles(id);
  return { ...circles, strokes: [...circles.strokes, ...stateLabel(id).strokes] };
}

function startShape(): Shape {
  const tip = { x: (STATE_X.q0 as number) - RADIUS - GAP, y: STATE_Y };
  return { strokes: [[{ x: 0.08, y: STATE_Y }, tip], arrowHead(tip, 1, 0)] };
}

function edgeShape(from: string, to: string, label: string): Shape {
  const x0 = (STATE_X[from] as number) + RADIUS + GAP;
  const tip = { x: (STATE_X[to] as number) - RADIUS - GAP, y: STATE_Y };
  const text = labelAbove(label, (x0 + tip.x) / 2, STATE_Y);
  return {
    strokes: [[{ x: x0, y: STATE_Y }, tip], arrowHead(tip, 1, 0), ...text.strokes],
    transition: { from, to, label, labelCenter: centerOf(text.box) },
  };
}

/** A self-loop over a state: an arc that leaves and re-enters the circle, an arrowhead, a label. */
function loopShape(id: string, label: string): Shape {
  const x = STATE_X[id] as number;
  const start = toRadians(LOOP_FROM_DEG);
  // Put the loop's center where its arc meets the state circle at exactly LOOP_FROM_DEG.
  const across = LOOP_RADIUS * cos(start);
  const lift = LOOP_RADIUS * sin(start) + Math.sqrt(RADIUS * RADIUS - across * across);
  const cy = STATE_Y - lift;
  const path = arc(x, cy, LOOP_RADIUS, LOOP_RADIUS, LOOP_FROM_DEG, LOOP_TO_DEG, 40);
  const end = toRadians(LOOP_TO_DEG);
  const tip = path[path.length - 1] as Pt;
  const text = labelAbove(label, x, cy - LOOP_RADIUS);
  return {
    strokes: [path, arrowHead(tip, -sin(end), cos(end)), ...text.strokes],
    transition: { from: id, to: id, label, labelCenter: centerOf(text.box) },
  };
}

const centerOf = (b: { x: number; y: number; w: number; h: number }): Pt => ({
  x: b.x + b.w / 2,
  y: b.y + b.h / 2,
});

function resample(points: Pt[], step: number): Pt[] {
  const out: Pt[] = [points[0] as Pt];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Pt;
    const b = points[i] as Pt;
    const n = Math.max(1, Math.ceil(distance(a, b) / step));
    for (let k = 1; k <= n; k++)
      out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

/** The hand's wobble: a seeded offset every JITTER_SPAN along each stroke, interpolated. */
function handwrite(strokes: Pt[][], group: string): Pt[][] {
  const rand = mulberry32(seedOf(`jitter:${group}`));
  return strokes.map((stroke) => {
    const points = resample(stroke, RESAMPLE);
    const cum = cumulative(points);
    const total = cum[cum.length - 1] as number;
    const spans = Math.max(1, Math.ceil(total / JITTER_SPAN));
    const offsets = Array.from({ length: spans + 1 }, () => ({
      x: (rand() * 2 - 1) * JITTER,
      y: (rand() * 2 - 1) * JITTER,
    }));
    return points.map((p, i) => {
      const s = total > 0 ? ((cum[i] as number) / total) * spans : 0;
      const k = Math.min(spans - 1, Math.floor(s));
      const f = s - k;
      const a = offsets[k] as Pt;
      const b = offsets[k + 1] as Pt;
      return { x: p.x + a.x + (b.x - a.x) * f, y: p.y + a.y + (b.y - a.y) * f };
    });
  });
}

/** A group's box in page coordinates: its strokes' bounds, widened by half the pen. */
function boxOf(strokes: Pt[][], width: number): NormRect {
  const b = boundsOf(strokes);
  const half = width / 2;
  return {
    x: b.x0 - half,
    y: (b.y0 - half) / A,
    w: b.x1 - b.x0 + width,
    h: (b.y1 - b.y0 + width) / A,
  };
}

function printedStatement(): Stroke[] {
  const run = layoutText(STATEMENT, { x: 0.1, y: 0.1 * A - 0.05 * PRINT_EM }, PRINT_EM);
  return run.strokes.map((points) => ({
    group: 'print',
    points,
    cum: cumulative(points),
    width: PRINT_WIDTH,
    t0: PREDRAWN,
    t1: PREDRAWN,
  }));
}

const freshSheet = (fromMs: number, offsets: OffsetKey[]): Sheet => ({
  printed: printedStatement(),
  boxes: [],
  fromMs,
  offsets,
});

type HandInterval = ClipTruth['hand'][number];

class Script {
  readonly strokes: Stroke[] = [];
  readonly erasers: Eraser[] = [];
  readonly sessions: HandKey[][] = [];
  readonly groups: ClipTruth['groups'] = [];
  readonly states: ClipTruth['dfa']['states'] = [];
  readonly transitions: ClipTruth['dfa']['transitions'] = [];
  readonly hand: HandInterval[] = [];
  readonly expected: ExpectedTrigger[] = [];
  heightFraction = PAGE_HEIGHT_FRACTION;
  desk: Rgb = DESK;
  ink: Rgb = HANDWRITING;
  penWidth = PEN_WIDTH;
  sheets: Sheet[] = [freshSheet(0, [{ t: 0, dx: 0, dy: 0 }])];
  shadow: Shadow | null = null;
  brightnessAt: (tMs: number) => number = () => 1;

  readonly name: VariantName;
  readonly durationMs: number;

  constructor(name: VariantName, durationMs: number) {
    this.name = name;
    this.durationMs = durationMs;
  }

  with(change: (script: this) => void): this {
    change(this);
    return this;
  }

  addGroup(id: string, shape: Shape, t0: number, t1: number): Stroke[] {
    const pts = handwrite(shape.strokes, id);
    const strokes = pts.map((points) => ({
      group: id,
      points,
      cum: cumulative(points),
      width: this.penWidth,
      t0,
      t1,
    }));
    this.strokes.push(...strokes);
    const predrawn = t0 === PREDRAWN;
    this.groups.push({
      id,
      startMs: predrawn ? 0 : t0,
      endMs: predrawn ? 0 : t1,
      bbox: boxOf(pts, this.penWidth),
    });
    if (shape.state) this.states.push(shape.state);
    if (shape.transition) {
      const { labelCenter, ...rest } = shape.transition;
      this.transitions.push({ ...rest, labelAt: { x: labelCenter.x, y: labelCenter.y / A } });
    }
    return strokes;
  }

  /** Ink already on the page when the clip starts. */
  predraw(id: string, shape: Shape): this {
    this.addGroup(id, shape, PREDRAWN, PREDRAWN);
    return this;
  }

  /** One visit of the hand: it enters from past the corner (unless it starts on the page). */
  session(opts: { enter?: number; leave: number }, body: (s: Session) => void): this {
    const s = new Session(this);
    body(s);
    const segments = s.segments;
    const first = segments[0];
    const last = segments[segments.length - 1];
    if (!first || !last) throw new Error(`${this.name}: a session needs a segment`);
    const keys: HandKey[] = [];
    if (opts.enter !== undefined) keys.push({ t: opts.enter, anchor: 'frame', ...OFF_FRAME });
    keys.push(...s.keys, { t: opts.leave, anchor: 'frame', ...OFF_FRAME });
    for (let i = 1; i < keys.length; i++) {
      if ((keys[i] as HandKey).t <= (keys[i - 1] as HandKey).t) {
        throw new Error(`${this.name}: hand keyframes out of order at ${(keys[i] as HandKey).t}`);
      }
    }
    this.sessions.push(keys);
    const intervals: HandInterval[] = [];
    if (opts.enter !== undefined) {
      intervals.push({ fromMs: opts.enter, toMs: first.t0, onPage: false, moving: true });
    }
    segments.forEach((seg, i) => {
      const before = segments[i - 1];
      if (before && seg.t0 > before.t1) {
        intervals.push({ fromMs: before.t1, toMs: seg.t0, onPage: true, moving: true });
      }
      intervals.push({ fromMs: seg.t0, toMs: seg.t1, onPage: true, moving: seg.moving });
    });
    intervals.push({ fromMs: last.t1, toMs: opts.leave, onPage: false, moving: true });
    for (const interval of intervals) {
      const prev = this.hand[this.hand.length - 1];
      if (
        prev &&
        prev.toMs === interval.fromMs &&
        prev.onPage === interval.onPage &&
        prev.moving === interval.moving
      ) {
        prev.toMs = interval.toMs;
      } else {
        this.hand.push({ ...interval });
      }
    }
    return this;
  }

  expect(reason: 'ink' | 'page', atMs: number, groups: string[] = []): this {
    this.expected.push({ reason, atMs, toleranceMs: 700, groups });
    return this;
  }

  build(): Clip {
    const strokes = [...this.strokes].sort((a, b) => a.t1 - b.t1);
    const scene: Scene = {
      name: this.name,
      durationMs: this.durationMs,
      heightFraction: this.heightFraction,
      desk: this.desk,
      ink: this.ink,
      sheets: this.sheets,
      strokes,
      erasers: this.erasers,
      sessions: this.sessions,
      shadow: this.shadow,
      brightnessAt: this.brightnessAt,
      truth: {
        dfa: { states: this.states, transitions: this.transitions },
        groups: this.groups,
        hand: this.hand,
        expectedTriggers: this.expected,
      },
    };
    return clipOf(scene);
  }
}

class Session {
  readonly keys: HandKey[] = [];
  readonly segments: Array<{ t0: number; t1: number; moving: boolean }> = [];

  private readonly script: Script;

  constructor(script: Script) {
    this.script = script;
  }

  private key(t: number, anchor: HandKey['anchor'], p: Pt) {
    const last = this.keys[this.keys.length - 1];
    // A segment that starts where the last one ended, at the same time, adds nothing.
    if (last && last.t === t && last.anchor === anchor && last.x === p.x && last.y === p.y) return;
    this.keys.push({ t, anchor, x: p.x, y: p.y });
  }

  /** Draws a group between t0 and t1 at constant speed, lifting the pen between strokes. */
  draw(id: string, shape: Shape, t0: number, t1: number): this {
    const strokes = this.script.addGroup(id, shape, t0, t1);
    this.follow(strokes, t0, t1);
    this.segments.push({ t0, t1, moving: true });
    return this;
  }

  private follow(strokes: Array<Stroke | Eraser>, t0: number, t1: number) {
    const lengths = strokes.map((s) => s.cum[s.cum.length - 1] as number);
    const travels = strokes.map((s, i) => {
      const next = strokes[i + 1];
      return next
        ? TRAVEL * distance(s.points[s.points.length - 1] as Pt, next.points[0] as Pt)
        : 0;
    });
    const total = lengths.reduce((a, b) => a + b, 0) + travels.reduce((a, b) => a + b, 0);
    const rate = (t1 - t0) / total;
    let t = t0;
    strokes.forEach((s, i) => {
      s.t0 = t;
      s.t1 = i === strokes.length - 1 ? t1 : t + (lengths[i] as number) * rate;
      const length = lengths[i] as number;
      s.points.forEach((p, j) => {
        this.key(s.t0 + ((s.t1 - s.t0) * (s.cum[j] as number)) / length, 0, p);
      });
      t = s.t1 + (travels[i] as number) * rate;
    });
  }

  /** The hand lies still on the first sheet, with the pen tip at `p`. */
  rest(t0: number, t1: number, p: Pt): this {
    this.key(t0, 0, p);
    this.key(t1, 0, p);
    this.segments.push({ t0, t1, moving: false });
    return this;
  }

  /** The hand holds the first sheet at `p` while the sheet slides. */
  slide(t0: number, t1: number, p: Pt): this {
    this.key(t0, 0, p);
    this.key(t1, 0, p);
    this.segments.push({ t0, t1, moving: true });
    return this;
  }

  /** The hand carries another sheet, holding it at `p`. */
  carry(t0: number, t1: number, p: Pt, sheet: number): this {
    this.key(t0, sheet, p);
    this.key(t1, sheet, p);
    this.segments.push({ t0, t1, moving: true });
    return this;
  }

  /** Erases a group's ink with back-and-forth passes over its box. */
  erase(id: string, target: string, t0: number, t1: number): this {
    const ink = this.script.strokes.filter((s) => s.group === target);
    const b = boundsOf(ink.map((s) => s.points));
    // Half a pen width out to the ink's edge, and half again to spare.
    const pen = ink[0]?.width ?? PEN_WIDTH;
    const width = 0.01;
    const box = { x0: b.x0 - pen, y0: b.y0 - pen, x1: b.x1 + pen, y1: b.y1 + pen };
    const rows = Math.max(1, Math.ceil((box.y1 - box.y0) / (width * 0.6)));
    const points: Pt[] = [];
    for (let r = 0; r <= rows; r++) {
      const y = box.y0 + ((box.y1 - box.y0) * r) / rows;
      const [from, to] = r % 2 === 0 ? [box.x0, box.x1] : [box.x1, box.x0];
      points.push({ x: from, y }, { x: to, y });
    }
    const eraser: Eraser = { group: id, points, cum: cumulative(points), width, t0, t1 };
    this.script.erasers.push(eraser);
    this.follow([eraser], t0, t1);
    const target_ = this.script.groups.find((g) => g.id === target);
    if (!target_) throw new Error(`no group ${target} to erase`);
    this.script.groups.push({ id, startMs: t0, endMs: t1, bbox: target_.bbox });
    this.segments.push({ t0, t1, moving: true });
    return this;
  }
}

const builders: Record<VariantName, () => Clip> = {
  'dfa-demo': () =>
    new Script('dfa-demo', 56000)
      .session({ enter: 5600, leave: 23700 }, (s) =>
        s
          .draw('start', startShape(), 6000, 7000)
          .draw('q0', stateShape('q0'), 7200, 9200)
          .draw('q0-q1', edgeShape('q0', 'q1', '0'), 9600, 11200)
          .draw('q1', stateShape('q1'), 11600, 13600)
          .draw('q1-q2', edgeShape('q1', 'q2', '1'), 14000, 15600)
          .draw('q2', stateShape('q2'), 16000, 18000)
          .draw('q2-q3', edgeShape('q2', 'q3', '0'), 18400, 20000)
          .draw('q3', stateShape('q3'), 20400, 23200),
      )
      .session({ enter: 31600, leave: 35500 }, (s) =>
        s.draw('loop-q3', loopShape('q3', '0,1'), 32000, 35000),
      )
      .session({ enter: 40600, leave: 44100 }, (s) =>
        s.draw('loop-q0', loopShape('q0', '1'), 41000, 43600),
      )
      .expect('ink', 26700, ['start', 'q0', 'q0-q1', 'q1', 'q1-q2', 'q2', 'q2-q3', 'q3'])
      .expect('ink', 38500, ['loop-q3'])
      .expect('ink', 47100, ['loop-q0'])
      .build(),

  'dfa-short': () =>
    new Script('dfa-short', 20000)
      .session({ enter: 5600, leave: 8500 }, (s) => s.draw('q0', stateShape('q0'), 6000, 8000))
      .expect('ink', 11500, ['q0'])
      .build(),

  'hand-rests': () =>
    new Script('hand-rests', 18000)
      .session({ enter: 1600, leave: 10500 }, (s) =>
        s.draw('q0', stateShape('q0'), 2000, 4000).rest(4300, 10000, at(0.66, 0.8)),
      )
      .expect('ink', 13500, ['q0'])
      .build(),

  'starts-with-hand': () =>
    new Script('starts-with-hand', 16000)
      .predraw('q0', stateShape('q0'))
      .session({ leave: 4500 }, (s) => s.rest(0, 4000, at(0.6, 0.76)))
      .session({ enter: 6600, leave: 9500 }, (s) => s.draw('q1', stateShape('q1'), 7000, 9000))
      .expect('ink', 12500, ['q1'])
      .build(),

  'shadow-pass': () =>
    new Script('shadow-pass', 12000)
      .with((s) => {
        s.shadow = {
          t0: 2000,
          t1: 5000,
          from: { x: -0.35, y: 0.5 },
          to: { x: 1.35, y: 0.56 },
          sigma: 0.16,
          depth: 0.25,
        };
      })
      .build(),

  'exposure-step': () =>
    new Script('exposure-step', 12000)
      .predraw('q0', stateShape('q0'))
      .with((s) => {
        s.brightnessAt = (t) => (t < 3000 ? 1 : 0.85);
      })
      .build(),

  'page-shift': () =>
    new Script('page-shift', 12000)
      .predraw('q0', stateShape('q0'))
      .with((s) => {
        (s.sheets[0] as Sheet).offsets = [
          { t: 3000, dx: 0, dy: 0 },
          { t: 3400, dx: SHIFT, dy: 0 },
        ];
      })
      .expect('page', 4400)
      .build(),

  'slide-and-hold': () =>
    new Script('slide-and-hold', 20000)
      .predraw('q0', stateShape('q0'))
      .with((s) => {
        (s.sheets[0] as Sheet).offsets = [
          { t: 2000, dx: 0, dy: 0 },
          { t: 2400, dx: SHIFT, dy: 0 },
        ];
      })
      .session({ enter: 1600, leave: 6500 }, (s) =>
        s.slide(2000, 2400, at(0.8, 0.8)).rest(2400, 6000, at(0.8, 0.8)),
      )
      .session({ enter: 9600, leave: 12500 }, (s) => s.draw('q1', stateShape('q1'), 10000, 12000))
      .expect('page', 7500)
      .expect('ink', 15500, ['q1'])
      .build(),

  // The owner's live test (2026-10-18): the sheet never quite settles, nudged a few pixels back
  // and forth (her hand, the camera's wobble) before, while and after she writes. Neither
  // motion nor a page event: one ink trigger for q1 once she's done.
  'nudge-while-writing': () =>
    new Script('nudge-while-writing', 18000)
      .predraw('q0', stateShape('q0'))
      .with((s) => {
        const nudge = 7 / 720;
        (s.sheets[0] as Sheet).offsets = Array.from({ length: 54 }, (_, i) => ({
          t: 2000 + i * 300,
          dx: i % 2 ? nudge : 0,
          dy: i % 3 === 1 ? nudge : 0,
        }));
      })
      .session({ enter: 2600, leave: 9500 }, (s) => s.draw('q1', stateShape('q1'), 3000, 9000))
      .expect('ink', 12500, ['q1'])
      .build(),

  'page-flip': () =>
    new Script('page-flip', 18000)
      .session({ enter: 1600, leave: 4500 }, (s) => s.draw('q0', stateShape('q0'), 2000, 4000))
      .with((s) => {
        s.sheets.push(
          freshSheet(12000, [
            { t: 12000, dx: 1.3, dy: 0.06 },
            { t: 12600, dx: 0, dy: 0 },
          ]),
        );
      })
      .session({ leave: 13100 }, (s) => s.carry(12000, 12600, at(0.86, 0.66), 1))
      .expect('ink', 7500, ['q0'])
      .expect('page', 14100)
      .build(),

  erase: () =>
    new Script('erase', 14000)
      .predraw('q0', stateCircles('q0'))
      .predraw('q0-label', stateLabel('q0'))
      .session({ enter: 1600, leave: 4000 }, (s) =>
        s.erase('q0-label-erase', 'q0-label', 2000, 3500),
      )
      .expect('ink', 7000, ['q0-label-erase'])
      .build(),

  'slow-drift': () =>
    new Script('slow-drift', 45000)
      .with((s) => {
        s.brightnessAt = (t) => 1 - (0.08 * Math.min(Math.max(t, 0), 40000)) / 40000;
      })
      .build(),

  'printed-box': () =>
    new Script('printed-box', 22000)
      .with((s) => {
        (s.sheets[0] as Sheet).boxes = [
          { x0: 0.8, y0: 0.04 * A, x1: 0.95, y1: 0.17 * A, color: PRINTED_BOX },
        ];
      })
      .session({ enter: 12600, leave: 15500 }, (s) => s.draw('q0', stateShape('q0'), 13000, 15000))
      .expect('ink', 18500, ['q0'])
      .build(),

  'dark-desk': () =>
    new Script('dark-desk', 22000)
      .with((s) => {
        s.heightFraction = 0.7;
        s.desk = DARK_DESK;
      })
      .session({ enter: 12600, leave: 15500 }, (s) => s.draw('q0', stateShape('q0'), 13000, 15000))
      .expect('ink', 18500, ['q0'])
      .build(),

  'bold-pen': () =>
    new Script('bold-pen', 12000)
      .with((s) => {
        s.penWidth = BOLD_WIDTH;
        s.ink = FELT_TIP;
      })
      .session({ enter: 1600, leave: 4500 }, (s) => s.draw('q0', stateShape('q0'), 2000, 4000))
      .expect('ink', 7500, ['q0'])
      .build(),
};

export function makeClip(name: VariantName): Clip {
  const build = builders[name];
  if (!build) throw new Error(`paper-synth has no variant "${name}"`);
  return build();
}
