import { describe, expect, it } from 'vitest';
import { runAutomaton } from '../../../../src/renderer/src/board/automata/run';
import { planPaperTrace } from '../../../../src/renderer/src/board/marks/trace-marks';
import { WRONG } from '../fixtures';

describe('planPaperTrace', () => {
  it("two steps of the wrong DFA on 1010 number q0's loop and q0→q1, ring q1 and glide on q0→q1", () => {
    expect(planPaperTrace(runAutomaton(WRONG, '1010'), 2)).toEqual({
      dots: [
        { n: 1, el: 'edge:q0>q0', repeat: 0 },
        { n: 2, el: 'edge:q0>q1', repeat: 0 },
      ],
      ring: ['q1'],
      glide: 'edge:q0>q1',
      done: false,
    });
  });
  it('a loop taken twice numbers it with repeats 0 and 1', () => {
    expect(planPaperTrace(runAutomaton(WRONG, '11'), 2)).toEqual({
      dots: [
        { n: 1, el: 'edge:q0>q0', repeat: 0 },
        { n: 2, el: 'edge:q0>q0', repeat: 1 },
      ],
      ring: ['q0'],
      glide: 'edge:q0>q0',
      done: true,
    });
  });
  it('a stuck step adds no dot and ends the trace', () => {
    expect(planPaperTrace(runAutomaton(WRONG, '00'), 2)).toEqual({
      dots: [{ n: 1, el: 'edge:q0>q1', repeat: 0 }],
      ring: [],
      glide: null,
      done: true,
    });
  });
  it('an NFA step numbers every edge it takes', () => {
    const run = runAutomaton(
      {
        kind: 'nfa',
        start: 'a',
        states: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        transitions: [
          { from: 'a', to: 'b', symbols: ['x'] },
          { from: 'a', to: 'c', symbols: ['x'] },
        ],
      },
      'x',
    );
    expect(planPaperTrace(run, 1)).toEqual({
      dots: [
        { n: 1, el: 'edge:a>b', repeat: 0 },
        { n: 1, el: 'edge:a>c', repeat: 0 },
      ],
      ring: ['b', 'c'],
      glide: 'edge:a>c',
      done: true,
    });
  });
  it('rings starting states before reading, clamps shown, and handles empty input', () => {
    const run = runAutomaton(WRONG, '1');
    expect(planPaperTrace(run, -1)).toEqual({ dots: [], ring: ['q0'], glide: null, done: false });
    expect(planPaperTrace(run, 99)).toEqual(planPaperTrace(run, 1));
    expect(planPaperTrace(runAutomaton(WRONG, ''), 0)).toEqual({
      dots: [],
      ring: ['q0'],
      glide: null,
      done: true,
    });
  });
});
