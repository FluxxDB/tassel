import { type DfaReading, EPSILON } from '@tassel/shared/vision';
import fixtures from '@tassel/shared/vision/fixtures.json';
import { assert, describe, expect, it } from 'vitest';
import {
  type CardLayout,
  layoutReading,
} from '../../../../src/renderer/src/vision/readback/layout';

const demo = fixtures.readings['demo-wrong'] as DfaReading;
const edge = (id: string, source: string, target: string, symbols = ['0']) => ({
  ...demo.transitions[0],
  id,
  source,
  target,
  symbols,
});

function allPoints(layout: CardLayout): Array<[number, number]> {
  const points: Array<[number, number]> = layout.states.flatMap((s) => [
    [s.x - s.r, s.y - s.r],
    [s.x + s.r, s.y + s.r],
  ]);
  for (const e of [...layout.edges, ...(layout.start ? [layout.start] : [])]) {
    const numbers = e.d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)?.map(Number) ?? [];
    for (let i = 0; i < numbers.length; i += 2) points.push([numbers[i], numbers[i + 1]]);
    points.push(...e.head);
  }
  points.push(...layout.edges.map((e): [number, number] => [e.lx, e.ly]));
  return points;
}

describe('layoutReading', () => {
  it('layers the demo in BFS ranks, preserving state and transition ids', () => {
    const layout = layoutReading(demo);
    expect(layout.states.map((s) => s.id)).toEqual(['q0', 'q1', 'q2', 'q3']);
    expect(layout.edges.map((e) => e.id)).toEqual(demo.transitions.map((e) => e.id));
    for (let i = 1; i < 4; i++) {
      expect(layout.states[i].x - layout.states[i - 1].x).toBe(92);
      expect(layout.states[i].y).toBe(layout.states[0].y);
    }
    expect(layout.states.map((s) => s.r)).toEqual([17, 17, 17, 17]);
    expect(layout.states.filter((s) => s.accept).map((s) => s.id)).toEqual(['q3']);
    expect(layout.edges.find((e) => e.id === 'q0-0-q1')?.d).toMatch(/^M[\d .-]+L/);
    expect(layout.missingMoves).toBe(true);
  });

  it('places cubic loop labels above their states and bounds every control point', () => {
    const layout = layoutReading(demo);
    for (const id of ['q0', 'q3']) {
      const state = layout.states.find((s) => s.id === id);
      assert(state);
      const loop = layout.edges.find((e) => e.id.startsWith(`${id}-`) && e.id.endsWith(`-${id}`));
      assert(loop);
      expect(loop.d).toContain('C');
      expect(loop.lx).toBe(state.x);
      expect(loop.ly).toBeCloseTo(state.y - 3.1 * state.r);
    }
    const points = allPoints(layout);
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(20 - 1e-8);
      expect(y).toBeGreaterThanOrEqual(20 - 1e-8);
      expect(x).toBeLessThanOrEqual(layout.width - 20 + 1e-8);
      expect(y).toBeLessThanOrEqual(layout.height - 20 + 1e-8);
    }
    expect(Math.min(...points.map(([x]) => x))).toBeCloseTo(20);
    expect(Math.min(...points.map(([, y]) => y))).toBeCloseTo(20);
    expect(Math.max(...points.map(([x]) => x))).toBeCloseTo(layout.width - 20);
    expect(Math.max(...points.map(([, y]) => y))).toBeCloseTo(layout.height - 20);
  });

  it('curves a back edge and separates a two-way pair', () => {
    const layout = layoutReading({
      ...demo,
      transitions: [edge('forward', 'q0', 'q1'), edge('reverse', 'q1', 'q0')],
    });
    const [forward, reverse] = layout.edges;
    expect(forward.d).toContain('Q');
    expect(reverse.d).toContain('Q');
    expect(forward.ly).toBeCloseTo(layout.states[0].y - 0.35 * 92);
    expect(reverse.ly).toBeCloseTo(layout.states[0].y + 0.35 * 92);
    expect(forward.d).not.toBe(reverse.d);
    for (const e of layout.edges) {
      const target = layout.states.find((s) => s.id === (e.id === 'forward' ? 'q1' : 'q0'));
      assert(target);
      expect(Math.hypot(e.head[0][0] - target.x, e.head[0][1] - target.y)).toBeCloseTo(17);
      const base = [(e.head[1][0] + e.head[2][0]) / 2, (e.head[1][1] + e.head[2][1]) / 2];
      expect(Math.hypot(e.head[0][0] - base[0], e.head[0][1] - base[1])).toBeCloseTo(7);
    }
  });

  it('discovers rows in transition order and puts unreachable states in one last rank', () => {
    const layout = layoutReading({
      ...demo,
      transitions: [edge('a', 'q0', 'q2'), edge('b', 'q0', 'q1')],
    });
    const [q0, q1, q2, q3] = layout.states;
    expect(q2.x - q0.x).toBe(92);
    expect(q1.x).toBe(q2.x);
    expect(q1.y - q2.y).toBe(72);
    expect(q3.x - q2.x).toBe(92);
    expect(q3.y).toBe(q0.y);
    const disconnected = layoutReading({ ...demo, transitions: [] });
    expect(disconnected.states.slice(1).map((s) => s.x - disconnected.states[0].x)).toEqual([
      92, 92, 92,
    ]);
    expect(disconnected.states[2].y - disconnected.states[1].y).toBe(72);
  });

  it('merges a pair, sorts distinct symbols, and carries uncertainty from any constituent', () => {
    const reading = {
      ...demo,
      uncertain: ['second'],
      transitions: [
        edge('first', 'q0', 'q1', ['1']),
        edge('second', 'q0', 'q1', [EPSILON, '0', '1']),
      ],
    };
    const layout = layoutReading(reading);
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]).toMatchObject({ id: 'first', label: '0,1,ε', uncertain: true });
  });

  it('uses the first state for ranking without inventing a start arrow', () => {
    const layout = layoutReading({
      ...demo,
      states: demo.states.map((s) => ({ ...s, start: false })),
    });
    expect(layout.start).toBeNull();
    expect(layout.states[1].x - layout.states[0].x).toBeCloseTo(92);
  });

  it('gives a start arrow 28 units long ending on the start circle', () => {
    const layout = layoutReading(demo);
    const [q0] = layout.states;
    expect(layout.start?.d).toBe(`M${q0.x - 17 - 28} ${q0.y} L${q0.x - 17} ${q0.y}`);
    expect(layout.start?.head[0]).toEqual([q0.x - 17, q0.y]);
  });

  it('does not mutate the reading and handles empty or dangling input', () => {
    const before = structuredClone(demo);
    layoutReading(demo);
    expect(demo).toEqual(before);
    expect(layoutReading({ ...demo, states: [], transitions: [] })).toEqual({
      width: 40,
      height: 40,
      states: [],
      edges: [],
      start: null,
      missingMoves: false,
    });
    const layout = layoutReading({ ...demo, transitions: [edge('dangling', 'q0', 'missing')] });
    expect(layout.edges).toEqual([]);
    expect(layout.missingMoves).toBe(true);
  });

  it('reports a complete machine without a dead-state note', () => {
    expect(
      layoutReading({
        ...demo,
        transitions: demo.states.map((s) => edge(s.id, s.id, s.id, ['0', '1'])),
      }).missingMoves,
    ).toBe(false);
  });
});
