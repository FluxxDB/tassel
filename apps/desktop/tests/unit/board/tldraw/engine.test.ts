// @vitest-environment jsdom
// The tldraw engine on a real tldraw editor, made from the app's own editor config: Ada's changes
// are remote and out of the undo history, what the student moved or erased stays so, what Ada
// hasn't revealed is neither drawn nor hit, every self-loop draws, and the camera fits as P5-R9
// says. jsdom lays nothing out, so the stage's geometry is given.
import type { AutomatonSpec, BoardAction } from '@tassel/shared/beats';
import { resources } from '@tassel/shared/i18n';
import i18next from 'i18next';
import ICU from 'i18next-icu';
import {
  createTLStore,
  defaultAddFontsFromNode,
  defaultBindingUtils,
  defaultShapeUtils,
  Editor,
  getArrowInfo,
  StateNode,
  type TLArrowShape,
  type TLShapeId,
  tipTapDefaultExtensions,
} from 'tldraw';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { StageGeometry } from '../../../../src/renderer/src/board/engine';
import { fallbackLayout } from '../../../../src/renderer/src/board/layout/fallback';
import type { AutomatonLayout, LoopSide } from '../../../../src/renderer/src/board/layout/types';
import { EMPTY_SCENE, reduceBoard } from '../../../../src/renderer/src/board/scene/reduce';
import type { BoardScene } from '../../../../src/renderer/src/board/scene/types';
import { adaShapeId } from '../../../../src/renderer/src/board/tldraw/desired';
import {
  hideUnrevealed,
  OVERLAY_UTILS,
  SHAPE_UTILS,
} from '../../../../src/renderer/src/board/tldraw/editor-config';
import {
  createTldrawEngine,
  type TldrawEngine,
} from '../../../../src/renderer/src/board/tldraw/engine';
import {
  boardObstructions,
  cameraFor,
  fitBoard,
} from '../../../../src/renderer/src/board/tldraw/fit';
import { CORRECT, WRONG } from '../fixtures';

