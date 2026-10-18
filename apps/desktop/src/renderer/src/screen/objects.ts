import type { ScreenBoard, ScreenColor, ScreenMark } from '../../../shared/screen-bridge';
import { SCREEN_COLORS, validPoints } from '../../../shared/screen-bridge';

export interface ScreenEdit {
  operation: 'remove' | 'clear' | 'move' | 'recolor';
  ids: string[];
  dx?: number;
  dy?: number;
  color?: ScreenColor;
}

export function screenInventory(marks: ScreenMark[], board: ScreenBoard) {
  return [
    ...marks.map((mark) => {
      // The image carries the path; the model needs stable IDs and bounds, not thousands of vertices.
      const xs = mark.points.map((p) => p.x),
        ys = mark.points.map((p) => p.y);
      const points =
        mark.kind === 'freehand'
          ? [
              { x: Math.min(...xs), y: Math.min(...ys) },
              { x: Math.max(...xs), y: Math.max(...ys) },
            ]
          : mark.points;
      return { ...mark, points, color: mark.color ?? 'violet' };
    }),
    ...board.scene.items.flatMap((item) => {
      const region = Object.hasOwn(board.placements, item.id)
        ? board.placements[item.id]
        : undefined;
      if (!region) return [];
      return [
        {
          id: `board:${item.id}`,
          kind: item.kind,
          author: 'tutor' as const,
          points: [
            { x: region.x, y: region.y },
            { x: region.x + region.w, y: region.y + region.h },
          ],
          color: region.color ?? 'violet',
          text: ('text' in item ? item.text : 'title' in item ? item.title : '')?.slice(0, 500),
        },
      ];
    }),
  ];
}

/** Atomic edits: a bad ID or an out-of-display move changes nothing. */
export function editScreenObjects(marks: ScreenMark[], board: ScreenBoard, value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const edit = value as ScreenEdit;
  if (
    !['remove', 'clear', 'move', 'recolor'].includes(edit.operation) ||
    !Array.isArray(edit.ids) ||
    edit.ids.length > 300
  )
    return null;
  const inventory = screenInventory(marks, board);
  const known = new Set(inventory.map((obj) => obj.id));
  const ids = new Set(edit.ids);
  if (ids.size !== edit.ids.length || edit.ids.some((id) => !known.has(id))) return null;
  if (
    edit.operation === 'move' &&
    (typeof edit.dx !== 'number' ||
      typeof edit.dy !== 'number' ||
      inventory
        .filter((obj) => ids.has(obj.id))
        .some(
          (obj) =>
            !validPoints(
              obj.points.map((p) => ({ x: p.x + (edit.dx ?? 0), y: p.y + (edit.dy ?? 0) })),
            ),
        ))
  )
    return null;
  if (edit.operation === 'recolor' && (!edit.color || !SCREEN_COLORS.includes(edit.color)))
    return null;
  const removing = edit.operation === 'clear' || edit.operation === 'remove';
  const nextMarks = marks.flatMap((mark) => {
    if (!ids.has(mark.id)) return [mark];
    if (removing) return [];
    if (edit.operation === 'recolor') return [{ ...mark, color: edit.color }];
    return [
      {
        ...mark,
        points: mark.points.map((p) => ({ x: p.x + (edit.dx ?? 0), y: p.y + (edit.dy ?? 0) })),
      },
    ];
  });
  const placements = { ...board.placements };
  const removed: string[] = [];
  for (const id of Object.keys(placements)) {
    if (!ids.has(`board:${id}`)) continue;
    if (removing) {
      delete placements[id];
      removed.push(id);
    } else if (edit.operation === 'recolor')
      placements[id] = { ...placements[id], color: edit.color };
    else
      placements[id] = {
        ...placements[id],
        x: placements[id].x + (edit.dx ?? 0),
        y: placements[id].y + (edit.dy ?? 0),
      };
  }
  return { marks: nextMarks, placements, removed };
}

/** Only explicitly positioned overlay items cross into the native screen canvas. */
export function screenBoardSnapshot(
  board: Omit<ScreenBoard, 'placements'>,
  placements: ScreenBoard['placements'],
): ScreenBoard {
  const items = board.scene.items.filter((item) => Object.hasOwn(placements, item.id));
  const ids = new Set(items.map((item) => item.id));
  return {
    scene: {
      ...board.scene,
      items,
      focus: board.scene.focus && ids.has(board.scene.focus) ? board.scene.focus : null,
    },
    layouts: Object.fromEntries(Object.entries(board.layouts).filter(([id]) => ids.has(id))),
    placements: Object.fromEntries(Object.entries(placements).filter(([id]) => ids.has(id))),
  };
}
