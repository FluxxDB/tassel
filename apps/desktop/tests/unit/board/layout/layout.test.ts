import type { AutomatonSpec, Pt } from '@tassel/shared/beats';
import { describe, expect, it } from 'vitest';
import { mergedEdges } from '../../../../src/renderer/src/board/automata/run';
import { fallbackLayout } from '../../../../src/renderer/src/board/layout/fallback';
import {
  fromGraphvizJson,
  type GraphvizJson0,
} from '../../../../src/renderer/src/board/layout/from-graphviz';
import {
  type AutomatonLayout,
  STATE_RADIUS,
} from '../../../../src/renderer/src/board/layout/types';
import { layoutWithViz } from '../../../../src/renderer/src/board/layout/viz';
import { CORRECT, ODD_IDS, WRONG } from '../fixtures';

/** q0 -a→ q1 and q1 -b→ q0: a pair of opposite edges. */
const PAIR: AutomatonSpec = {
  kind: 'dfa',
  states: [{ id: 'q0' }, { id: 'q1', accept: true }],
  start: 'q0',
  transitions: [
    { from: 'q0', to: 'q1', symbols: ['a'] },
    { from: 'q1', to: 'q0', symbols: ['b'] },
  ],
};

const distance = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function expectStatesApart(layout: AutomatonLayout) {
  const centers = Object.values(layout.states);
  for (const [i, a] of centers.entries()) {
    for (const b of centers.slice(i + 1)) expect(distance(a, b)).toBeGreaterThanOrEqual(80);
  }
}

function expectInBox(layout: AutomatonLayout, p: Pt, r = 0) {
  expect(p.x - r).toBeGreaterThanOrEqual(0);
  expect(p.y - r).toBeGreaterThanOrEqual(0);
  expect(p.x + r).toBeLessThanOrEqual(layout.width);
  expect(p.y + r).toBeLessThanOrEqual(layout.height);
}

function expectFitsBox(layout: AutomatonLayout) {
  for (const state of Object.values(layout.states)) expectInBox(layout, state, state.r);
  for (const edge of Object.values(layout.edges)) expectInBox(layout, edge.label);
  expectInBox(layout, layout.start.from);
  expectInBox(layout, layout.start.to);
}

/**
 * Every state placed, every merged edge keyed, all inside the box and the states apart. Keys are
 * compared as sets: an object puts integer-like keys such as "10" first, whatever the spec's order.
 */
function expectSameContract(layout: AutomatonLayout, spec: AutomatonSpec) {
  const ids = spec.states.map(({ id }) => id);
  expect(Object.keys(layout.states).sort()).toEqual(ids.sort());
  for (const state of Object.values(layout.states)) expect(state.r).toBe(STATE_RADIUS);
  expect(Object.keys(layout.edges).sort()).toEqual(
    mergedEdges(spec)
      .map(({ from, to }) => `${from}>${to}`)
      .sort(),
  );
  expectFitsBox(layout);
  expectStatesApart(layout);
}

/**
 * Where an edge's curve peaks: `bend` px from the middle of the chord between its states, to the
 * left of tail → head (the left of (dx, dy) on a y-down board is (dy, −dx)).
 */
function apex(layout: AutomatonLayout, from: string, to: string): Pt {
  const tail = layout.states[from];
  const head = layout.states[to];
  const chord = distance(tail, head);
  const { bend } = layout.edges[`${from}>${to}`];
  const left = { x: (head.y - tail.y) / chord, y: -(head.x - tail.x) / chord };
  return {
    x: (tail.x + head.x) / 2 + bend * left.x,
    y: (tail.y + head.y) / 2 + bend * left.y,
  };
}

/** Which side of the line from `a` to `b` a point lies on: 1 left, -1 right, 0 on it. */
function side(a: Pt, b: Pt, p: Pt): number {
  return Math.sign((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x));
}

