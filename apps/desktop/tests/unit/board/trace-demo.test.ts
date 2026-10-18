import type { BoardAction, PaperAction } from '@tassel/shared/beats';
import { afterEach, expect, it } from 'vitest';
import { createBeatPlayer } from '../../../src/renderer/src/board/beats/player';
import { applyPaperAction, useMarksStore } from '../../../src/renderer/src/board/marks/marks-store';
import { planPaperTrace } from '../../../src/renderer/src/board/marks/trace-marks';
import { EMPTY_SCENE, reduceBoard } from '../../../src/renderer/src/board/scene/reduce';
import { compileScript } from '../../../src/renderer/src/board/script/compile';
import { SCRIPTS } from '../../../src/renderer/src/tutor/create-client';
import { CORRECT } from './fixtures';

afterEach(() => useMarksStore.getState().reset());
it('trace-demo times its real board and queued paper actions to heard words', async () => {
  expect(SCRIPTS['trace-demo']).toBeDefined();
  const script = compileScript(SCRIPTS['trace-demo'], 'trace-demo');
  expect(script.steps.slice(0, 3).map((s) => s.at)).toEqual([0, 800, 1500]);
  expect(
    script.steps.find((s) => s.event.type === 'state' && s.event.state === 'speaking')?.at,
  ).toBe(2500);
  expect(script.steps.find((s) => s.event.type === 'beat')?.at).toBe(2650);
  let scene = EMPTY_SCENE;
  const player = createBeatPlayer({
    dispatch(actions) {
      for (const action of actions as (BoardAction | PaperAction)[]) {
        if (action.kind.startsWith('paper.')) applyPaperAction(action as PaperAction);
        else {
          const next = reduceBoard(scene, action as BoardAction);
          expect(next.problem).toBeNull();
          scene = next.scene;
        }
      }
    },
  });
  for (const { at, event } of script.steps) {
    if (event.type === 'beat') player.load(event.beat);
    if (event.type === 'word') player.hear({ ...event, atMs: at });
    await Promise.resolve();
  }
  const [automaton, trace] = scene.items;
  expect(automaton).toMatchObject({ kind: 'automaton', id: 'fix', spec: CORRECT, current: ['qd'] });
  expect(trace).toMatchObject({
    kind: 'trace',
    id: 'tr',
    shown: 4,
    subject: 'tutor',
    verdict: { got: 'reject' },
  });
  const paper = useMarksStore.getState().trace;
  expect(paper?.shown).toBe(4);
  expect(paper && planPaperTrace(paper.run, paper.shown)).toMatchObject({
    ring: ['q3'],
    done: true,
  });
  expect(script.steps.at(-1)?.event).toEqual({ type: 'state', state: 'listening' });
});
