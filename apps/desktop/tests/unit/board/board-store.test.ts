// The board store: Ada's scene, her automata's layouts, her effects, and the engine that draws
// them. A fake layout client and a fake engine stand in for Graphviz and tldraw.
import type { AutomatonSpec, BoardAction } from '@tassel/shared/beats';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyBoardAction, useBoardStore } from '../../../src/renderer/src/board/board-store';
import type { BoardEngine } from '../../../src/renderer/src/board/engine';
import { fallbackLayout } from '../../../src/renderer/src/board/layout/fallback';
import type { AutomatonLayout } from '../../../src/renderer/src/board/layout/types';
import { CORRECT } from './fixtures';

/** Layout calls the test settles by hand, in order. */
const layouts = vi.hoisted(() => {
  const calls: Array<{
    spec: AutomatonSpec;
    resolve(layout: AutomatonLayout): void;
    reject(error: Error): void;
  }> = [];
  return {
    calls,
    client: {
      layout: (spec: AutomatonSpec) =>
        new Promise<AutomatonLayout>((resolve, reject) => calls.push({ spec, resolve, reject })),
      dispose: () => {},
    },
  };
});
vi.mock('../../../src/renderer/src/board/layout/client', () => ({
  getLayoutClient: () => layouts.client,
}));

const store = () => useBoardStore.getState();

/** Each test's engines, detached after it, so none outlives its test. */
const detachers: Array<() => void> = [];
const attach = (engine: BoardEngine) => {
  detachers.push(store().attach(engine));
};

/** A stand-in engine that records what it's asked to draw and play. */
function fakeEngine() {
  const engine = {
    render: vi.fn(),
    play: vi.fn(async () => {}),
    focus: vi.fn(),
    onStudentEdit: vi.fn(() => () => {}),
    dispose: vi.fn(),
  } satisfies BoardEngine;
  return engine;
}

const DRAW: BoardAction = { kind: 'board.automaton', item: 'fix', spec: CORRECT };
const PULSE: BoardAction = { kind: 'board.pulse', item: 'fix', el: 'state:q0' };

/** Lets the layout promises' handlers run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  layouts.calls.length = 0;
  store().reset();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  for (const detach of detachers.splice(0)) detach();
  vi.restoreAllMocks();
});

describe('the board store', () => {
  it('notifies the camera after rendering actions, including effects and repeated focus', () => {
    const events: string[] = [];
    const engine: BoardEngine = {
      ...fakeEngine(),
      render: () => {
        events.push('render');
      },
      camera: {
        zoom() {},
        fit() {},
        adaAction: () => {
          events.push('action');
        },
      },
    };
    attach(engine);
    events.length = 0;
    applyBoardAction(DRAW);
    expect(events).toEqual(['render', 'action']);
    events.length = 0;
    applyBoardAction(PULSE);
    expect(events).toEqual(['action']);
    applyBoardAction({ kind: 'board.focus', item: 'fix' });
    events.length = 0;
    applyBoardAction({ kind: 'board.focus', item: 'fix' });
    expect(events.at(-1)).toBe('action');
  });

  it('a scene that arrives before an engine renders when one attaches', async () => {
    applyBoardAction(DRAW);
    expect(layouts.calls.map((call) => call.spec)).toEqual([CORRECT]);
    const layout = fallbackLayout(CORRECT);
    layouts.calls[0].resolve(layout);
    await settle();

    const engine = fakeEngine();
    attach(engine);
    expect(engine.render).toHaveBeenCalledTimes(1);
    expect(engine.render).toHaveBeenLastCalledWith(store().scene, { fix: layout });
    expect(store().scene.items.map((item) => item.id)).toEqual(['fix']);

    // From then on, every change renders.
    applyBoardAction({ kind: 'board.highlight', item: 'fix', el: 'state:q3', on: true });
    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(engine.render).toHaveBeenLastCalledWith(store().scene, { fix: layout });
  });

  it('stops rendering once detached', () => {
    const engine = fakeEngine();
    const detach = store().attach(engine);
    detach();
    applyBoardAction(DRAW);
    expect(engine.render).toHaveBeenCalledTimes(1);
  });

  it('effects wait for their layout', async () => {
    const engine = fakeEngine();
    attach(engine);
    applyBoardAction(DRAW);
    applyBoardAction(PULSE);
    expect(engine.play).not.toHaveBeenCalled();

    layouts.calls[0].resolve(fallbackLayout(CORRECT));
    await settle();
    expect(engine.play).toHaveBeenCalledWith({ type: 'pulse', item: 'fix', el: 'state:q0' });
    expect(engine.play).toHaveBeenCalledTimes(1);
  });

  it('effects wait for an engine too', async () => {
    applyBoardAction(DRAW);
    layouts.calls[0].resolve(fallbackLayout(CORRECT));
    await settle();
    applyBoardAction(PULSE);
    const engine = fakeEngine();
    attach(engine);
    expect(engine.play).toHaveBeenCalledTimes(1);
  });

  it('lays out an automaton again only when its spec changes, and says how (I10)', async () => {
    applyBoardAction(DRAW);
    layouts.calls[0].resolve(fallbackLayout(CORRECT));
    await settle();
    expect(store().layoutSources).toEqual({ fix: 'graphviz' });
    applyBoardAction({ kind: 'board.reveal', item: 'fix' });
    applyBoardAction(DRAW);
    expect(layouts.calls).toHaveLength(1);
    applyBoardAction({ kind: 'board.addState', item: 'fix', id: 'q4' });
    expect(layouts.calls).toHaveLength(2);
    expect(layouts.calls[1].spec.states.map((state) => state.id)).toContain('q4');
  });

  it('a layout failure falls back with one warning', async () => {
    applyBoardAction(DRAW);
    layouts.calls[0].reject(new Error('No layout after 4000 ms'));
    await settle();
    expect(store().layouts).toEqual({ fix: fallbackLayout(CORRECT) });
    expect(store().layoutSources).toEqual({ fix: 'fallback' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/^\[board\] /);
  });

  it('a problem warns once as [board] <problem>, and the scene stays as it was', () => {
    const before = store().scene;
    applyBoardAction({ kind: 'board.reveal', item: 'fix', els: ['state:q0'] });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[board] unknown item fix');
    expect(store().scene).toBe(before);
  });

  it('reset empties the scene', async () => {
    const engine = fakeEngine();
    attach(engine);
    applyBoardAction(DRAW);
    applyBoardAction(PULSE);
    store().reset();
    expect(store().scene.items).toEqual([]);
    expect(store().layouts).toEqual({});
    expect(store().layoutSources).toEqual({});
    // A layout that lands after the reset, and the effect that waited for it, are gone too.
    layouts.calls[0].resolve(fallbackLayout(CORRECT));
    await settle();
    expect(store().layouts).toEqual({});
    expect(engine.play).not.toHaveBeenCalled();
  });
});
