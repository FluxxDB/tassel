import { describe, expect, it } from 'vitest';
import {
  DEAD,
  EPSILON,
  isDfaReading,
  isDfaVerdict,
  isVisionDebug,
  PREDICATES,
} from '../src/vision/contract';
import fixtures from '../src/vision/fixtures.json';

const readings = Object.entries(fixtures.readings);
const wrong = fixtures.readings['demo-wrong'];
const [state] = wrong.states;
const [transition] = wrong.transitions;
const readback = fixtures.events.find((e) => e.kind === 'readback');
const verdict = readback?.verdict;

/** `demo-wrong` with its first state, or its first transition, replaced. */
const withState = (s: unknown) => ({ ...wrong, states: [s, ...wrong.states.slice(1)] });
const withTransition = (t: unknown) => ({
  ...wrong,
  transitions: [t, ...wrong.transitions.slice(1)],
});
const { r: _r, ...stateWithoutR } = state;

/** Each example event against the guards that check it. */
function passes(event: Record<string, unknown>): boolean {
  switch (event.kind) {
    case 'readback':
      return (
        (event.reading === null || isDfaReading(event.reading)) &&
        (event.verdict === null || isDfaVerdict(event.verdict))
      );
    case 'vision-debug':
      return isVisionDebug(event.debug);
    case 'pen':
      return typeof event.busy === 'boolean';
    default:
      return false;
  }
}

describe('isDfaReading', () => {
  it.each(readings)('accepts the %s fixture', (_, reading) => {
    expect(isDfaReading(reading)).toBe(true);
  });

  it.each([
    ['null', null],
    ['an empty object', {}],
    ['a state missing r', withState(stateWithoutR)],
    ['symbols "0"', withTransition({ ...transition, symbols: '0' })],
  ])('refuses %s', (_, value) => {
    expect(isDfaReading(value)).toBe(false);
  });
});

describe('the events', () => {
  it.each(fixtures.events)('the $kind example passes its guard', (event) => {
    expect(passes(event)).toBe(true);
  });
});

// Beyond the brief's examples.

describe('the constants', () => {
  it('match the Python contract', () => {
    expect([EPSILON, DEAD]).toEqual(['ε', '∅']);
    expect(PREDICATES).toEqual([
      'diagram_attempt_complete',
      'new_work_worth_checking',
      'student_seems_stuck',
      'not_schoolwork',
    ]);
  });
});

describe('isDfaReading, field by field', () => {
  it.each([
    ['a version other than 1', { ...wrong, version: 2 }],
    ['an unknown source', { ...wrong, source: 'camera' }],
    ['an unknown kind', { ...wrong, kind: 'pda' }],
    ['a numeric frame id', { ...wrong, frame_id: 7 }],
    ['a missing uncertain list', { ...wrong, uncertain: undefined }],
    ['an alphabet of numbers', { ...wrong, alphabet: [0, 1] }],
    ['a page whose quad is a string', { ...wrong, page: { ...wrong.page, quad: 'tl,tr,br,bl' } }],
    ['a fractional page width', { ...wrong, page: { ...wrong.page, width: 1568.5 } }],
    ['a language without its regex', { ...wrong, language: { confidence: 0.9 } }],
    ['a problem kind of "none"', { ...wrong, problem_kind: 'none' }],
    ['a string confidence', withState({ ...state, confidence: '0.95' })],
    ['a fractional mark', withState({ ...state, mark: 1.5 })],
    ['a center without y', withState({ ...state, center: { x: 0.18 } })],
    ['a state that is a string', withState('q0')],
    ['a box without h', withTransition({ ...transition, label_box: { x: 0, y: 0, w: 0.04 } })],
    ['an infinite confidence', withTransition({ ...transition, confidence: Infinity })],
    ['a transitions object', { ...wrong, transitions: {} }],
  ])('refuses %s', (_, value) => {
    expect(isDfaReading(value)).toBe(false);
  });

  it('accepts nulls where the contract allows them, and fields it does not declare', () => {
    expect(
      isDfaReading({
        ...wrong,
        frame_id: '7c4fd2d2-8d1f-4a51-9d0e-3cf0e4b5d2a1',
        source: 'paper',
        page: null,
        problem: null,
        problem_kind: null,
        language: { regex: null, confidence: 0 },
        states: [{ ...state, mark: null, snapped: false }],
        transitions: [{ ...transition, label_box: null, mark: null }],
        added_later: true,
      }),
    ).toBe(true);
  });
});

