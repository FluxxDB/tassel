import { type AutomatonSpec, EPSILON } from '@tassel/shared/beats';
import { describe, expect, it } from 'vitest';
import { toDot } from '../../../../src/renderer/src/board/layout/dot';
import { CORRECT, ODD_IDS, WRONG } from '../fixtures';

describe('toDot', () => {
  it('writes the reference DFA left to right, with its accepting state and merged loop', () => {
    const dot = toDot(CORRECT);

    expect(dot).toContain('rankdir=LR');
    expect(dot).toContain('"q3" [shape=doublecircle]');
    expect(dot).toContain('"__start" -> "q0" [id="start"]');
    expect(dot).toContain('"q3" -> "q3" [id="q3>q3", label="0,1"]');
    expect(toDot(CORRECT)).toBe(dot);
  });

  it('writes exactly the graph the layout reads, states and edges in spec order', () => {
    expect(toDot(CORRECT)).toBe(
      [
        'digraph automaton {',
        '  rankdir=LR; nodesep=0.45; ranksep=0.6; splines=true;',
        '  node [shape=circle, fixedsize=true, width=0.8889, label="", fontsize=14];',
        '  edge [arrowsize=0.7, fontsize=14];',
        '  "__start" [shape=point, width=0.01, style=invis];',
        '  "q0"; "q1"; "q2"; "q3" [shape=doublecircle]; "qd";',
        '  "__start" -> "q0" [id="start"];',
        '  "q0" -> "q1" [id="q0>q1", label="0"];',
        '  "q1" -> "q2" [id="q1>q2", label="1"];',
        '  "q2" -> "q3" [id="q2>q3", label="0"];',
        '  "q3" -> "q3" [id="q3>q3", label="0,1"];',
        '  "q0" -> "qd" [id="q0>qd", label="1"];',
        '  "q1" -> "qd" [id="q1>qd", label="0"];',
        '  "q2" -> "qd" [id="q2>qd", label="1"];',
        '  "qd" -> "qd" [id="qd>qd", label="0,1"];',
        '}',
      ].join('\n'),
    );
  });

  it('draws one edge per ordered pair, its symbols merged in first-seen order', () => {
    const spec: AutomatonSpec = {
      ...WRONG,
      transitions: [
        { from: 'q3', to: 'q3', symbols: ['1'] },
        { from: 'q0', to: 'q1', symbols: ['0'] },
        { from: 'q3', to: 'q3', symbols: ['0', '1'] },
      ],
    };
    const dot = toDot(spec);

    expect(dot).toContain('  "q3" -> "q3" [id="q3>q3", label="1,0"];\n  "q0" -> "q1"');
    expect(dot.match(/"q3" -> "q3"/g)).toHaveLength(1);
  });

  it('quotes every state id, digit-led ones and DOT reserved words too', () => {
    const dot = toDot(ODD_IDS);

    expect(dot).toContain('  "0"; "1"; "10"; "0a" [shape=doublecircle]; "node";\n');
    expect(dot).toContain('  "__start" -> "0" [id="start"];\n');
    expect(dot).toContain('  "0" -> "1" [id="0>1", label="a"];\n');
    expect(dot).toContain('  "node" -> "0" [id="node>0", label="a"];\n');
  });

  it('labels ε as ε and escapes quotes and backslashes in symbols', () => {
    const spec: AutomatonSpec = {
      kind: 'nfa',
      states: [{ id: 'p0' }, { id: 'p1', accept: true }],
      start: 'p0',
      transitions: [
        { from: 'p0', to: 'p1', symbols: [EPSILON] },
        { from: 'p1', to: 'p1', symbols: ['"', '\\n'] },
      ],
    };
    const dot = toDot(spec);

    expect(dot).toContain('"p0" -> "p1" [id="p0>p1", label="ε"];');
    expect(dot).toContain(String.raw`"p1" -> "p1" [id="p1>p1", label="\",\\n"];`);
  });
});
