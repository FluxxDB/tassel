import { describe, expect, it } from 'vitest';
import {
  type AutomatonSpec,
  checkAutomaton,
  EPSILON,
  edgeRef,
  MOUTH_SHAPES,
  normalizeWord,
  parseAction,
  parseBeatDoc,
  parseElementRef,
  restCues,
} from '../src/beats';
import fixtures from '../src/beats/fixtures.json';

/** The fixtures' wrong DFA, the one her paper shows: q0 loops on 1, so 1010 gets in. */
const WRONG: AutomatonSpec = {
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
};

const PULSE = { kind: 'board.pulse', item: 'wrong', el: 'state:q0' } as const;

/** A valid live-style beat, with `changes` applied. */
function beat(changes: Record<string, unknown> = {}) {
  return {
    version: 1,
    id: 'beat-1',
    turn: 'turn-1',
    segment: 'seg-1',
    lang: 'en',
    text: 'Try this one.',
    durationSec: null,
    shapeSet: 'rhubarb9',
    mouthCues: [],
    words: ['Try', 'this', 'one.'].map((text) => ({ text, start: null, end: null })),
    markers: [{ id: 'm1', word: 0, action: PULSE }],
    ...changes,
  };
}

describe('parseAction', () => {
  it.each(fixtures.actions)('parses the $kind action', (a) => expect(parseAction(a)).toEqual(a));
  it.each(fixtures.invalidActions)('rejects $why', ({ data }) =>
    expect(parseAction(data)).toBeNull(),
  );

  it('covers every kind of action in the fixtures', () => {
    expect(new Set(fixtures.actions.map((a) => a.kind))).toEqual(
      new Set([
        'board.automaton',
        'board.diagram',
        'board.addState',
        'board.addTransition',
        'board.reveal',
        'board.highlight',
        'board.pulse',
        'board.note',
        'board.trace',
        'board.traceStep',
        'board.verdict',
        'board.focus',
        'board.clear',
        'paper.freeze',
        'paper.mark',
        'paper.unmark',
        'paper.trace',
        'paper.traceStep',
        'paper.clear',
        'paper.live',
        'stage',
        'image.show',
        'image.mark',
        'image.clear',
      ]),
    );
  });

  it('returns a copy with only the contract fields', () => {
    const data = { kind: 'board.reveal', item: 'fix', els: ['state:q0'] };
    const parsed = parseAction(data);
    expect(parsed).toEqual(data);
    expect(parsed).not.toBe(data);
  });

  it('reads a null optional field as absent, as the server may send one', () => {
    expect(
      parseAction({ kind: 'board.note', item: 'why', text: 'Look here.', near: null }),
    ).toEqual({ kind: 'board.note', item: 'why', text: 'Look here.' });
  });

  it('rejects what is not an action', () => {
    for (const data of [null, undefined, 'stage', 42, [], { view: 'split' }]) {
      expect(parseAction(data)).toBeNull();
    }
  });

  it('caps a trace input at 64 symbols, on the board and on the paper', () => {
    const board = (input: string) =>
      parseAction({ kind: 'board.trace', item: 'run', spec: WRONG, input });
    const paper = (input: string) => parseAction({ kind: 'paper.trace', input });
    expect(board('1'.repeat(64))).not.toBeNull();
    expect(board('1'.repeat(65))).toBeNull();
    expect(paper('0'.repeat(64))).not.toBeNull();
    expect(paper('0'.repeat(65))).toBeNull();
    // The empty input is a trace too: does the start state accept?
    expect(paper('')).toEqual({ kind: 'paper.trace', input: '' });
  });

  it('rejects a transition with no symbols, as checkAutomaton does', () => {
    const spec = { ...WRONG, transitions: [{ from: 'q0', to: 'q1', symbols: [] }] };
    expect(parseAction({ kind: 'board.automaton', item: 'wrong', spec })).toBeNull();
    expect(checkAutomaton(spec)).not.toEqual([]);
  });
});

