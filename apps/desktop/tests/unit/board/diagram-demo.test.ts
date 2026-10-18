// diagram-demo, the fake tutor's script for a board.diagram: every action it sends parses and
// applies without a problem, in order, and leaves the three-zone network drawn whole, Router A
// highlighted, and a note of real lines beside it.
import { type BoardAction, parseAction } from '@tassel/shared/beats';
import { describe, expect, it } from 'vitest';
import { EMPTY_SCENE, reduceBoard } from '../../../src/renderer/src/board/scene/reduce';
import type { DiagramItem, NoteItem } from '../../../src/renderer/src/board/scene/types';
import diagramDemo from '../../../src/renderer/src/tutor/scripts/diagram-demo.json';
import type { FakeScript } from '../../../src/renderer/src/tutor/types';
import { NETWORK } from './fixtures';

const script = diagramDemo as FakeScript;

describe('diagram-demo', () => {
  it('draws the network, highlights Router A and notes it, with no problem', () => {
    let scene = EMPTY_SCENE;
    for (const { event } of script.steps) {
      if (event.type !== 'actions') continue;
      for (const data of event.actions) {
        const action = parseAction(data);
        expect(action, JSON.stringify(data)).not.toBeNull();
        const result = reduceBoard(scene, action as BoardAction);
        expect(result.problem, JSON.stringify(data)).toBeNull();
        scene = result.scene;
      }
    }
    const [net, note] = scene.items as [DiagramItem, NoteItem];
    expect(scene.items).toHaveLength(2);
    expect(net.spec).toEqual(NETWORK);
    expect(net.revealed).toBe('all');
    expect(net.highlighted).toEqual(['node:rA']);
    expect(note.near).toEqual({ item: 'net', el: 'node:rA' });
    expect(note.text.split('\n')).toHaveLength(3);
  });

  it('keeps time, and ends listening', () => {
    const times = script.steps.map((step) => step.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(script.steps.at(-1)?.event).toEqual({ type: 'state', state: 'listening' });
  });
});
