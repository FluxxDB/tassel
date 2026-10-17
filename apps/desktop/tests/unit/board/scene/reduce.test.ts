import { type AutomatonSpec, type BoardAction, EPSILON } from '@tassel/shared/beats';
import { describe, expect, it } from 'vitest';
import { runAutomaton } from '../../../../src/renderer/src/board/automata/run';
import {
  EMPTY_SCENE,
  elementsOf,
  isRevealed,
  reduceBoard,
} from '../../../../src/renderer/src/board/scene/reduce';
import type {
  AutomatonItem,
  BoardEffect,
  BoardItem,
  BoardScene,
  NoteItem,
  TraceItem,
} from '../../../../src/renderer/src/board/scene/types';
import { CORRECT, WRONG } from '../fixtures';

/** Applies `actions` in order, collecting every effect and problem. */
function run(scene: BoardScene, ...actions: BoardAction[]) {
  const effects: BoardEffect[] = [];
  const problems: string[] = [];
  let current = scene;
  for (const action of actions) {
    const result = reduceBoard(current, action);
    current = result.scene;
    effects.push(...result.effects);
    if (result.problem !== null) problems.push(result.problem);
  }
  return { scene: current, effects, problems };
}

function item<K extends BoardItem['kind']>(scene: BoardScene, id: string, kind: K) {
  const found = scene.items.find((i) => i.id === id);
  expect(found?.kind).toBe(kind);
  return found as Extract<BoardItem, { kind: K }>;
}

const automaton = (scene: BoardScene, id: string) => item(scene, id, 'automaton') as AutomatonItem;
const trace = (scene: BoardScene, id: string) => item(scene, id, 'trace') as TraceItem;
const note = (scene: BoardScene, id: string) => item(scene, id, 'note') as NoteItem;

/** Freezes `value` all the way down, so any mutation throws (modules are strict). */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const DRAW_WRONG: BoardAction = { kind: 'board.automaton', item: 'wrong', spec: WRONG };
const DRAW_FIX_HIDDEN: BoardAction = {
  kind: 'board.automaton',
  item: 'fix',
  spec: CORRECT,
  title: 'A DFA that works',
  reveal: 'none',
};

/** WRONG drawn as 'wrong', and CORRECT drawn hidden as 'fix'. */
const BOTH = run(EMPTY_SCENE, DRAW_WRONG, DRAW_FIX_HIDDEN).scene;

