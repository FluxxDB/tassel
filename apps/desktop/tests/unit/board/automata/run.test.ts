import { type AutomatonSpec, EPSILON } from '@tassel/shared/beats';
import { describe, expect, it } from 'vitest';
import {
  mergedEdges,
  readSymbols,
  runAutomaton,
} from '../../../../src/renderer/src/board/automata/run';
import { CORRECT, WRONG } from '../fixtures';

/** q0 -ε→ q1 -a→ q2, with q2 accepting. */
const EPS_NFA: AutomatonSpec = {
  kind: 'nfa',
  states: [{ id: 'q0' }, { id: 'q1' }, { id: 'q2', accept: true }],
  start: 'q0',
  transitions: [
    { from: 'q0', to: 'q1', symbols: [EPSILON] },
    { from: 'q1', to: 'q2', symbols: ['a'] },
  ],
};

describe('runAutomaton', () => {
  it("the wrong DFA accepts 1010 through q0's loop", () => {
    const run = runAutomaton(WRONG, '1010');

    expect(run.steps.flatMap((step) => step.edges)).toEqual([
      'edge:q0>q0',
      'edge:q0>q1',
      'edge:q1>q2',
      'edge:q2>q3',
    ]);
    expect(run.final).toEqual(['q3']);
    expect(run.accepted).toBe(true);
    expect(run.stuckAt).toBeNull();
    expect(run.input).toBe('1010');
    expect(run.steps[0]).toEqual({
      index: 0,
      symbol: '1',
      from: ['q0'],
      to: ['q0'],
      edges: ['edge:q0>q0'],
    });
    expect(run.steps.map((step) => [step.index, step.symbol, step.from, step.to])).toEqual([
      [0, '1', ['q0'], ['q0']],
      [1, '0', ['q0'], ['q1']],
      [2, '1', ['q1'], ['q2']],
      [3, '0', ['q2'], ['q3']],
    ]);
  });

  it('the reference DFA rejects 1010 in the dead state', () => {
    const run = runAutomaton(CORRECT, '1010');

    expect(run.steps[0].to).toEqual(['qd']);
    expect(run.steps).toHaveLength(4);
    expect(run.final).toEqual(['qd']);
    expect(run.accepted).toBe(false);
    expect(run.stuckAt).toBeNull();
  });

  it('a missing move gets stuck and rejects', () => {
    const run = runAutomaton(WRONG, '00');

    expect(run.stuckAt).toBe(1);
    expect(run.steps).toHaveLength(2);
    expect(run.steps[1]).toEqual({ index: 1, symbol: '0', from: ['q1'], to: [], edges: [] });
    expect(run.final).toEqual([]);
    expect(run.accepted).toBe(false);
  });

  it('stops at the stuck step even with input left', () => {
    const run = runAutomaton(WRONG, '0011');

    expect(run.stuckAt).toBe(1);
    expect(run.steps).toHaveLength(2);
    expect(run.input).toBe('0011');
  });

  it('an empty input ends where it starts', () => {
    expect(runAutomaton(WRONG, '')).toEqual({
      input: '',
      steps: [],
      final: ['q0'],
      accepted: false,
      stuckAt: null,
    });
  });

  it('an NFA follows ε-moves', () => {
    const run = runAutomaton(EPS_NFA, 'a');

    expect(run.steps[0].from).toEqual(['q0', 'q1']);
    expect(run.steps[0].to).toEqual(['q2']);
    expect(run.steps[0].edges).toEqual(['edge:q1>q2']);
    expect(run.final).toEqual(['q2']);
    expect(run.accepted).toBe(true);
  });

  it('an NFA accepts the empty input when its start closes over an accepting state', () => {
    const spec: AutomatonSpec = {
      ...EPS_NFA,
      transitions: [{ from: 'q0', to: 'q2', symbols: [EPSILON] }],
    };

    expect(runAutomaton(spec, '')).toMatchObject({ final: ['q0', 'q2'], accepted: true });
  });

  it('an NFA holds every state it can be in, in spec order, closed after each symbol', () => {
    const spec: AutomatonSpec = {
      kind: 'nfa',
      states: [{ id: 'b' }, { id: 'a' }, { id: 'c' }, { id: 'd', accept: true }],
      start: 'a',
      transitions: [
        { from: 'a', to: 'c', symbols: ['x'] },
        { from: 'a', to: 'b', symbols: ['x'] },
        { from: 'c', to: 'd', symbols: [EPSILON] },
      ],
    };
    const run = runAutomaton(spec, 'x');

    expect(run.steps[0].to).toEqual(['b', 'c', 'd']);
    expect(run.steps[0].edges).toEqual(['edge:a>c', 'edge:a>b', 'edge:c>d']);
    expect(run.accepted).toBe(true);
  });

  it('an NFA with no move left gets stuck', () => {
    const run = runAutomaton(EPS_NFA, 'ab');

    expect(run.stuckAt).toBe(1);
    expect(run.steps[1].to).toEqual([]);
    expect(run.final).toEqual([]);
    expect(run.accepted).toBe(false);
  });

  it('never reads ε from the input', () => {
    const run = runAutomaton(EPS_NFA, EPSILON);

    expect(run.stuckAt).toBe(0);
    expect(run.steps[0]).toMatchObject({ symbol: EPSILON, to: [], edges: [] });
  });

  it('reads a symbol of several characters as one step', () => {
    const spec: AutomatonSpec = {
      kind: 'dfa',
      states: [{ id: 's0' }, { id: 's1', accept: true }],
      start: 's0',
      transitions: [
        { from: 's0', to: 's1', symbols: ['ab'] },
        { from: 's1', to: 's1', symbols: ['a'] },
      ],
    };
    const run = runAutomaton(spec, 'aba');

    expect(run.steps.map((step) => step.symbol)).toEqual(['ab', 'a']);
    expect(run.accepted).toBe(true);
  });
});