// What tldraw needs of a browser that jsdom lacks; hoisted, so it's there before tldraw loads.
vi.hoisted(() => {
  window.matchMedia ??= ((media: string) => ({
    matches: false,
    media,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

class Idle extends StateNode {
  static override id = 'idle';
}

/** P1's stage at 1440×900, split: the board panel on the right. */
const SPLIT_1440: StageGeometry = {
  panel: { x: 726, y: 60, w: 698, h: 736 },
  main: { x: 0, y: 52, w: 1440, h: 848 },
  captions: true,
};

let t: (key: string, opts: Record<string, unknown> & { lng: 'en' | 'es' | 'ko' }) => string;
beforeAll(async () => {
  const i18n = i18next.createInstance().use(ICU);
  await i18n.init({
    resources,
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
  t = (key, opts) => String(i18n.t(key, opts));
});

const made: Array<{ editor: Editor; engine: TldrawEngine }> = [];
afterEach(() => {
  for (const { editor, engine } of made.splice(0)) {
    engine.dispose();
    editor.dispose();
  }
});

/** A tldraw editor as the board panel makes it, and Ada's engine on it. */
function board(stage: StageGeometry | null = null, reducedMotion = true) {
  const shapeUtils = [...defaultShapeUtils.filter((util) => util.type !== 'arrow'), ...SHAPE_UTILS];
  const bindingUtils = [...defaultBindingUtils];
  const container = document.createElement('div');
  document.body.append(container);
  const editor = new Editor({
    shapeUtils,
    bindingUtils,
    overlayUtils: OVERLAY_UTILS,
    tools: [Idle],
    initialState: 'idle',
    store: createTLStore({ shapeUtils, bindingUtils }),
    getContainer: () => container,
    getShapeVisibility: hideUnrevealed,
    // As <Tldraw> sets them up: arrow labels are rich text.
    options: {
      text: {
        addFontsFromNode: defaultAddFontsFromNode,
        tipTapConfig: { extensions: tipTapDefaultExtensions },
      },
    },
  });
  const engine = createTldrawEngine(editor, {
    lang: 'en',
    t,
    reducedMotion: () => reducedMotion,
    stage: () => stage,
  });
  made.push({ editor, engine });
  return { editor, engine, container };
}

function sceneAfter(...actions: BoardAction[]): BoardScene {
  return actions.reduce((scene, action) => {
    const result = reduceBoard(scene, action);
    expect(result.problem).toBeNull();
    return result.scene;
  }, EMPTY_SCENE);
}

const draw = (spec: AutomatonSpec, reveal: 'all' | 'none' = 'all'): BoardAction => ({
  kind: 'board.automaton',
  item: 'fix',
  spec,
  reveal,
});
const id = (el: string) => adaShapeId('fix', el) as TLShapeId;

describe('the tldraw engine', () => {
  it("draws Ada's board as remote changes, outside the undo history", () => {
    const { editor, engine } = board();
    const sources: string[] = [];
    editor.store.listen((entry) => sources.push(entry.source), { scope: 'document' });
    const scene = sceneAfter(draw(CORRECT));
    engine.render(scene, { fix: fallbackLayout(CORRECT) });

    const shapes = editor.getCurrentPageShapes();
    expect(shapes.filter((shape) => shape.type === 'tassel-state')).toHaveLength(5);
    expect(shapes.filter((shape) => shape.type === 'arrow')).toHaveLength(9);
    expect(editor.getBindingsToShape(id('state:q3'), 'arrow')).toHaveLength(3);
    // Each arrow is already where tldraw keeps an arrow it binds, so tldraw moves none of them
    // after Ada: a move of its own would be the user's.
    expect(sources.length).toBeGreaterThan(0);
    expect(new Set(sources)).toEqual(new Set(['remote']));
    expect(editor.getCanUndo()).toBe(false);

    // So are the ones she adds later, between states already drawn and to a new one.
    const more = sceneAfter(
      draw(CORRECT),
      { kind: 'board.addTransition', item: 'fix', from: 'q3', to: 'q0', symbols: ['x'] },
      { kind: 'board.addState', item: 'fix', id: 'q4' },
      { kind: 'board.addTransition', item: 'fix', from: 'q4', to: 'q1', symbols: ['0'] },
    );
    const spec = (more.items[0] as { spec: AutomatonSpec }).spec;
    engine.render(more, { fix: fallbackLayout(spec) });
    expect(editor.getShape(id('edge:q3>q0'))).toBeDefined();
    expect(editor.getShape(id('edge:q4>q1'))).toBeDefined();
    expect(new Set(sources)).toEqual(new Set(['remote']));
    expect(editor.getCanUndo()).toBe(false);
  });

  it('leaves a state the student moved where she put it, and an erased one erased', () => {
    const { editor, engine } = board();
    const layouts = { fix: fallbackLayout(CORRECT) };
    engine.render(sceneAfter(draw(CORRECT)), layouts);
    editor.updateShapes([{ id: id('state:q1'), type: 'tassel-state', x: 900, y: 700 }]);
    editor.deleteShapes([id('state:qd')]);

    // Ada highlights both, and rings q0 for a trace: only what she changed changes.
    const later = sceneAfter(
      draw(CORRECT),
      { kind: 'board.highlight', item: 'fix', el: 'state:q1', on: true },
      { kind: 'board.highlight', item: 'fix', el: 'state:qd', on: true },
    );
    expect(() => engine.render(later, layouts)).not.toThrow();
    expect(editor.getShape(id('state:q1'))).toMatchObject({
      x: 900,
      y: 700,
      props: { ring: 'highlight' },
    });
    expect(editor.getShape(id('state:qd'))).toBeUndefined();
    expect(editor.getShape(id('edge:qd>qd'))).toBeDefined();
    expect(editor.getBindingsToShape(id('state:qd'), 'arrow')).toEqual([]);
  });

  it("neither draws nor hits what Ada hasn't revealed (I2)", () => {
    const { editor, engine } = board();
    const layout = fallbackLayout(CORRECT);
    engine.render(
      sceneAfter(draw(CORRECT, 'none'), { kind: 'board.reveal', item: 'fix', els: ['edge:q0>q1'] }),
      { fix: layout },
    );
    const at = (state: string) => ({ x: layout.states[state].x, y: layout.states[state].y });
    expect(editor.isShapeHidden(id('state:qd'))).toBe(true);
    expect(editor.getShapeAtPoint(at('qd'), { hitInside: true })).toBeUndefined();
    expect(editor.getShapeAtPoint(at('q0'), { hitInside: true })?.id).toBe(id('state:q0'));
    const drawn = editor
      .getRenderingShapes()
      .map(({ shape }) => shape.meta.el)
      .sort();
    expect(drawn).toEqual(['edge:q0>q1', 'state:q0', 'state:q1']);
  });

  it('draws every self-loop outside its state, on every side, wherever the state is', () => {
    const sides: LoopSide[] = ['top', 'bottom', 'left', 'right'];
    let seed = 11;
    const random = () => {
      seed = (seed * 16_807) % 2_147_483_647;
      return seed / 2_147_483_647;
    };
    for (const side of sides) {
      const { editor, engine } = board();
      const layout: AutomatonLayout = fallbackLayout(WRONG);
      layout.edges['q3>q3'] = { ...layout.edges['q3>q3'], loop: side };
      engine.render(sceneAfter(draw(WRONG)), { fix: layout });
      const loop = () => getArrowInfo(editor, editor.getShape(id('edge:q3>q3')) as TLArrowShape);
      for (let i = 0; i < 60; i++) {
        const x = Math.round((random() * 2000 - 500) * 100) / 100;
        const y = Math.round((random() * 2000 - 500) * 100) / 100;
        editor.updateShapes([{ id: id('state:q3'), type: 'tassel-state', x, y }]);
        const info = loop();
        expect(info?.isValid, `${side} loop at ${x},${y}`).toBe(true);
        expect(info?.type).toBe('arc');
        if (info?.type !== 'arc') return;
        // Its middle bulges away from the state's center, on the layout's side.
        const center = { x: x + 32, y: y + 32 };
        const arrow = editor.getShape(id('edge:q3>q3')) as TLArrowShape;
        const middle = { x: arrow.x + info.middle.x, y: arrow.y + info.middle.y };
        const away = {
          top: center.y - middle.y,
          bottom: middle.y - center.y,
          left: center.x - middle.x,
          right: middle.x - center.x,
        }[side];
        expect(away, `${side} loop at ${x},${y}`).toBeGreaterThan(32);
      }
    }
  });

  it('plays a pulse on the overlay: an iris-ink ring around the state, nothing stored', async () => {
    const { editor, engine } = board(null, false);
    engine.render(sceneAfter(draw(CORRECT)), { fix: fallbackLayout(CORRECT) });
    const before = editor.store.serialize('document');
    const played = engine.play({ type: 'pulse', item: 'fix', el: 'state:qd' });
    const entries = editor.overlays.getActiveOverlayEntries();
    expect(
      entries.map(({ util }) => (util.constructor as unknown as { type: string }).type),
    ).toEqual(['ada-effects']);
    const [ring] = entries[0].overlays;
    // Around qd's circle, r 32, from r + 4.
    const { x, y } = fallbackLayout(CORRECT).states.qd;
    expect(ring.props).toMatchObject({ kind: 'ring', x, y, r: 36, alpha: 1 });
    expect(editor.store.serialize('document')).toEqual(before);
    void played;
  });

  it('plays nothing under reduced motion', async () => {
    const { editor, engine } = board();
    engine.render(sceneAfter(draw(CORRECT)), { fix: fallbackLayout(CORRECT) });
    await engine.play({ type: 'pulse', item: 'fix', el: 'state:qd' });
    expect(editor.overlays.getActiveOverlayEntries()).toEqual([]);
  });

  it('fits the camera as fitBoard says, and says how in data-fit (P5-R9)', () => {
    const { editor, engine, container } = board(SPLIT_1440);
    const layout = fallbackLayout(CORRECT);
    engine.render(sceneAfter(draw(CORRECT)), { fix: layout });
    const content = { x: 0, y: 0, w: layout.width, h: layout.height };
    const fit = fitBoard(content, SPLIT_1440);
    expect(fit?.stage).toBe('clear');
    if (!fit) return;
    expect(editor.getCamera()).toMatchObject(cameraFor(content, fit));
    expect(container.dataset.fit).toBe('clear');
    // Her drawing on screen sits below her tile.
    const { tile } = boardObstructions(SPLIT_1440);
    const q3 = editor.getShapePageBounds(id('state:q3'));
    expect(q3 && editor.pageToViewport({ x: q3.x, y: q3.y }).y).toBeGreaterThan(tile.y + tile.h);
  });
});
