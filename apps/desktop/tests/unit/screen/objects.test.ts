import { describe, expect, it } from 'vitest';
import {
  editScreenObjects,
  screenBoardSnapshot,
  screenInventory,
} from '../../../src/renderer/src/screen/objects';
import type { ScreenBoard, ScreenMark } from '../../../src/shared/screen-bridge';

const marks: ScreenMark[] = [
  {
    id: 'circle',
    kind: 'circle',
    author: 'tutor',
    points: [
      { x: 0.2, y: 0.3 },
      { x: 0.4, y: 0.5 },
    ],
  },
];
const board: ScreenBoard = {
  scene: { items: [{ id: 'note', kind: 'note', text: 'hello', near: null }], focus: null, rev: 1 },
  layouts: {},
  placements: { note: { x: 0.5, y: 0.2, w: 0.2, h: 0.2 } },
};
describe('persistent screen objects', () => {
  it('lists and removes an invisible circle without a screenshot', () => {
    expect(screenInventory(marks, board).map((o) => o.id)).toEqual(['circle', 'board:note']);
    expect(
      editScreenObjects(marks, board, { operation: 'remove', ids: ['circle'] })?.marks,
    ).toEqual([]);
  });
  it('moves and recolors paths and whiteboard items atomically', () => {
    const result = editScreenObjects(marks, board, {
      operation: 'move',
      ids: ['circle', 'board:note'],
      dx: 0.1,
      dy: 0.1,
    });
    expect(result?.marks[0].points[0].x).toBeCloseTo(0.3);
    expect(result?.placements.note.x).toBeCloseTo(0.6);
    expect(
      editScreenObjects(marks, board, { operation: 'recolor', ids: ['circle'], color: 'red' })
        ?.marks[0].color,
    ).toBe('red');
    expect(
      editScreenObjects(marks, board, { operation: 'move', ids: ['circle'], dx: 0.9, dy: 0 }),
    ).toBeNull();
    expect(marks[0].points[0].x).toBe(0.2);
    expect(editScreenObjects(marks, board, { operation: 'remove', ids: ['missing'] })).toBeNull();
  });
});

it('publishes only explicitly positioned overlay items, including inherited-name IDs safely', () => {
  const normal = {
    ...board,
    scene: {
      ...board.scene,
      items: [
        ...board.scene.items,
        { id: 'toString', kind: 'note' as const, text: 'normal board', near: null },
      ],
    },
  };
  expect(screenBoardSnapshot(normal, board.placements).scene.items.map((item) => item.id)).toEqual([
    'note',
  ]);
  expect(screenInventory(marks, normal).map((item) => item.id)).toEqual(['circle', 'board:note']);
});
