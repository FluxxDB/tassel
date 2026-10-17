// desiredBoard: Ada's scene as the shapes and bindings tldraw should hold, by stable ids. Pure,
// so it runs on Track B's reducer and layouts without tldraw.
import type { AutomatonSpec, BoardAction } from '@tassel/shared/beats';
import { resources } from '@tassel/shared/i18n';
import i18next from 'i18next';
import ICU from 'i18next-icu';
import { beforeAll, describe, expect, it } from 'vitest';
import { fallbackLayout } from '../../../../src/renderer/src/board/layout/fallback';
import type { AutomatonLayout } from '../../../../src/renderer/src/board/layout/types';
import {
  type BoardText,
  type MeasureText,
  placeItems,
  TITLE_ROW,
} from '../../../../src/renderer/src/board/scene/placement';
import { EMPTY_SCENE, reduceBoard } from '../../../../src/renderer/src/board/scene/reduce';
import type { BoardScene } from '../../../../src/renderer/src/board/scene/types';
import {
  adaShapeId,
  type Desired,
  desiredBoard,
} from '../../../../src/renderer/src/board/tldraw/desired';
import { CORRECT, WRONG } from '../fixtures';

/** A fixed-width stand-in for the DOM, as in Track B's placement tests. */
const measure: MeasureText = (text, style) => {
  const advance = style === 'note' ? 9 : 8;
  const line = style === 'note' ? 24 : 20;
  return { w: [...text].length * advance, h: line };
};