describe('parseBeatDoc', () => {
  it.each(fixtures.beats)('accepts beat $id', (d) =>
    expect(parseBeatDoc(d)).toEqual({ doc: d, problems: [] }),
  );
  it.each(fixtures.invalidBeats)('reports $problem', ({ data, problem }) =>
    expect(parseBeatDoc(data).problems).toContain(problem),
  );

  it('a bad marker is dropped and the rest of the beat kept', () => {
    const data = beat({
      markers: [
        { id: 'm1', word: 1, action: PULSE },
        { id: 'm2', word: 2, action: { kind: 'board.pulse', item: 'wrong', el: 'edge:q0' } },
      ],
    });
    const { doc, problems } = parseBeatDoc(data);
    expect(doc?.markers).toEqual([{ id: 'm1', word: 1, action: PULSE }]);
    expect(doc).toMatchObject({ id: 'beat-1', words: data.words });
    expect(problems).toEqual(['marker m2 has an invalid action']);
  });

  it('drops an out-of-range marker and a duplicate one, keeping the first', () => {
    const { doc, problems } = parseBeatDoc(
      beat({
        markers: [
          { id: 'm1', word: 3, action: PULSE },
          { id: 'm2', word: 4, action: PULSE },
          { id: 'm1', word: 0, action: PULSE },
        ],
      }),
    );
    // word === words.length is allowed: it fires with the last word.
    expect(doc?.markers).toEqual([{ id: 'm1', word: 3, action: PULSE }]);
    expect(problems).toEqual(['marker m2 anchors to word 4 of 3', 'duplicate marker m1']);
  });

  it('rejects a document with a doc-level problem', () => {
    expect(parseBeatDoc(beat({ version: 2 }))).toEqual({ doc: null, problems: ['bad version'] });
    expect(parseBeatDoc(null)).toEqual({ doc: null, problems: ['bad document'] });
    expect(parseBeatDoc(beat({ durationSec: undefined })).doc).toBeNull();
  });

  it('holds to the limits: 80 words, 40 markers, ids of 64 characters, text of 400', () => {
    const words = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ text: `w${i}`, start: null, end: null }));
    const markers = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `m${i}`, word: 0, action: PULSE }));
    expect(parseBeatDoc(beat({ words: words(80), markers: markers(40) })).problems).toEqual([]);
    expect(parseBeatDoc(beat({ words: words(81) }))).toEqual({
      doc: null,
      problems: ['too many words'],
    });
    expect(parseBeatDoc(beat({ markers: markers(41) }))).toEqual({
      doc: null,
      problems: ['too many markers'],
    });
    expect(parseBeatDoc(beat({ id: 'b'.repeat(64), text: 't'.repeat(400) })).problems).toEqual([]);
    expect(parseBeatDoc(beat({ id: 'b'.repeat(65) })).problems).toEqual(['bad id']);
    expect(parseBeatDoc(beat({ text: 't'.repeat(401) })).problems).toEqual(['text too long']);
  });

  it('accepts timed words that overlap, as long as each starts no earlier than the last', () => {
    const words = [
      { text: 'q', start: 0, end: 0.3 },
      { text: 'zero', start: 0.25, end: 0.6 },
    ];
    expect(parseBeatDoc(beat({ words, markers: [] })).problems).toEqual([]);
  });
});

describe('checkAutomaton', () => {
  it('accepts the demo DFA and an NFA with ε', () => {
    expect(checkAutomaton(WRONG)).toEqual([]);
    expect(
      checkAutomaton({
        kind: 'nfa',
        states: [{ id: 'p0' }, { id: 'p1', accept: true }],
        start: 'p0',
        transitions: [{ from: 'p0', to: 'p1', symbols: [EPSILON] }],
      }),
    ).toEqual([]);
  });

  it('names each problem', () => {
    const states = WRONG.states;
    expect(checkAutomaton({ ...WRONG, start: 'q9' })).toEqual(['unknown start q9']);
    expect(checkAutomaton({ ...WRONG, states: [...states, { id: 'q1' }] })).toEqual([
      'duplicate state q1',
    ]);
    expect(
      checkAutomaton({ ...WRONG, transitions: [{ from: 'q0', to: 'q9', symbols: ['0'] }] }),
    ).toEqual(['unknown state q9 in q0>q9']);
    expect(
      checkAutomaton({
        ...WRONG,
        transitions: [...WRONG.transitions, { from: 'q0', to: 'q2', symbols: ['1'] }],
      }),
    ).toEqual(['two moves from q0 on 1']);
    expect(
      checkAutomaton({
        ...WRONG,
        transitions: [...WRONG.transitions, { from: 'q1', to: 'q0', symbols: [EPSILON] }],
      }),
    ).toEqual(['ε in a DFA']);
    expect(checkAutomaton({ ...WRONG, states: [...states, { id: 'q 1' }] })).toEqual([
      'bad state id "q 1"',
    ]);
    expect(
      checkAutomaton({
        ...WRONG,
        transitions: [...WRONG.transitions, { from: 'q1', to: 'q1', symbols: ['0,1'] }],
      }),
    ).toEqual(['bad symbol "0,1"']);
  });

  it('reads two transitions on one ordered pair as one edge, not two moves', () => {
    const doubled: AutomatonSpec = {
      ...WRONG,
      transitions: [...WRONG.transitions, { from: 'q3', to: 'q3', symbols: ['1'] }],
    };
    expect(checkAutomaton(doubled)).toEqual([]);
  });

  it('holds symbols to 1–4 characters with no space or comma', () => {
    const withSymbol = (symbol: string) =>
      checkAutomaton({ ...WRONG, transitions: [{ from: 'q0', to: 'q1', symbols: [symbol] }] });
    expect(withSymbol('abcd')).toEqual([]);
    expect(withSymbol('abcde')).toEqual(['bad symbol "abcde"']);
    expect(withSymbol('')).toEqual(['bad symbol ""']);
    expect(withSymbol('a b')).toEqual(['bad symbol "a b"']);
  });

  it('names a transition with no symbols', () => {
    expect(
      checkAutomaton({ ...WRONG, transitions: [{ from: 'q1', to: 'q1', symbols: [] }] }),
    ).toEqual(['no symbols in q1>q1']);
  });

  it('holds state ids to a letter or digit, then up to 15 letters, digits or underscores', () => {
    const withState = (id: string) =>
      checkAutomaton({ kind: 'nfa', states: [{ id }], start: id, transitions: [] });
    expect(withState('q_dead1')).toEqual([]);
    expect(withState(`q${'1'.repeat(15)}`)).toEqual([]);
    expect(withState(`q${'1'.repeat(16)}`)).toEqual([`bad state id "q${'1'.repeat(16)}"`]);
    expect(withState('_q')).toEqual(['bad state id "_q"']);
    expect(withState('q-1')).toEqual(['bad state id "q-1"']);
  });

  it('takes the textbook labels a reading of her paper may carry: 0, 1, 2, 10', () => {
    for (const id of ['0', '1', '2', '10', '0a']) {
      const spec: AutomatonSpec = { kind: 'dfa', states: [{ id }], start: id, transitions: [] };
      expect(checkAutomaton(spec)).toEqual([]);
    }
  });
});