describe('reduceBoard', () => {
  it('starts from an empty scene', () => {
    expect(EMPTY_SCENE).toEqual({ items: [], focus: null, rev: 0 });
  });

  describe('board.automaton', () => {
    it('adds the automaton, all revealed, and focuses it', () => {
      const { scene, effects, problems } = run(EMPTY_SCENE, DRAW_WRONG);

      expect(scene.items).toEqual([
        {
          kind: 'automaton',
          id: 'wrong',
          title: null,
          spec: WRONG,
          revealed: 'all',
          highlighted: [],
          current: [],
        },
      ]);
      expect(scene.focus).toBe('wrong');
      expect(scene.rev).toBe(1);
      expect(effects).toEqual([]);
      expect(problems).toEqual([]);
    });

    it("reveals nothing with reveal: 'none', and keeps the title", () => {
      const fix = automaton(BOTH, 'fix');

      expect(fix.revealed).toEqual([]);
      expect(fix.title).toBe('A DFA that works');
      expect(BOTH.focus).toBe('fix');
    });

    it('replaces one with the same id in place, resetting revealed, highlighted and current', () => {
      const before = run(
        BOTH,
        { kind: 'board.reveal', item: 'fix', els: ['state:q0'] },
        { kind: 'board.highlight', item: 'wrong', el: 'edge:q0>q0', on: true },
        {
          kind: 'board.trace',
          item: 'run',
          spec: WRONG,
          input: '1010',
          on: 'wrong',
        },
      ).scene;
      expect(automaton(before, 'wrong').current).toEqual(['q0']);

      const { scene } = run(before, { kind: 'board.automaton', item: 'wrong', spec: CORRECT });

      expect(scene.items.map((i) => i.id)).toEqual(['wrong', 'fix', 'run']);
      expect(automaton(scene, 'wrong')).toMatchObject({
        spec: CORRECT,
        revealed: 'all',
        highlighted: [],
        current: [],
      });
      expect(scene.focus).toBe('wrong');
    });
  });

  describe('board.addState', () => {
    it('adds a state, revealed when revealed is a list', () => {
      const { scene, problems } = run(
        BOTH,
        { kind: 'board.addState', item: 'fix', id: 'q4', accept: true },
        { kind: 'board.addState', item: 'wrong', id: 'qd' },
      );

      expect(problems).toEqual([]);
      expect(automaton(scene, 'fix').spec.states.at(-1)).toEqual({ id: 'q4', accept: true });
      expect(automaton(scene, 'fix').revealed).toEqual(['state:q4']);
      expect(automaton(scene, 'wrong').spec.states.at(-1)).toEqual({ id: 'qd' });
      expect(automaton(scene, 'wrong').revealed).toBe('all');
    });

    it('is a problem on an unknown item', () => {
      const result = reduceBoard(EMPTY_SCENE, { kind: 'board.addState', item: 'fix', id: 'q1' });

      expect(result).toEqual({ scene: EMPTY_SCENE, effects: [], problem: 'unknown item fix' });
      expect(result.scene).toBe(EMPTY_SCENE);
    });

    it('is a problem for a duplicate state', () => {
      const result = reduceBoard(BOTH, { kind: 'board.addState', item: 'fix', id: 'q1' });

      expect(result.problem).toBe('duplicate state q1');
      expect(result.scene).toBe(BOTH);
    });
  });

  describe('board.addTransition', () => {
    it('adds the transition and reveals the edge, with its states, when revealed is a list', () => {
      const { scene, problems } = run(
        BOTH,
        { kind: 'board.addState', item: 'fix', id: 'q4' },
        { kind: 'board.addTransition', item: 'fix', from: 'q3', to: 'q4', symbols: ['2'] },
      );

      expect(problems).toEqual([]);
      expect(automaton(scene, 'fix').spec.transitions.at(-1)).toEqual({
        from: 'q3',
        to: 'q4',
        symbols: ['2'],
      });
      expect(automaton(scene, 'fix').revealed).toEqual(['state:q4', 'state:q3', 'edge:q3>q4']);
    });

    it('merges its symbols into an existing pair', () => {
      const { scene } = run(BOTH, {
        kind: 'board.addTransition',
        item: 'wrong',
        from: 'q3',
        to: 'q3',
        symbols: ['1', '2'],
      });
      const transitions = automaton(scene, 'wrong').spec.transitions;

      expect(transitions).toHaveLength(WRONG.transitions.length);
      expect(transitions.find((t) => t.from === 'q3' && t.to === 'q3')?.symbols).toEqual([
        '0',
        '1',
        '2',
      ]);
    });

    it('needs both states', () => {
      const result = reduceBoard(BOTH, {
        kind: 'board.addTransition',
        item: 'fix',
        from: 'q0',
        to: 'q9',
        symbols: ['2'],
      });

      expect(result.problem).toBe('unknown state q9 in q0>q9');
      expect(result.scene).toBe(BOTH);
    });

    it('never gives a DFA a second move on one symbol', () => {
      const result = reduceBoard(BOTH, {
        kind: 'board.addTransition',
        item: 'wrong',
        from: 'q0',
        to: 'q2',
        symbols: ['1'],
      });

      expect(result.problem).toBe('two moves from q0 on 1');
      expect(result.scene).toBe(BOTH);
    });
  });

  describe('board.reveal', () => {
    it('reveals everything without els', () => {
      const { scene } = run(BOTH, { kind: 'board.reveal', item: 'fix' });

      expect(automaton(scene, 'fix').revealed).toBe('all');
    });

    it('reveals an edge with both its states, and start with the start state', () => {
      const { scene } = run(
        BOTH,
        { kind: 'board.reveal', item: 'fix', els: ['start'] },
        { kind: 'board.reveal', item: 'fix', els: ['edge:q1>q2', 'state:q3'] },
      );

      expect(automaton(scene, 'fix').revealed).toEqual([
        'state:q0',
        'start',
        'state:q1',
        'state:q2',
        'edge:q1>q2',
        'state:q3',
      ]);
    });

    it('applies the known refs and reports the unknown ones', () => {
      const result = reduceBoard(BOTH, {
        kind: 'board.reveal',
        item: 'fix',
        els: ['state:q0', 'edge:q9>q1'],
      });

      expect(result.problem).toBe('unknown element edge:q9>q1');
      expect(automaton(result.scene, 'fix').revealed).toEqual(['state:q0']);
      expect(result.scene.rev).toBe(BOTH.rev + 1);
    });

    it('reveal before the automaton exists is a problem, not a throw', () => {
      const result = reduceBoard(EMPTY_SCENE, { kind: 'board.reveal', item: 'fix' });

      expect(result).toEqual({ scene: EMPTY_SCENE, effects: [], problem: 'unknown item fix' });
    });

    it('changes nothing when everything asked is already revealed', () => {
      const result = reduceBoard(BOTH, { kind: 'board.reveal', item: 'wrong', els: ['start'] });

      expect(result).toEqual({ scene: BOTH, effects: [], problem: null });
      expect(result.scene).toBe(BOTH);
    });
  });

  describe('board.highlight', () => {
    it('adds the element, then removes it', () => {
      const on = run(BOTH, { kind: 'board.highlight', item: 'wrong', el: 'edge:q0>q0', on: true });
      expect(automaton(on.scene, 'wrong').highlighted).toEqual(['edge:q0>q0']);

      const off = run(on.scene, {
        kind: 'board.highlight',
        item: 'wrong',
        el: 'edge:q0>q0',
        on: false,
      });
      expect(automaton(off.scene, 'wrong').highlighted).toEqual([]);
      expect(off.problems).toEqual([]);
    });

    it('is a problem for an element the automaton lacks', () => {
      const result = reduceBoard(BOTH, {
        kind: 'board.highlight',
        item: 'wrong',
        el: 'state:qd',
        on: true,
      });

      expect(result.problem).toBe('unknown element state:qd');
      expect(result.scene).toBe(BOTH);
    });
  });

  describe('board.pulse', () => {
    it('emits a pulse for a revealed element, and leaves the scene as it was', () => {
      const result = reduceBoard(BOTH, { kind: 'board.pulse', item: 'wrong', el: 'state:q3' });

      expect(result).toEqual({
        scene: BOTH,
        effects: [{ type: 'pulse', item: 'wrong', el: 'state:q3' }],
        problem: null,
      });
    });

    it('is a problem for an element that is not shown', () => {
      const result = reduceBoard(BOTH, { kind: 'board.pulse', item: 'fix', el: 'state:qd' });

      expect(result).toEqual({ scene: BOTH, effects: [], problem: 'not shown state:qd' });
    });
  });

  describe('board.note', () => {
    it('adds a note, then replaces it', () => {
      const added = run(BOTH, {
        kind: 'board.note',
        item: 'why',
        text: 'This loop lets 1010 in.',
        near: { item: 'wrong', el: 'edge:q0>q0' },
      }).scene;
      expect(note(added, 'why')).toEqual({
        kind: 'note',
        id: 'why',
        text: 'This loop lets 1010 in.',
        near: { item: 'wrong', el: 'edge:q0>q0' },
      });

      const replaced = run(added, { kind: 'board.note', item: 'why', text: 'Look here.' }).scene;
      expect(replaced.items.map((i) => i.id)).toEqual(['wrong', 'fix', 'why']);
      expect(note(replaced, 'why')).toMatchObject({ text: 'Look here.', near: null });
    });

    it('puts the note in without near when near is unknown, and reports it', () => {
      const unknownItem = run(BOTH, {
        kind: 'board.note',
        item: 'why',
        text: 'Here.',
        near: { item: 'gone', el: 'state:q0' },
      });
      const unknownEl = run(BOTH, {
        kind: 'board.note',
        item: 'why',
        text: 'Here.',
        near: { item: 'wrong', el: 'state:q9' },
      });

      expect(unknownItem.problems).toEqual(['unknown item gone']);
      expect(note(unknownItem.scene, 'why').near).toBeNull();
      expect(unknownEl.problems).toEqual(['unknown element state:q9']);
      expect(note(unknownEl.scene, 'why').near).toBeNull();
    });
  });

  describe('board.trace', () => {
    it('adds a trace that runs its spec on the input, shows no step yet, and focuses it', () => {
      const { scene, problems } = run(BOTH, {
        kind: 'board.trace',
        item: 'run',
        spec: WRONG,
        input: '1010',
      });

      expect(problems).toEqual([]);
      expect(trace(scene, 'run')).toEqual({
        kind: 'trace',
        id: 'run',
        title: null,
        spec: WRONG,
        input: '1010',
        run: runAutomaton(WRONG, '1010'),
        shown: 0,
        subject: 'tutor',
        on: null,
        verdict: null,
      });
      expect(scene.focus).toBe('run');
    });

    it("sets the automaton it's on to the run's starting states", () => {
      const nfa: AutomatonSpec = {
        kind: 'nfa',
        states: [{ id: 'p0' }, { id: 'p1', accept: true }],
        start: 'p0',
        transitions: [{ from: 'p0', to: 'p1', symbols: [EPSILON] }],
      };
      const { scene } = run(
        EMPTY_SCENE,
        { kind: 'board.automaton', item: 'guess', spec: nfa },
        {
          kind: 'board.trace',
          item: 'run',
          spec: nfa,
          input: '',
          on: 'guess',
          subject: 'student',
          title: 'Your NFA',
        },
      );

      expect(automaton(scene, 'guess').current).toEqual(['p0', 'p1']);
      expect(trace(scene, 'run')).toMatchObject({
        on: 'guess',
        subject: 'student',
        title: 'Your NFA',
      });
    });

    it('is a problem when the automaton it names is unknown, and the trace still goes in', () => {
      const { scene, problems } = run(BOTH, {
        kind: 'board.trace',
        item: 'run',
        spec: WRONG,
        input: '1010',
        on: 'gone',
      });

      expect(problems).toEqual(['unknown item gone']);
      expect(trace(scene, 'run').on).toBeNull();
    });
  });

  describe('board.traceStep', () => {
    const traced = run(BOTH, {
      kind: 'board.trace',
      item: 'run',
      spec: WRONG,
      input: '1010',
      on: 'wrong',
    }).scene;

    it('shows the next step, and glides the automaton along its edges', () => {
      const { scene, effects } = run(traced, { kind: 'board.traceStep', item: 'run' });

      expect(trace(scene, 'run').shown).toBe(1);
      expect(effects).toEqual([{ type: 'glide', item: 'wrong', edges: ['edge:q0>q0'] }]);
      expect(automaton(scene, 'wrong').current).toEqual(['q0']);
    });

    it('jumps to a given step, clamped to the number of steps', () => {
      const jumped = run(traced, { kind: 'board.traceStep', item: 'run', step: 2 });
      expect(trace(jumped.scene, 'run').shown).toBe(2);
      expect(jumped.effects).toEqual([{ type: 'glide', item: 'wrong', edges: ['edge:q0>q1'] }]);
      expect(automaton(jumped.scene, 'wrong').current).toEqual(['q1']);

      const past = run(traced, { kind: 'board.traceStep', item: 'run', step: 9 });
      expect(trace(past.scene, 'run').shown).toBe(4);
      expect(automaton(past.scene, 'wrong').current).toEqual(['q3']);
    });

    it('stops at the end of the run', () => {
      const end = run(traced, { kind: 'board.traceStep', item: 'run', step: 4 }).scene;
      const result = reduceBoard(end, { kind: 'board.traceStep', item: 'run' });

      expect(result).toEqual({ scene: end, effects: [], problem: null });
    });

    it('back at step 0 the automaton is at its start again', () => {
      const two = run(traced, { kind: 'board.traceStep', item: 'run', step: 2 }).scene;
      const { scene, effects } = run(two, { kind: 'board.traceStep', item: 'run', step: 0 });

      expect(trace(scene, 'run').shown).toBe(0);
      expect(automaton(scene, 'wrong').current).toEqual(['q0']);
      expect(effects).toEqual([]);
    });

    it('steps a trace that is on no automaton without effects', () => {
      const alone = run(BOTH, { kind: 'board.trace', item: 'run', spec: WRONG, input: '00' });
      const { scene, effects } = run(
        alone.scene,
        { kind: 'board.traceStep', item: 'run' },
        { kind: 'board.traceStep', item: 'run' },
      );

      expect(trace(scene, 'run').shown).toBe(2);
      expect(trace(scene, 'run').run.stuckAt).toBe(1);
      expect(effects).toEqual([]);
    });

    it('is a problem on an unknown trace', () => {
      expect(reduceBoard(BOTH, { kind: 'board.traceStep', item: 'wrong' }).problem).toBe(
        'unknown item wrong',
      );
    });
  });

  describe('board.verdict', () => {
    it('sets the verdict', () => {
      const { scene } = run(
        BOTH,
        { kind: 'board.trace', item: 'run', spec: WRONG, input: '1010', subject: 'student' },
        {
          kind: 'board.verdict',
          item: 'run',
          got: 'accept',
          expected: 'reject',
          note: "1010 doesn't start with 010.",
        },
      );

      expect(trace(scene, 'run').verdict).toEqual({
        got: 'accept',
        expected: 'reject',
        note: "1010 doesn't start with 010.",
      });
    });

    it('leaves out what it was not given', () => {
      const { scene } = run(
        BOTH,
        { kind: 'board.trace', item: 'run', spec: WRONG, input: '1010' },
        { kind: 'board.verdict', item: 'run', got: 'reject' },
      );

      expect(trace(scene, 'run').verdict).toEqual({ got: 'reject', expected: null, note: null });
    });
  });

  describe('board.focus', () => {
    it('focuses an item, and null means everything', () => {
      const one = run(BOTH, { kind: 'board.focus', item: 'wrong' }).scene;
      expect(one.focus).toBe('wrong');

      const all = run(one, { kind: 'board.focus' }).scene;
      expect(all.focus).toBeNull();
      expect(all.rev).toBe(one.rev + 1);
    });

    it('is a problem for an unknown item', () => {
      expect(reduceBoard(BOTH, { kind: 'board.focus', item: 'gone' })).toEqual({
        scene: BOTH,
        effects: [],
        problem: 'unknown item gone',
      });
    });
  });

  describe('board.clear', () => {
    const noted = run(
      BOTH,
      {
        kind: 'board.note',
        item: 'why',
        text: 'This loop.',
        near: { item: 'wrong', el: 'state:q0' },
      },
      { kind: 'board.note', item: 'aside', text: 'Unrelated.' },
      { kind: 'board.focus', item: 'wrong' },
    ).scene;

    it('removes one item and the notes near it', () => {
      const { scene } = run(noted, { kind: 'board.clear', item: 'wrong' });

      expect(scene.items.map((i) => i.id)).toEqual(['fix', 'aside']);
      expect(scene.focus).toBeNull();
    });

    it('removes everything', () => {
      const { scene } = run(noted, { kind: 'board.clear' });

      expect(scene).toEqual({ items: [], focus: null, rev: noted.rev + 1 });
    });

    it('is a problem for an unknown item', () => {
      expect(reduceBoard(noted, { kind: 'board.clear', item: 'gone' }).problem).toBe(
        'unknown item gone',
      );
    });
  });

  it('bumps rev on every change', () => {
    let scene = EMPTY_SCENE;
    const revs: number[] = [];
    for (const action of [
      DRAW_WRONG,
      DRAW_FIX_HIDDEN,
      { kind: 'board.reveal', item: 'fix', els: ['start'] },
      { kind: 'board.addState', item: 'fix', id: 'q4' },
      { kind: 'board.highlight', item: 'fix', el: 'state:q0', on: true },
      { kind: 'board.note', item: 'why', text: 'Why.' },
      { kind: 'board.trace', item: 'run', spec: WRONG, input: '1' },
      { kind: 'board.traceStep', item: 'run' },
      { kind: 'board.verdict', item: 'run', got: 'reject' },
      { kind: 'board.focus' },
      { kind: 'board.clear', item: 'why' },
      { kind: 'board.clear' },
    ] satisfies BoardAction[]) {
      scene = reduceBoard(scene, action).scene;
      revs.push(scene.rev);
    }

    expect(revs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('twelve bad actions in a row leave the scene unchanged and never throw', () => {
    const bad = [
      { kind: 'board.reveal', item: 'gone' },
      { kind: 'board.reveal', item: 'fix', els: ['state:q9'] },
      { kind: 'board.addState', item: 'gone', id: 'q1' },
      { kind: 'board.addState', item: 'fix', id: 'q1' },
      { kind: 'board.addTransition', item: 'fix', from: 'q9', to: 'q1', symbols: ['0'] },
      { kind: 'board.addTransition', item: 'fix', from: 'q0', to: 'q1', symbols: [EPSILON] },
      { kind: 'board.highlight', item: 'wrong', el: 'edge:q1>q0', on: true },
      { kind: 'board.pulse', item: 'fix', el: 'state:q0' },
      { kind: 'board.traceStep', item: 'gone' },
      { kind: 'board.verdict', item: 'fix', got: 'accept' },
      { kind: 'board.focus', item: 'gone' },
      { kind: 'board.clear', item: 'gone' },
    ] satisfies BoardAction[];
    const frozen = deepFreeze(structuredClone(BOTH));
    let scene = frozen;
    const problems: string[] = [];

    for (const action of bad) {
      const result = reduceBoard(scene, action);
      scene = result.scene;
      if (result.problem) problems.push(result.problem);
    }

    expect(scene).toBe(frozen);
    expect(problems).toHaveLength(12);
  });

  it('never changes the scene it is given', () => {
    const scene = deepFreeze(
      run(
        BOTH,
        { kind: 'board.note', item: 'why', text: 'Why.', near: { item: 'wrong', el: 'state:q0' } },
        { kind: 'board.trace', item: 'run', spec: WRONG, input: '1010', on: 'wrong' },
      ).scene,
    );

    expect(() =>
      run(
        scene,
        { kind: 'board.reveal', item: 'fix', els: ['edge:q0>q1'] },
        { kind: 'board.addState', item: 'fix', id: 'q4' },
        { kind: 'board.addTransition', item: 'fix', from: 'q3', to: 'q4', symbols: ['2'] },
        { kind: 'board.addTransition', item: 'wrong', from: 'q3', to: 'q3', symbols: ['2'] },
        { kind: 'board.highlight', item: 'wrong', el: 'state:q0', on: true },
        { kind: 'board.traceStep', item: 'run' },
        { kind: 'board.verdict', item: 'run', got: 'accept' },
        { kind: 'board.reveal', item: 'fix' },
        { kind: 'board.clear', item: 'wrong' },
      ),
    ).not.toThrow();
  });

  it('reports an action kind it does not know', () => {
    const result = reduceBoard(BOTH, {
      kind: 'board.erase',
      item: 'wrong',
    } as unknown as BoardAction);

    expect(result).toEqual({ scene: BOTH, effects: [], problem: 'unknown action board.erase' });
  });
});

describe('elementsOf', () => {
  it('lists start, then the states, then the merged edges', () => {
    expect(elementsOf(WRONG)).toEqual([
      'start',
      'state:q0',
      'state:q1',
      'state:q2',
      'state:q3',
      'edge:q0>q1',
      'edge:q1>q2',
      'edge:q2>q3',
      'edge:q3>q3',
      'edge:q0>q0',
    ]);
  });
});

describe('isRevealed', () => {
  it("is true for everything when revealed is 'all', else for what the list holds", () => {
    expect(isRevealed(automaton(BOTH, 'wrong'), 'state:q0')).toBe(true);
    expect(isRevealed(automaton(BOTH, 'fix'), 'state:q0')).toBe(false);

    const shown = run(BOTH, { kind: 'board.reveal', item: 'fix', els: ['state:q0'] }).scene;
    expect(isRevealed(automaton(shown, 'fix'), 'state:q0')).toBe(true);
    expect(isRevealed(automaton(shown, 'fix'), 'state:q1')).toBe(false);
  });
});
