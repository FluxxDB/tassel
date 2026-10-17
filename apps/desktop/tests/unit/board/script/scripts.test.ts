import { type BeatAction, type BeatDoc, parseAction, parseBeatDoc } from '@tassel/shared/beats';
import { describe, expect, it } from 'vitest';
import { compileScript } from '../../../../src/renderer/src/board/script/compile';
import { SCRIPTS } from '../../../../src/renderer/src/tutor/create-client';
import type { FakeScript } from '../../../../src/renderer/src/tutor/types';

const beatsOf = (script: FakeScript): BeatDoc[] =>
  script.steps.flatMap(({ event }) => (event.type === 'beat' ? [event.beat] : []));

const mark = (m: Extract<BeatAction, { kind: 'paper.mark' }>['mark']): BeatAction => ({
  kind: 'paper.mark',
  mark: m,
});
const step = (id: string, n: number, el: string) =>
  mark({ type: 'step', id, n, target: { el } as { el: `edge:${string}>${string}` } });

describe('the fake tutor’s scripts', () => {
  it('every registered script compiles, and every beat parses with no problems', () => {
    expect(Object.keys(SCRIPTS)).toEqual(
      expect.arrayContaining(['dfa-opening', 'board-demo', 'marks-demo']),
    );
    for (const [name, script] of Object.entries(SCRIPTS)) {
      const { steps } = compileScript(script, name);
      for (const { event } of steps) {
        if (event.type === 'beat') {
          expect(parseBeatDoc(event.beat), `${name}: ${event.beat.id}`).toEqual({
            doc: event.beat,
            problems: [],
          });
        }
        if (event.type === 'actions') {
          for (const action of event.actions) expect(parseAction(action), name).toEqual(action);
        }
      }
    }
  });

  it('dfa-opening passes through unchanged', () => {
    expect(compileScript(SCRIPTS['dfa-opening'], 'dfa-opening')).toBe(SCRIPTS['dfa-opening']);
  });

  it("marks-demo speaks Task 7's marks in two beats, s1 on the second line's fourth word", () => {
    const beats = beatsOf(compileScript(SCRIPTS['marks-demo'], 'marks-demo'));
    expect(beats.map((b) => b.text)).toEqual([
      "Let's walk 1010 through your DFA, one symbol at a time.",
      'First a 1, which keeps you on q0, then a 0 to q1, a 1 to q2, and a 0 to q3. This loop is what lets 1010 in.',
    ]);
    expect(beats.flatMap((b) => b.markers.map((m) => m.action))).toEqual([
      { kind: 'paper.freeze', frame: { kind: 'fixture', name: 'dfa-wrong' } },
      step('s1', 1, 'edge:q0>q0'),
      step('s2', 2, 'edge:q0>q1'),
      step('s3', 3, 'edge:q1>q2'),
      step('s4', 4, 'edge:q2>q3'),
      mark({ type: 'circle', id: 'circle', target: { el: 'edge:q0>q0' }, wash: true }),
      mark({
        type: 'callout',
        id: 'callout',
        target: { el: 'edge:q0>q0' },
        text: 'A leading 1 loops here, so 1010 gets in',
      }),
    ]);
    const [s1] = beats[1].markers;
    expect(beats[1].words[s1.word].text).toBe('which');
    expect(s1.word).toBe(3);
  });
});
