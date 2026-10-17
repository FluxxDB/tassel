// board-demo, the fake tutor's script for Ada's board (Task 5): every action it sends parses and
// applies without a problem, in order, and leaves the reference DFA drawn whole, qd highlighted.
import { type BoardAction, parseAction } from '@tassel/shared/beats';
import { describe, expect, it } from 'vitest';
import { EMPTY_SCENE, reduceBoard } from '../../../src/renderer/src/board/scene/reduce';
import type { AutomatonItem } from '../../../src/renderer/src/board/scene/types';
import boardDemo from '../../../src/renderer/src/tutor/scripts/board-demo.json';
import type { FakeScript } from '../../../src/renderer/src/tutor/types';
import { CORRECT } from './fixtures';

const script = boardDemo as FakeScript;

describe('board-demo', () => {
  it('draws the reference DFA, step by step, with no problem', () => {
    let scene = EMPTY_SCENE;
    let pulses = 0;
    for (const { event } of script.steps) {
      if (event.type !== 'actions') continue;
      for (const data of event.actions) {
        const action = parseAction(data);
        expect(action, JSON.stringify(data)).not.toBeNull();
        const result = reduceBoard(scene, action as BoardAction);
        expect(result.problem, JSON.stringify(data)).toBeNull();
        pulses += result.effects.filter((effect) => effect.type === 'pulse').length;
        scene = result.scene;
      }
    }
    const [fix] = scene.items as AutomatonItem[];
    expect(scene.items).toHaveLength(1);
    expect(fix.spec).toEqual(CORRECT);
    expect([...(fix.revealed as string[])].sort()).toEqual(
      ['start', 'state:q0', 'state:q1', 'state:q2', 'state:q3', 'state:qd']
        .concat(['edge:q0>q1', 'edge:q1>q2', 'edge:q2>q3', 'edge:q3>q3'])
        .concat(['edge:q0>qd', 'edge:q1>qd', 'edge:q2>qd', 'edge:qd>qd'])
        .sort(),
    );
    expect(fix.highlighted).toEqual(['state:qd']);
    expect(pulses).toBe(1);
  });

  it('keeps the brief times: Ada draws from 2.7 s and is listening again at 8.4 s', () => {
    const times = script.steps.map((step) => step.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    const actions = script.steps.filter((step) => step.event.type === 'actions');
    expect(actions.map((step) => step.at)).toEqual([
      2700, 3000, 3600, 4200, 4800, 5400, 6000, 6600, 7200, 7800,
    ]);
    expect(script.steps.at(-1)).toEqual({ at: 8400, event: { type: 'state', state: 'listening' } });
  });
});