describe('isDfaVerdict', () => {
  const counterexample = verdict?.counterexample;

  it('accepts the readback example and the verdict of an unreadable page', () => {
    expect(isDfaVerdict(verdict)).toBe(true);
    expect(
      isDfaVerdict({
        status: 'unreadable',
        computed: false,
        counterexample: null,
        issues: [],
        fixes: [],
        reference: null,
      }),
    ).toBe(true);
  });

  it.each([
    ['null', null],
    ['an unknown status', { ...verdict, status: 'maybe' }],
    ['a string computed flag', { ...verdict, computed: 'true' }],
    ['an unknown issue kind', { ...verdict, issues: [{ kind: 'vibes', states: [], symbols: [] }] }],
    [
      'an unknown fix kind',
      { ...verdict, fixes: [{ kind: 'erase', state: 'q0', symbol: null, target: null }] },
    ],
    [
      'a flat student trace',
      { ...verdict, counterexample: { ...counterexample, student_trace: ['q0'] } },
    ],
    [
      'an unknown direction',
      { ...verdict, counterexample: { ...counterexample, direction: 'up' } },
    ],
    [
      'a fractional blame step',
      {
        ...verdict,
        counterexample: { ...counterexample, blame: { ...counterexample?.blame, step: 1.5 } },
      },
    ],
    [
      'an unknown reference source',
      { ...verdict, reference: { ...verdict?.reference, source: 'web' } },
    ],
    [
      'a machine whose moves are lists',
      {
        ...verdict,
        reference: {
          ...verdict?.reference,
          machine: { ...verdict?.reference.machine, transitions: { q0: { '0': ['q1'] } } },
        },
      },
    ],
  ])('refuses %s', (_, value) => {
    expect(isDfaVerdict(value)).toBe(false);
  });
});

describe('isVisionDebug', () => {
  const debugs = fixtures.events.filter((e) => e.kind === 'vision-debug').map((e) => e.debug);

  it('has one example per stage', () => {
    expect(debugs.map((d) => d?.stage)).toEqual(['gate', 'check', 'policy']);
  });

  it.each([
    ['null', null],
    ['an unknown stage', { stage: 'vibes' }],
    ['the prototype as a stage', { stage: 'constructor' }],
    ['a gate prob for an unknown predicate', { ...debugs[0], probs: { is_it_lunch: 0.5 } }],
    ['a gate prob that is a string', { ...debugs[0], probs: { not_schoolwork: '0.1' } }],
    ['an unknown gate reason', { ...debugs[0], reason: 'boredom' }],
    ['an unknown check status', { ...debugs[1], status: 'meh' }],
    ['a fractional check time', { ...debugs[1], ms: 2.5 }],
    ['an unknown policy action', { ...debugs[2], action: 'shout' }],
    ['an unknown rung', { ...debugs[2], rung: 'lecture' }],
  ])('refuses %s', (_, value) => {
    expect(isVisionDebug(value)).toBe(false);
  });

  it('accepts a failed check and a holding line without a rung', () => {
    expect(
      isVisionDebug({ stage: 'check', status: 'timeout', witness: null, blame: null, ms: 2000 }),
    ).toBe(true);
    expect(
      isVisionDebug({ stage: 'policy', action: 'holding-line', rung: null, why: 'slow check' }),
    ).toBe(true);
  });
});