describe('element refs', () => {
  it('edgeRef names an edge by its ordered pair', () => {
    expect(edgeRef('q0', 'q1')).toBe('edge:q0>q1');
  });

  it('parseElementRef reads start, states and edges, self-loops included', () => {
    expect(parseElementRef('start')).toEqual({ kind: 'start' });
    expect(parseElementRef('state:q3')).toEqual({ kind: 'state', id: 'q3' });
    expect(parseElementRef('edge:q0>q0')).toEqual({ kind: 'edge', from: 'q0', to: 'q0' });
    expect(parseElementRef('state:0')).toEqual({ kind: 'state', id: '0' });
    expect(parseElementRef('edge:0>1')).toEqual({ kind: 'edge', from: '0', to: '1' });
  });

  it('parseElementRef rejects anything else', () => {
    const refs = ['edge:q0', 'edge:q0>q1>q2', 'state:', 'state:q 1', 'state:_0', 'q0', 'Start', ''];
    for (const ref of refs) {
      expect(parseElementRef(ref)).toBeNull();
    }
  });
});

describe('cues and words', () => {
  it('restCues rests for the whole beat', () => {
    expect(restCues(1.25)).toEqual([{ start: 0, end: 1.25, value: 'X' }]);
  });

  it('has the nine Rhubarb mouth shapes', () => {
    expect(MOUTH_SHAPES).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X']);
  });

  it('normalizeWord keeps letters, digits and inner apostrophes, composed and in lower case', () => {
    expect(normalizeWord('Today?')).toBe('today');
    expect(normalizeWord("I'm")).toBe("i'm");
    expect(normalizeWord('1010.')).toBe('1010');
    expect(normalizeWord('«q0»,')).toBe('q0');
    expect(normalizeWord('Él')).toBe('él');
    expect(normalizeWord('상태를,')).toBe('상태를');
  });

  it('normalizeWord reads a curly apostrophe as a straight one and trims outer ones', () => {
    expect(normalizeWord('I’m')).toBe("i'm");
    expect(normalizeWord('‘q0’')).toBe('q0');
    expect(normalizeWord("'tis")).toBe('tis');
    expect(normalizeWord("dogs'")).toBe('dogs');
  });
});

it('draws the owner live DFA with first moves and no accepting states', async () => {
  const { default: live } = await import('../src/beats/live-dfa-fixture.json');
  const parsed = parseAction(live.action);
  expect(parsed).toEqual({
    ...live.action,
    spec: {
      ...live.action.spec,
      transitions: live.expectedTransitions,
    },
  });
  expect(
    parseBeatDoc(beat({ markers: [{ id: 'live', word: 0, action: live.action }] })).doc?.markers[0]
      .action,
  ).toEqual(parsed);
});

it('keeps nonconflicting symbols on a trimmed board edge', () => {
  const parsed = parseAction({
    kind: 'board.automaton',
    item: 'd',
    spec: {
      kind: 'dfa',
      start: 'q0',
      states: ['q0', 'q1', 'q2'].map((id) => ({ id })),
      transitions: [
        { from: 'q0', to: 'q1', symbols: ['0'] },
        { from: 'q0', to: 'q2', symbols: ['0', '1'] },
      ],
    },
  });
  expect(parsed?.kind === 'board.automaton' && parsed.spec.transitions).toEqual([
    { from: 'q0', to: 'q1', symbols: ['0'] },
    { from: 'q0', to: 'q2', symbols: ['1'] },
  ]);
});