describe('readSymbols', () => {
  it('reads one character at a time from a one-character alphabet', () => {
    expect(readSymbols(WRONG, '1010')).toEqual(['1', '0', '1', '0']);
  });

  it('takes the longest symbol that matches, and any other character alone', () => {
    const spec: AutomatonSpec = {
      kind: 'dfa',
      states: [{ id: 's0' }],
      start: 's0',
      transitions: [{ from: 's0', to: 's0', symbols: ['a', 'ab', 'abc'] }],
    };

    expect(readSymbols(spec, 'abcabaz🙂')).toEqual(['abc', 'ab', 'a', 'z', '🙂']);
  });
});

describe('mergedEdges', () => {
  it("merges q3's 0 and 1 into one loop", () => {
    const spec: AutomatonSpec = {
      ...WRONG,
      transitions: [
        { from: 'q0', to: 'q1', symbols: ['0'] },
        { from: 'q3', to: 'q3', symbols: ['1'] },
        { from: 'q1', to: 'q2', symbols: ['1'] },
        { from: 'q3', to: 'q3', symbols: ['0', '1'] },
      ],
    };

    expect(mergedEdges(spec)).toEqual([
      { from: 'q0', to: 'q1', symbols: ['0'] },
      { from: 'q3', to: 'q3', symbols: ['1', '0'] },
      { from: 'q1', to: 'q2', symbols: ['1'] },
    ]);
  });

  it('gives one entry per ordered pair, in order of first appearance', () => {
    expect(mergedEdges(CORRECT).map(({ from, to }) => `${from}>${to}`)).toEqual([
      'q0>q1',
      'q1>q2',
      'q2>q3',
      'q3>q3',
      'q0>qd',
      'q1>qd',
      'q2>qd',
      'qd>qd',
    ]);
  });

  it('leaves the spec as it was', () => {
    const spec = structuredClone(WRONG);
    mergedEdges(spec)[0].symbols.push('9');

    expect(spec).toEqual(WRONG);
  });
});
