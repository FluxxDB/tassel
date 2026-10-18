// Ada's notes and the camera: the box the camera fits for a focus takes in the notes that go with
// it (beside it, or after it in the column), so none is cut off at the panel's edge; and a note by
// an item with no room to its right goes below it, or left of it when something is below.
import type { BoardAction, DiagramSpec } from '@tassel/shared/beats';
import { describe, expect, it } from 'vitest';
import { fallbackDiagramLayout } from '../../../../src/renderer/src/board/layout/fallback';
import type { DiagramLayout } from '../../../../src/renderer/src/board/layout/types';
import { diagramSizes } from '../../../../src/renderer/src/board/scene/diagram';
import {
  type BoardText,
  type Box,
  focusBox,
  ITEM_GAP,
  type MeasureText,
  NOTE_OFFSET,
  NOTE_ROW_MAX,
  NOTE_STACK_GAP,
  placeItems,
} from '../../../../src/renderer/src/board/scene/placement';
import { EMPTY_SCENE, reduceBoard } from '../../../../src/renderer/src/board/scene/reduce';
import type { BoardScene } from '../../../../src/renderer/src/board/scene/types';
import { FLOW, NETWORK } from '../fixtures';

const measure: MeasureText = (text) => ({ w: [...text].length * 8, h: 16 });
const text: BoardText = { measure, t: (key) => key };

function scene(...actions: BoardAction[]): BoardScene {
  return actions.reduce((current, action) => {
    const result = reduceBoard(current, action);
    expect(result.problem).toBeNull();
    return result.scene;
  }, EMPTY_SCENE);
}

const laid = (spec: DiagramSpec): DiagramLayout =>
  fallbackDiagramLayout(spec, diagramSizes(spec, measure));
const diagram = (item: string, spec: DiagramSpec): BoardAction => ({
  kind: 'board.diagram',
  item,
  spec,
});
const noteBy = (
  item: string,
  near: string,
  words = 'Zone A /26: 62 hosts',
  el: `node:${string}` = 'node:core',
): BoardAction => ({ kind: 'board.note', item, text: words, near: { item: near, el } });
/** A network as wide as the row allows, so a note has no room right of it. */
const WIDE: DiagramLayout = { ...laid(NETWORK), width: NOTE_ROW_MAX - 40 };

const union = (...boxes: Box[]): Box => {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: right - x, h: bottom - y };
};

describe('focusBox', () => {
  it('takes in the notes by the focused item', () => {
    const board = scene(diagram('net', NETWORK), noteBy('hosts', 'net'), noteBy('more', 'net'));
    const layouts = { net: laid(NETWORK) };
    const boxes = placeItems(board, layouts, text);
    expect(board.focus).toBe('net');
    expect(focusBox(board, boxes, 'net')).toEqual(union(boxes.net, boxes.hosts, boxes.more));
  });

  it('takes in the notes that follow it in the column, not another item or its notes', () => {
    const board = scene(
      diagram('net', NETWORK),
      { kind: 'board.note', item: 'after', text: 'Each zone is one subnet.' },
      diagram('flow', FLOW),
      { kind: 'board.note', item: 'later', text: 'Not about the network.' },
    );
    const layouts = { net: laid(NETWORK), flow: laid(FLOW) };
    const boxes = placeItems(board, layouts, text);
    expect(focusBox(board, boxes, 'net')).toEqual(union(boxes.net, boxes.after));
    expect(focusBox(board, boxes, 'flow')).toEqual(union(boxes.flow, boxes.later));
  });

  it('is everything for no focus, and nothing for an item not placed yet', () => {
    const board = scene(diagram('net', NETWORK), noteBy('hosts', 'net'));
    const boxes = placeItems(board, { net: laid(NETWORK) }, text);
    expect(focusBox(board, boxes, null)).toEqual(union(boxes.net, boxes.hosts));
    expect(focusBox(board, {}, 'net')).toBeUndefined();
  });
});

describe('a note by an item with no room to its right', () => {
  it('sits right of it while the row has room', () => {
    const board = scene(
      diagram('flow', FLOW),
      noteBy('why', 'flow', 'Only allowed ones.', 'node:db'),
    );
    const boxes = placeItems(board, { flow: laid(FLOW) }, text);
    expect(boxes.why.x).toBe(boxes.flow.x + boxes.flow.w + NOTE_OFFSET);
    expect(boxes.why.y).toBe(boxes.flow.y);
    expect(boxes.why.x + boxes.why.w).toBeLessThanOrEqual(NOTE_ROW_MAX);
  });

  it('goes below it, and what comes after in the column goes below the note', () => {
    const board = scene(
      diagram('net', NETWORK),
      noteBy('hosts', 'net'),
      noteBy('more', 'net', 'Router A is the gateway.'),
      { kind: 'board.note', item: 'after', text: 'Next: the masks.' },
    );
    const boxes = placeItems(board, { net: WIDE }, text);
    const { net, hosts, more, after } = boxes;
    expect(hosts).toMatchObject({ x: net.x, y: net.y + net.h + NOTE_STACK_GAP });
    expect(more).toMatchObject({ x: net.x, y: hosts.y + hosts.h + NOTE_STACK_GAP });
    expect(after.y).toBe(more.y + more.h + ITEM_GAP);
  });

  it('goes left of it when something is already below it', () => {
    const board = scene(
      diagram('net', NETWORK),
      diagram('flow', FLOW),
      noteBy('hosts', 'net'),
      noteBy('more', 'net', 'Router A is the gateway.'),
    );
    const boxes = placeItems(board, { net: WIDE, flow: laid(FLOW) }, text);
    const { net, hosts, more, flow } = boxes;
    expect(hosts.x + hosts.w).toBe(net.x - NOTE_OFFSET);
    expect(hosts.y).toBe(net.y);
    expect(more.x + more.w).toBe(net.x - NOTE_OFFSET);
    expect(more.y).toBe(hosts.y + hosts.h + NOTE_STACK_GAP);
    // The item below stays where it was.
    expect(flow.y).toBe(net.y + net.h + ITEM_GAP);
  });
});