let text: BoardText;
beforeAll(async () => {
  const i18n = i18next.createInstance().use(ICU);
  await i18n.init({
    resources,
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
  text = { measure, t: (key, values) => String(i18n.t(key, { ...values, lng: 'en' })) };
});

/** The scene after `actions`, each of which must apply without a problem. */
function sceneAfter(...actions: BoardAction[]): BoardScene {
  return actions.reduce((scene, action) => {
    const result = reduceBoard(scene, action);
    expect(result.problem).toBeNull();
    return result.scene;
  }, EMPTY_SCENE);
}

const draw = (
  spec: AutomatonSpec,
  reveal: 'all' | 'none' = 'all',
  title?: string,
): BoardAction => ({
  kind: 'board.automaton',
  item: 'fix',
  spec,
  reveal,
  ...(title && { title }),
});

const id = (el: string) => adaShapeId('fix', el);

function shape(board: Desired, el: string) {
  const found = board.shapes.get(id(el));
  if (!found) throw new Error(`no shape for ${el}`);
  return found;
}

function bindingsOf(board: Desired, el: string) {
  return [...board.bindings.values()].filter((binding) => binding.arrow === id(el));
}

describe('desiredBoard', () => {
  it('a hidden automaton has every shape at opacity 0', () => {
    const scene = sceneAfter(draw(CORRECT, 'none'));
    const board = desiredBoard(scene, { fix: fallbackLayout(CORRECT) }, text, 'en');
    // 5 states, 8 edges and the start arrow, all hidden from view and from her tools (I2).
    expect(board.shapes.size).toBe(14);
    for (const desired of board.shapes.values()) {
      expect(desired.opacity).toBe(0);
      expect(desired.meta).toMatchObject({ ada: true, item: 'fix', hidden: true });
    }
  });

  it('revealing q0>q1 shows the arrow and both states', () => {
    const scene = sceneAfter(draw(CORRECT, 'none'), {
      kind: 'board.reveal',
      item: 'fix',
      els: ['edge:q0>q1'],
    });
    const board = desiredBoard(scene, { fix: fallbackLayout(CORRECT) }, text, 'en');
    const shown = [...board.shapes.values()]
      .filter((desired) => desired.opacity === 1)
      .map((desired) => desired.meta.el);
    expect(shown.sort()).toEqual(['edge:q0>q1', 'state:q0', 'state:q1']);
    expect(shape(board, 'edge:q0>q1').meta.hidden).toBe(false);
  });

  it('draws a state at its center minus r, labelled, accepting where the spec says', () => {
    const layout = fallbackLayout(CORRECT);
    const board = desiredBoard(sceneAfter(draw(CORRECT)), { fix: layout }, text, 'en');
    const { x, y, r } = layout.states.q3;
    expect(shape(board, 'state:q3')).toMatchObject({
      type: 'tassel-state',
      x: x - r,
      y: y - r,
      opacity: 1,
      props: { w: 2 * r, h: 2 * r, label: 'q3', accept: true, ring: 'none' },
    });
    expect(shape(board, 'state:q0').props).toMatchObject({ label: 'q0', accept: false });
  });

  it("draws an edge as tldraw's thinnest ink arc from its tail, labelled with its symbols", () => {
    const layout = fallbackLayout(CORRECT);
    const board = desiredBoard(sceneAfter(draw(CORRECT)), { fix: layout }, text, 'en');
    const edge = shape(board, 'edge:q0>q1');
    expect(edge).toMatchObject({ type: 'arrow', x: layout.states.q0.x, y: layout.states.q0.y });
    expect(edge.props).toMatchObject({
      kind: 'arc',
      label: '0',
      color: 'black',
      labelColor: 'black',
      size: 's',
      dash: 'solid',
      font: 'mono',
      arrowheadStart: 'none',
      arrowheadEnd: 'arrow',
      labelPosition: 0.5,
    });
    expect(bindingsOf(board, 'edge:q0>q1')).toEqual([
      expect.objectContaining({
        terminal: 'start',
        to: id('state:q0'),
        normalizedAnchor: { x: 0.5, y: 0.5 },
        isPrecise: false,
      }),
      expect.objectContaining({
        terminal: 'end',
        to: id('state:q1'),
        normalizedAnchor: { x: 0.5, y: 0.5 },
        isPrecise: false,
      }),
    ]);
    expect(shape(board, 'edge:q3>q3').props.label).toBe('0,1');
  });

  it("negates Task 2's bend for tldraw: opposite edges bend to opposite sides with one sign (P5-R2)", () => {
    const pair: AutomatonSpec = {
      kind: 'dfa',
      states: [{ id: 'q0' }, { id: 'q1', accept: true }],
      start: 'q0',
      transitions: [
        { from: 'q0', to: 'q1', symbols: ['a'] },
        { from: 'q1', to: 'q0', symbols: ['b'] },
      ],
    };
    // Task 2: positive is to the left of each edge's own tail → head, so +20 on both edges
    // bends them to opposite sides of the pair. tldraw's positive bend is to the right.
    const layout: AutomatonLayout = {
      ...fallbackLayout(pair),
      edges: {
        'q0>q1': { bend: 20, label: { x: 0, y: 0 }, loop: null },
        'q1>q0': { bend: 20, label: { x: 0, y: 0 }, loop: null },
      },
    };
    const board = desiredBoard(sceneAfter(draw(pair)), { fix: layout }, text, 'en');
    expect(shape(board, 'edge:q0>q1').props.bend).toBe(-20);
    expect(shape(board, 'edge:q1>q0').props.bend).toBe(-20);
  });

  it('the q3 loop binds q3 twice, at its top anchors', () => {
    const layout = fallbackLayout(CORRECT);
    expect(layout.edges['q3>q3'].loop).toBe('top');
    const board = desiredBoard(sceneAfter(draw(CORRECT)), { fix: layout }, text, 'en');
    const loop = shape(board, 'edge:q3>q3');
    // Counterclockwise: tldraw 5.5.2 computes a clockwise loop like this as invalid about half
    // the time (a NaN end), so the loop runs right to left over the top with a positive bend.
    expect(loop.props.bend).toBe(1.6 * layout.states.q3.r);
    expect(bindingsOf(board, 'edge:q3>q3')).toEqual([
      expect.objectContaining({
        terminal: 'start',
        to: id('state:q3'),
        normalizedAnchor: { x: 0.7, y: 0.06 },
      }),
      expect.objectContaining({
        terminal: 'end',
        to: id('state:q3'),
        normalizedAnchor: { x: 0.3, y: 0.06 },
      }),
    ]);
  });

  it('a loop on any side bulges outward: its anchors run so that right of travel is out', () => {
    const anchors = (loop: 'top' | 'bottom' | 'left' | 'right') => {
      const layout = fallbackLayout(WRONG);
      layout.edges['q3>q3'] = { ...layout.edges['q3>q3'], loop };
      const board = desiredBoard(sceneAfter(draw(WRONG)), { fix: layout }, text, 'en');
      return bindingsOf(board, 'edge:q3>q3').map((b) => b.normalizedAnchor);
    };
    expect(anchors('top')).toEqual([
      { x: 0.7, y: 0.06 },
      { x: 0.3, y: 0.06 },
    ]);
    expect(anchors('bottom')).toEqual([
      { x: 0.3, y: 0.94 },
      { x: 0.7, y: 0.94 },
    ]);
    expect(anchors('left')).toEqual([
      { x: 0.06, y: 0.3 },
      { x: 0.06, y: 0.7 },
    ]);
    expect(anchors('right')).toEqual([
      { x: 0.94, y: 0.7 },
      { x: 0.94, y: 0.3 },
    ]);
  });

  it('the start arrow binds only its end', () => {
    const layout = fallbackLayout(CORRECT);
    const board = desiredBoard(sceneAfter(draw(CORRECT)), { fix: layout }, text, 'en');
    const start = shape(board, 'start');
    const { from, to } = layout.start;
    expect(start).toMatchObject({ type: 'arrow', x: from.x, y: from.y });
    expect(start.props).toMatchObject({
      label: '',
      start: { x: 0, y: 0 },
      end: { x: to.x - from.x, y: to.y - from.y },
    });
    expect(bindingsOf(board, 'start')).toEqual([
      expect.objectContaining({ terminal: 'end', to: id('state:q0') }),
    ]);
  });

  it('a highlighted edge is violet, and a current state rings', () => {
    const scene = sceneAfter(
      draw(CORRECT),
      { kind: 'board.highlight', item: 'fix', el: 'edge:q0>q1', on: true },
      { kind: 'board.highlight', item: 'fix', el: 'state:qd', on: true },
      { kind: 'board.trace', item: 'run', spec: CORRECT, input: '01', on: 'fix' },
    );
    const board = desiredBoard(scene, { fix: fallbackLayout(CORRECT) }, text, 'en');
    expect(shape(board, 'edge:q0>q1').props).toMatchObject({
      color: 'violet',
      labelColor: 'violet',
    });
    expect(shape(board, 'edge:q1>q2').props).toMatchObject({ color: 'black' });
    expect(shape(board, 'state:q0').props.ring).toBe('current');
    expect(shape(board, 'state:qd').props.ring).toBe('highlight');
    expect(shape(board, 'state:q1').props.ring).toBe('none');
  });

  it('a titled automaton puts its title on top and its states 28 px lower', () => {
    const layout = fallbackLayout(CORRECT);
    const scene = sceneAfter(draw(CORRECT, 'all', 'Starts with 010'));
    const board = desiredBoard(scene, { fix: layout }, text, 'en');
    const box = placeItems(scene, { fix: layout }, text).fix;
    expect(shape(board, 'title')).toMatchObject({
      type: 'tassel-note',
      x: box.x,
      y: box.y,
      props: { w: layout.width, h: TITLE_ROW, text: 'Starts with 010', variant: 'title' },
    });
    const { y, r } = layout.states.q0;
    expect(shape(board, 'state:q0').y).toBe(box.y + TITLE_ROW + y - r);
  });

  it('draws a trace card at its box, from its run, in the session language', () => {
    const scene = sceneAfter(
      { kind: 'board.trace', item: 'fix', spec: WRONG, input: '100', subject: 'student' },
      { kind: 'board.traceStep', item: 'fix', step: 2 },
      { kind: 'board.verdict', item: 'fix', got: 'reject', note: 'No move on 0 from q0' },
    );
    const board = desiredBoard(scene, {}, text, 'es');
    const box = placeItems(scene, {}, text).fix;
    expect(shape(board, 'trace')).toMatchObject({
      type: 'tassel-trace',
      x: box.x,
      y: box.y,
      opacity: 1,
      props: {
        w: box.w,
        h: box.h,
        lang: 'es',
        input: '100',
        title: null,
        kind: 'dfa',
        subject: 'student',
        shown: 2,
        verdict: { got: 'reject', note: 'No move on 0 from q0' },
        rows: [
          { symbol: '1', from: 'q0', to: 'q0', loop: true, stuck: false },
          { symbol: '0', from: 'q0', to: 'q1', loop: false, stuck: false },
          { symbol: '0', from: 'q1', to: '', loop: false, stuck: true },
        ],
      },
    });
  });

  it('draws a note at its box', () => {
    const scene = sceneAfter({ kind: 'board.note', item: 'n1', text: 'Watch q0 on a 1.' });
    const board = desiredBoard(scene, {}, text, 'en');
    const box = placeItems(scene, {}, text).n1;
    expect(board.shapes.get(adaShapeId('n1', 'note'))).toMatchObject({
      type: 'tassel-note',
      x: box.x,
      y: box.y,
      props: { w: box.w, h: box.h, text: 'Watch q0 on a 1.', variant: 'note' },
    });
  });

  it('draws nothing of an automaton whose layout has not come, nor of what comes after it', () => {
    const scene = sceneAfter(draw(CORRECT), { kind: 'board.note', item: 'n1', text: 'Later' });
    expect(desiredBoard(scene, {}, text, 'en').shapes.size).toBe(0);
  });

  it('ids are stable across calls', () => {
    const scene = sceneAfter(draw(CORRECT, 'none', 'Reference'));
    const layouts = { fix: fallbackLayout(CORRECT) };
    const a = desiredBoard(scene, layouts, text, 'en');
    const b = desiredBoard(scene, layouts, text, 'en');
    expect([...a.shapes.keys()]).toEqual([...b.shapes.keys()]);
    expect([...a.bindings.keys()]).toEqual([...b.bindings.keys()]);
    expect(a).toEqual(b);
    expect([...a.shapes.keys()]).toContain('shape:ada.fix.state:q0');
    expect([...a.bindings.keys()]).toContain('binding:ada.fix.edge:q0>q1.start');
  });
});
