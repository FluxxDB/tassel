// desiredBoard for a diagram: a tassel-group frame per group behind its nodes, a tassel-node card
// per node, and tldraw arrows bound to the cards: no arrowhead when undirected, dashed when asked.
import type { BoardAction } from '@tassel/shared/beats';
import { beforeAll, describe, expect, it } from 'vitest';
import { fallbackDiagramLayout } from '../../../../src/renderer/src/board/layout/fallback';
import { diagramSizes } from '../../../../src/renderer/src/board/scene/diagram';
import {
  type BoardText,
  type MeasureText,
  placeItems,
  TITLE_ROW,
} from '../../../../src/renderer/src/board/scene/placement';
import { EMPTY_SCENE, reduceBoard } from '../../../../src/renderer/src/board/scene/reduce';
import type { BoardScene } from '../../../../src/renderer/src/board/scene/types';
import { adaShapeId, desiredBoard } from '../../../../src/renderer/src/board/tldraw/desired';
import { FLOW, NETWORK } from '../fixtures';

const measure: MeasureText = (text) => ({ w: [...text].length * 8, h: 16 });
const text: BoardText = { measure, t: (key) => key };
const sizes = diagramSizes(NETWORK, measure);
const layout = fallbackDiagramLayout(NETWORK, sizes);

function sceneAfter(...actions: BoardAction[]): BoardScene {
  return actions.reduce((scene, action) => {
    const result = reduceBoard(scene, action);
    expect(result.problem).toBeNull();
    return result.scene;
  }, EMPTY_SCENE);
}

const id = (el: string) => adaShapeId('net', el);
let board: ReturnType<typeof desiredBoard>;

beforeAll(() => {
  board = desiredBoard(
    sceneAfter(
      { kind: 'board.diagram', item: 'net', spec: NETWORK },
      { kind: 'board.highlight', item: 'net', el: 'node:rA', on: true },
      { kind: 'board.highlight', item: 'net', el: 'edge:core>rB', on: true },
    ),
    { net: layout },
    text,
    'en',
  );
});

function shape(el: string) {
  const found = board.shapes.get(id(el));
  if (!found) throw new Error(`no shape for ${el}`);
  return found;
}

describe('desiredBoard for a diagram', () => {
  it('draws its title, then groups, then nodes, then edges, in that z-order', () => {
    const types = [...board.shapes.values()].map((s) => `${s.type} ${s.meta.el}`);
    expect(types[0]).toBe('tassel-note title');
    expect(types.slice(1, 4)).toEqual([
      'tassel-group group:zoneA',
      'tassel-group group:zoneB',
      'tassel-group group:zoneC',
    ]);
    expect(types.slice(4, 14).every((t) => t.startsWith('tassel-node node:'))).toBe(true);
    expect(types.slice(14).every((t) => t.startsWith('arrow edge:'))).toBe(true);
    expect(types).toHaveLength(1 + 3 + 10 + 9);
  });

  it('places each group and node card at its layout box, under the title row', () => {
    const zone = shape('group:zoneB');
    expect(zone).toMatchObject({
      x: layout.groups.zoneB.x,
      y: TITLE_ROW + layout.groups.zoneB.y,
      opacity: 1,
      props: {
        w: layout.groups.zoneB.w,
        h: layout.groups.zoneB.h,
        label: 'Zone B',
        sublabel: '192.168.1.64/27',
        tone: 1,
        highlight: false,
      },
    });
    const router = shape('node:rA');
    expect(router).toMatchObject({
      x: layout.nodes.rA.x,
      y: TITLE_ROW + layout.nodes.rA.y,
      props: {
        w: layout.nodes.rA.w,
        h: layout.nodes.rA.h,
        label: 'Router A',
        sublabel: '192.168.1.1',
        icon: 'router',
        highlight: true,
      },
    });
    expect(shape('node:core').props.sublabel).toBe('');
    // The item's box covers the title row and the whole layout.
    const box = placeItems(
      sceneAfter({ kind: 'board.diagram', item: 'net', spec: NETWORK }),
      { net: layout },
      text,
    ).net;
    expect(box).toEqual({ x: 0, y: 0, w: layout.width, h: layout.height + TITLE_ROW });
  });

  it('wires each edge as an arrow bound to its two node cards', () => {
    const link = shape('edge:core>rA');
    expect(link.type).toBe('arrow');
    expect(link.props).toMatchObject({
      arrowheadStart: 'none',
      arrowheadEnd: 'none',
      dash: 'solid',
      label: 'Gi0/1',
      color: 'black',
    });
    const bindings = [...board.bindings.values()].filter((b) => b.arrow === id('edge:core>rA'));
    expect(bindings.map((b) => [b.terminal, b.to])).toEqual([
      ['start', id('node:core')],
      ['end', id('node:rA')],
    ]);
    expect(shape('edge:rB>pcB2').props.dash).toBe('dashed');
    expect(shape('edge:core>rB').props.color).toBe('violet');
    expect(shape('edge:rA>pcA1').props.label).toBe('');
  });

  it('a directed edge keeps its arrowhead', () => {
    const flow = desiredBoard(
      sceneAfter({ kind: 'board.diagram', item: 'flow', spec: FLOW }),
      { flow: fallbackDiagramLayout(FLOW, diagramSizes(FLOW, measure)) },
      text,
      'en',
    );
    const arrow = flow.shapes.get(adaShapeId('flow', 'edge:check>db'));
    expect(arrow?.props).toMatchObject({ arrowheadEnd: 'arrow', dash: 'dashed', label: 'allowed' });
  });

  it('hides what Ada has not revealed, the title until the first piece', () => {
    const hidden = desiredBoard(
      sceneAfter({ kind: 'board.diagram', item: 'net', spec: NETWORK, reveal: 'none' }),
      { net: layout },
      text,
      'en',
    );
    expect([...hidden.shapes.values()].every((s) => s.opacity === 0 && s.meta.hidden)).toBe(true);
    const some = desiredBoard(
      sceneAfter(
        { kind: 'board.diagram', item: 'net', spec: NETWORK, reveal: 'none' },
        { kind: 'board.reveal', item: 'net', els: ['node:rA'] },
      ),
      { net: layout },
      text,
      'en',
    );
    const shown = [...some.shapes.values()].filter((s) => !s.meta.hidden).map((s) => s.meta.el);
    expect(shown).toEqual(['title', 'group:zoneA', 'node:rA']);
  });

  it('waits for its layout, holding back what comes after it', () => {
    const scene = sceneAfter(
      { kind: 'board.diagram', item: 'net', spec: NETWORK },
      { kind: 'board.note', item: 'n', text: 'hello' },
    );
    expect(desiredBoard(scene, {}, text, 'en').shapes.size).toBe(0);
  });
});
