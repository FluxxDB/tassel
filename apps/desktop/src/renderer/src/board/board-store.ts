// Ada's board: the scene she has drawn, her automata's layouts, and the effects she plays, which
// the board panel's engine draws. A scene can arrive before tldraw has loaded: the engine draws it
// when it attaches. Each automaton is laid out by Graphviz, in its worker, whenever its spec
// changes; if that fails, by the fallback layout. An effect waits for its item's layout.
import type { BoardAction } from '@tassel/shared/beats';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { BoardEngine } from './engine';
import { getLayoutClient } from './layout/client';
import { fallbackLayout } from './layout/fallback';
import type { AutomatonLayout } from './layout/types';
import { EMPTY_SCENE, reduceBoard } from './scene/reduce';
import type { AutomatonItem, BoardEffect, BoardScene } from './scene/types';

export interface BoardState {
  scene: BoardScene;
  /** Each automaton's layout, by item id. */
  layouts: Record<string, AutomatonLayout>;
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
/** The spec each automaton was last laid out for (canonical JSON), by item id. */
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

/** Asks for a layout for each automaton whose spec is new or changed since its last one. */
function layOut(scene: BoardScene): void {
  for (const item of scene.items) {
    if (item.kind !== 'automaton') continue;
    const key = JSON.stringify(item.spec);
    if (requested.get(item.id) === key) continue;
    requested.set(item.id, key);
    const asked = generation;
    const landed = (layout: AutomatonLayout, source: 'graphviz' | 'fallback') => {
      // Only the newest request for an item lands, and nothing from before a reset.
      if (asked !== generation || requested.get(item.id) !== key) return;
      useBoardStore.setState((state) => ({
        layouts: { ...state.layouts, [item.id]: layout },
        layoutSources: { ...state.layoutSources, [item.id]: source },
      }));
      playReady();
    };
    getLayoutClient()
      .layout(item.spec)
      .then(
        (layout) => landed(layout, 'graphviz'),
        (error: unknown) => {
          console.warn(
            `[board] Graphviz couldn't lay out ${item.id}, so it uses the fallback:`,
            error,
          );
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
  const automata = new Set(
    scene.items.filter((item): item is AutomatonItem => item.kind === 'automaton').map((i) => i.id),
  );
  const gone = Object.keys(state.layouts).filter((id) => !automata.has(id));
  for (const id of requested.keys()) if (!automata.has(id)) requested.delete(id);
  held = held.filter((effect) => scene.items.some((item) => item.id === effect.item));
  if (gone.length === 0) return {};
  const keep = <T>(record: Record<string, T>) =>
    Object.fromEntries(Object.entries(record).filter(([id]) => automata.has(id)));
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