describe('layoutWithViz', { timeout: 30_000 }, () => {
  it('lays the reference DFA out left to right', async () => {
    const { states } = await layoutWithViz(CORRECT);

    expect(states.q0.x).toBeLessThan(states.q1.x);
    expect(states.q1.x).toBeLessThan(states.q2.x);
    expect(states.q2.x).toBeLessThan(states.q3.x);
    expect(states.qd.x).toBeGreaterThan(states.q0.x);
    for (const state of Object.values(states)) expect(state.r).toBe(STATE_RADIUS);
  });

  it('keeps states apart', async () => {
    expectStatesApart(await layoutWithViz(CORRECT));
    expectStatesApart(await layoutWithViz(WRONG));
  });

  it("puts the start arrow on q0's left", async () => {
    const { states, start } = await layoutWithViz(CORRECT);

    expect(distance(start.to, { x: states.q0.x - 32, y: states.q0.y })).toBeLessThanOrEqual(2);
    expect(start.from.x).toBeLessThan(start.to.x);
    expect(distance(start.from, start.to)).toBeCloseTo(48, 6);
  });

  it('marks self-loops', async () => {
    const { edges } = await layoutWithViz(CORRECT);

    expect(Object.keys(edges).sort()).toEqual(
      mergedEdges(CORRECT)
        .map(({ from, to }) => `${from}>${to}`)
        .sort(),
    );
    for (const [key, edge] of Object.entries(edges)) {
      if (key === 'q3>q3' || key === 'qd>qd') {
        expect(edge.loop).not.toBeNull();
        expect(edge.bend).toBe(0);
      } else {
        expect(edge.loop).toBeNull();
      }
    }
  });

  it('fits its box', async () => {
    expectFitsBox(await layoutWithViz(CORRECT));
    expectFitsBox(await layoutWithViz(WRONG));
  });

  it('is deterministic', async () => {
    expect(await layoutWithViz(CORRECT)).toEqual(await layoutWithViz(CORRECT));
  });

  it('never lays a pair of opposite edges over each other', async () => {
    const layout = await layoutWithViz(PAIR);
    const { q0, q1 } = layout.states;

    // Graphviz draws one of the two straight and curves the other, or bends both apart.
    expect(side(q0, q1, apex(layout, 'q0', 'q1'))).not.toBe(side(q0, q1, apex(layout, 'q1', 'q0')));
  });

  it('lays out digit-led state ids and one named like a DOT keyword', async () => {
    const layout = await layoutWithViz(ODD_IDS);

    expectSameContract(layout, ODD_IDS);
    expect(layout.edges['0a>0a'].loop).not.toBeNull();
    expect(distance(layout.start.to, layout.states['0'])).toBeCloseTo(STATE_RADIUS, 6);
  });

  it('lays out symbols that DOT has to escape', async () => {
    const spec: AutomatonSpec = {
      ...PAIR,
      transitions: [{ from: 'q0', to: 'q1', symbols: ['"', '\\N'] }],
    };

    expect((await layoutWithViz(spec)).edges['q0>q1']).toBeDefined();
  });
});

describe('fallbackLayout', () => {
  it('keeps the same contract', () => {
    const layout = fallbackLayout(CORRECT);
    const centers = CORRECT.states.map(({ id }) => layout.states[id]);

    for (const [i, center] of centers.entries()) {
      expect(center.y).toBe(centers[0].y);
      expect(center.x).toBe(centers[0].x + 112 * i);
      expect(center.r).toBe(STATE_RADIUS);
    }
    expect(Object.keys(layout.edges)).toEqual(
      mergedEdges(CORRECT).map(({ from, to }) => `${from}>${to}`),
    );
    expect(layout.edges['q3>q3']).toMatchObject({ loop: 'top', bend: 0 });
    expect(layout.edges['qd>qd']).toMatchObject({ loop: 'top', bend: 0 });
    expect(layout.edges['qd>qd'].label.y).toBeLessThan(layout.states.qd.y - STATE_RADIUS);
    expectFitsBox(layout);
    expectStatesApart(layout);
  });

  it('lays out digit-led state ids and one named like a DOT keyword', () => {
    const layout = fallbackLayout(ODD_IDS);
    const centers = ODD_IDS.states.map(({ id }) => layout.states[id]);

    expectSameContract(layout, ODD_IDS);
    for (const [i, center] of centers.entries()) expect(center.x).toBe(centers[0].x + 112 * i);
    expect(layout.edges['0a>0a']).toMatchObject({ loop: 'top', bend: 0 });
  });

  it('puts a 48 px start arrow on the start state’s left', () => {
    const { states, start } = fallbackLayout(CORRECT);

    expect(start.to).toEqual({ x: states.q0.x - STATE_RADIUS, y: states.q0.y });
    expect(start.from).toEqual({ x: start.to.x - 48, y: states.q0.y });
  });

  it('draws neighbors straight and bends longer edges 40 px, forward above and backward below', () => {
    const spec: AutomatonSpec = {
      ...CORRECT,
      transitions: [...CORRECT.transitions, { from: 'qd', to: 'q1', symbols: ['2'] }],
    };
    const layout = fallbackLayout(spec);
    const row = layout.states.q0.y;

    for (const key of ['q0>q1', 'q1>q2', 'q2>q3']) expect(layout.edges[key].bend).toBe(0);
    for (const key of ['q0>qd', 'q1>qd', 'q2>qd', 'qd>q1']) {
      expect(Math.abs(layout.edges[key].bend)).toBe(40);
    }
    expect(apex(layout, 'q0', 'qd').y).toBe(row - 40);
    expect(apex(layout, 'q2', 'qd').y).toBe(row - 40);
    expect(apex(layout, 'qd', 'q1').y).toBe(row + 40);
    expectFitsBox(layout);
  });

  it('puts every label on the side its edge curves to', () => {
    const layout = fallbackLayout(CORRECT);

    expect(layout.edges['q0>qd'].label.y).toBeLessThan(apex(layout, 'q0', 'qd').y);
    expect(layout.edges['q0>q1'].label.y).toBeLessThan(layout.states.q0.y);
  });
});

