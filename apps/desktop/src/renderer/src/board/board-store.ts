// Ada's board: the scene she has drawn, her automata's and diagrams' layouts, and the effects she
// plays, which the board panel's engine draws. A scene can arrive before tldraw has loaded: the
// engine draws it when it attaches. Each automaton or diagram is laid out by Graphviz, in its
// worker, whenever its spec changes (a diagram once its node cards are measured); if that fails,
// by the fallback layout. An effect waits for its item's layout.
import type { BoardAction, DiagramSpec } from '@tassel/shared/beats';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { BoardEngine } from './engine';
import { getLayoutClient } from './layout/client';
import { fallbackDiagramLayout, fallbackLayout } from './layout/fallback';
import type { BoardLayout, DiagramSizes } from './layout/types';
import { diagramSizes } from './scene/diagram';
import type { MeasureText } from './scene/placement';
import { EMPTY_SCENE, reduceBoard } from './scene/reduce';
import type { BoardEffect, BoardItem, BoardScene } from './scene/types';
import { createTextMeasure, type TextMeasure } from './tldraw/measure';

export interface BoardState {
  scene: BoardScene;
  /** Each automaton's or diagram's layout, by item id. */
  layouts: Record<string, BoardLayout>;
  /**
   * How each layout was made: by Graphviz, or by the fallback after Graphviz failed. The board
   * panel shows it, so specs can tell without the board drawn (P5-R6, I10).
   */
  layoutSources: Record<string, 'graphviz' | 'fallback'>;
  apply(action: BoardAction): void;
  /** Draws the board with `engine` from now on, starting at once. Returns the detach. */
  attach(engine: BoardEngine): () => void;
  /** Empties the board: the scene, the layouts and the effects still waiting. */
  reset(): void;
}

/** The engine that draws the board, while one is attached. */
let engine: BoardEngine | null = null;
/** Effects waiting for their item's layout, or for an engine. */
let held: BoardEffect[] = [];
/** The spec each automaton or diagram was last laid out for (JSON), by item id. */
const requested = new Map<string, string>();
/** Bumped by reset, so a layout that lands after it is dropped. */
let generation = 0;

export const useBoardStore: UseBoundStore<StoreApi<BoardState>> = create<BoardState>()(
  (set, get) => ({
    scene: EMPTY_SCENE,
    layouts: {},
    layoutSources: {},
    apply(action) {
      const before = get().scene;
      const { scene, effects, problem } = reduceBoard(before, action);
      if (problem) console.warn(`[board] ${problem}`);
      if (scene !== before) {
        set({ scene, ...withoutGoneItems(scene, get()) });
        layOut(scene);
      }
      if (effects.length > 0) {
        held.push(...effects);
        playReady();
      }
      if (!problem) engine?.camera?.adaAction();
    },
    attach(next) {
      engine = next;
      const { scene, layouts } = get();
      next.render(scene, layouts);
      playReady();
      return () => {
        if (engine === next) engine = null;
      };
    },
    reset() {
      generation += 1;
      requested.clear();
      held = [];
      set({ scene: EMPTY_SCENE, layouts: {}, layoutSources: {} });
    },
  }),
);

/** Applies one of Ada's board actions, which dispatchActions has checked. */
export function applyBoardAction(action: BoardAction): void {
  useBoardStore.getState().apply(action);
}

// Every change to what's drawn reaches the engine while one is attached.
useBoardStore.subscribe((state, before) => {
  if (engine && (state.scene !== before.scene || state.layouts !== before.layouts)) {
    engine.render(state.scene, state.layouts);
  }
});

/** Asks for a layout for each automaton or diagram whose spec is new or changed since its last. */
function layOut(scene: BoardScene): void {
  for (const item of scene.items) {
    if (!isLaidOut(item)) continue;
    const key = JSON.stringify([item.kind, item.spec]);
    if (requested.get(item.id) === key) continue;
    requested.set(item.id, key);
    const asked = generation;
    const landed = (layout: BoardLayout, source: 'graphviz' | 'fallback') => {
      // Only the newest request for an item lands, and nothing from before a reset.
      if (asked !== generation || requested.get(item.id) !== key) return;
      useBoardStore.setState((state) => ({
        layouts: { ...state.layouts, [item.id]: layout },
        layoutSources: { ...state.layoutSources, [item.id]: source },
      }));
      playReady();
    };
    const failed = (error: unknown) =>
      console.warn(`[board] Graphviz couldn't lay out ${item.id}, so it uses the fallback:`, error);
    if (item.kind === 'diagram') {
      const { spec } = item;
      void measureDiagram(spec).then((sizes) =>
        Promise.resolve()
          .then(() => getLayoutClient().layoutDiagram(spec, sizes))
          .then(
            (layout) => landed(layout, 'graphviz'),
            (error: unknown) => {
              failed(error);
              landed(fallbackDiagramLayout(spec, sizes), 'fallback');
            },
          ),
      );
      continue;
    }
    getLayoutClient()
      .layout(item.spec)
      .then(
        (layout) => landed(layout, 'graphviz'),
        (error: unknown) => {
          failed(error);
          landed(fallbackLayout(item.spec), 'fallback');
        },
      );
  }
}

/** The layouts, sources and requests of items still in `scene`: a cleared item's are forgotten. */
function withoutGoneItems(
  scene: BoardScene,
  state: Pick<BoardState, 'layouts' | 'layoutSources'>,
): Pick<BoardState, 'layouts' | 'layoutSources'> | Record<string, never> {
  const laidOut = new Set(scene.items.filter(isLaidOut).map((i) => i.id));
  const gone = Object.keys(state.layouts).filter((id) => !laidOut.has(id));
  for (const id of requested.keys()) if (!laidOut.has(id)) requested.delete(id);
  held = held.filter((effect) => scene.items.some((item) => item.id === effect.item));
  if (gone.length === 0) return {};
  const keep = <T>(record: Record<string, T>) =>
    Object.fromEntries(Object.entries(record).filter(([id]) => laidOut.has(id)));
  return { layouts: keep(state.layouts), layoutSources: keep(state.layoutSources) };
}

/** Plays every waiting effect whose item has its layout, once an engine is attached. */
function playReady(): void {
  if (!engine) return;
  const { layouts } = useBoardStore.getState();
  const ready = held.filter((effect) => layouts[effect.item]);
  held = held.filter((effect) => !layouts[effect.item]);
  for (const effect of ready) {
    engine.play(effect).catch((error: unknown) => {
      console.error('[board] An effect failed:', error);
    });
  }
}

/** Whether an item has a layout of its own: an automaton or a diagram. */
function isLaidOut(item: BoardItem): item is Extract<BoardItem, { kind: 'automaton' | 'diagram' }> {
  return item.kind === 'automaton' || item.kind === 'diagram';
}

/** What measures a diagram's text: the DOM's, made on first use, once the fonts have loaded. */
let textMeasure: TextMeasure | null = null;
/** Where there's no DOM (Node): no widths, so diagramSizes estimates them. */
const BLIND: MeasureText = () => ({ w: 0, h: 0 });

/** A diagram's node cards and group labels, measured as its shapes set them. */
async function measureDiagram(spec: DiagramSpec): Promise<DiagramSizes> {
  if (typeof document === 'undefined' || !document.body) return diagramSizes(spec, BLIND);
  // The board's fonts, so the cards are measured in Geist and not its fallback.
  await document.fonts?.ready.catch(() => {});
  textMeasure ??= createTextMeasure(document.body, () => 'en');
  return diagramSizes(spec, textMeasure.measure);
}