it('bends a pair of opposite edges to opposite sides', () => {
  const layout = fallbackLayout(PAIR);
  const { q0, q1 } = layout.states;
  const there = layout.edges['q0>q1'].bend;
  const back = layout.edges['q1>q0'].bend;

  // bend is relative to each edge's own direction, and these two run opposite ways: curves on
  // opposite sides of the row have the same sign (ruling P5-R2).
  expect(there).not.toBe(0);
  expect(back).not.toBe(0);
  expect(Math.sign(there)).toBe(Math.sign(back));
  expect(side(q0, q1, apex(layout, 'q0', 'q1'))).toBe(-side(q0, q1, apex(layout, 'q1', 'q0')));
  expectFitsBox(layout);
});

describe('fromGraphvizJson', () => {
  const spec: AutomatonSpec = {
    kind: 'dfa',
    states: [{ id: 'a' }, { id: 'b', accept: true }],
    start: 'a',
    transitions: [
      { from: 'a', to: 'b', symbols: ['0'] },
      { from: 'b', to: 'b', symbols: ['1'] },
      { from: 'b', to: 'a', symbols: ['1'] },
    ],
  };
  /** Graphviz's points: origin bottom-left, y up. The start arrow comes in level from the left. */
  const json = (edges: GraphvizJson0['edges']): GraphvizJson0 => ({
    bb: '0,0,200,100',
    objects: [
      { name: '__start', pos: '0,50' },
      { name: 'a', pos: '60,50' },
      { name: 'b', pos: '160,50' },
    ],
    edges,
  });
  const straight = { id: 'a>b', tail: 1, head: 2, pos: 'e,128,50 92,50 100,50 110,50 120,50' };
  const loop = { id: 'b>b', tail: 2, head: 2, pos: '150,80 150,95 170,95 170,80', lp: '160,99' };
  /** From b back to a, bowed 30 px below the row in Graphviz's y-up points. */
  const under = { id: 'b>a', tail: 2, head: 1, pos: '160,50 140,10 80,10 60,50' };

  it('flips y against bb and moves everything 16 px in', () => {
    const layout = fromGraphvizJson(json([straight, loop, under]), spec);

    expect(layout.width).toBe(232);
    expect(layout.height).toBe(132);
    expect(layout.states.a).toEqual({ x: 76, y: 66, r: 32 });
    expect(layout.states.b).toEqual({ x: 176, y: 66, r: 32 });
    expect(layout.start).toEqual({ from: { x: 76 - 32 - 48, y: 66 }, to: { x: 44, y: 66 } });
  });

  it('keys edges by their id, whatever order Graphviz returns them in', () => {
    const layout = fromGraphvizJson(json([under, loop, straight]), spec);

    expect(Object.keys(layout.edges)).toEqual(['a>b', 'b>b', 'b>a']);
    // No lp: the label goes at the middle of the curve.
    const edge = layout.edges['a>b'];
    expect(edge.bend).toBe(0);
    expect(edge.loop).toBeNull();
    expect(edge.label.x).toBeCloseTo(122, 6);
    expect(edge.label.y).toBeCloseTo(66, 6);
  });

  it('measures bend at the middle of the curve, to the left of tail → head', () => {
    const layout = fromGraphvizJson(json([straight, loop, under]), spec);
    const edge = layout.edges['b>a'];

    // Below the row on a y-down board is the left of a leftward edge.
    expect(edge.bend).toBeCloseTo(30, 6);
    expect(edge.label.x).toBeCloseTo(126, 6);
    expect(edge.label.y).toBeCloseTo(96, 6);
    expect(edge.loop).toBeNull();
  });

  it('turns a bend under 4 px into 0 and clamps one past 0.6 × the chord', () => {
    const slight = { id: 'b>a', tail: 2, head: 1, pos: '160,50 140,46 80,46 60,50' };
    const deep = { id: 'b>a', tail: 2, head: 1, pos: '160,50 160,-250 60,-250 60,50' };

    expect(fromGraphvizJson(json([straight, loop, slight]), spec).edges['b>a'].bend).toBe(0);
    expect(fromGraphvizJson(json([straight, loop, deep]), spec).edges['b>a'].bend).toBeCloseTo(
      60,
      6,
    );
  });

  it("puts a self-loop on its label's side, unbent", () => {
    const top = fromGraphvizJson(json([straight, loop, under]), spec).edges['b>b'];
    const right = fromGraphvizJson(json([straight, { ...loop, lp: '200,52' }, under]), spec);

    expect(top).toEqual({ bend: 0, label: { x: 176, y: 17 }, loop: 'top' });
    expect(right.edges['b>b'].loop).toBe('right');
  });

  it('reads the curve after its end points', () => {
    const arrowed = { ...under, pos: `e,62,48 s,158,48 ${under.pos}` };

    expect(fromGraphvizJson(json([straight, loop, arrowed]), spec).edges['b>a'].bend).toBeCloseTo(
      30,
      6,
    );
  });

  it('throws for a state or an edge Graphviz left out', () => {
    expect(() => fromGraphvizJson(json([straight, loop]), spec)).toThrow('b>a');
    expect(() =>
      fromGraphvizJson({ ...json([straight, loop, under]), objects: [] }, spec),
    ).toThrow();
  });
});
