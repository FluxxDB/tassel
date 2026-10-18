// @vitest-environment jsdom
// The board panel loads tldraw the first time the board shows (or Ada draws), keeps it from then
// on, hands its engine to the board store, and survives tldraw failing. The canvas is a stand-in
// that says when its module loads and offers an engine that records what it draws.
import type { ApiClient } from '@tassel/shared/api';
import type { BoardAction } from '@tassel/shared/beats';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { useBoardStore as BoardStore } from '../../../src/renderer/src/board/board-store';
import type { useStageStore as StageStore } from '../../../src/renderer/src/features/session/stage-store';
import { initI18n } from '../../../src/renderer/src/i18n';
import type { ApiProvider as Provider } from '../../../src/renderer/src/lib/api';
import { CORRECT } from './fixtures';

const canvas = vi.hoisted(() => ({
  loaded: vi.fn(),
  throws: false,
  engine: {
    render: vi.fn(),
    play: vi.fn(async () => {}),
    focus: vi.fn(),
    camera: { zoom: vi.fn(), fit: vi.fn(), adaAction: vi.fn() },
    onStudentEdit: vi.fn(() => () => {}),
    dispose: vi.fn(),
  },
  lang: [] as string[],
  /** The stage geometry the panel hands the canvas (P5-R9). */
  stage: null as null | (() => unknown),
}));

vi.mock('../../../src/renderer/src/board/tldraw/TldrawCanvas', async () => {
  const { createElement, useEffect } = await import('react');
  canvas.loaded();
  return {
    TldrawCanvas: ({
      lang,
      onEngine,
      stage,
    }: {
      lang: string;
      onEngine(engine: unknown): void;
      stage(): unknown;
    }) => {
      if (canvas.throws) throw new Error('tldraw failed to start');
      canvas.lang.push(lang);
      canvas.stage = stage;
      useEffect(() => {
        onEngine(canvas.engine);
        return () => onEngine(null);
      }, [onEngine]);
      return createElement('div', { 'data-testid': 'tldraw' });
    },
  };
});

/** Layouts that land when the test says, or never. */
const layout = vi.hoisted(() => ({ resolve: null as null | ((value: unknown) => void) }));
vi.mock('../../../src/renderer/src/board/layout/client', () => ({
  getLayoutClient: () => ({
    layout: () =>
      new Promise((resolve) => {
        layout.resolve = resolve;
      }),
    dispose: () => {},
  }),
}));

interface Fresh {
  BoardPanel: ComponentType;
  stage: typeof StageStore;
  board: typeof BoardStore;
  /** From the same fresh modules as the panel, so its context is the panel's. */
  ApiProvider: typeof Provider;
}

/** A fresh BoardPanel module (and so a fresh lazy canvas), board store and stage store. */
async function freshPanel(): Promise<Fresh> {
  vi.resetModules();
  const { BoardPanel } = await import('../../../src/renderer/src/board/BoardPanel');
  const { useStageStore } = await import('../../../src/renderer/src/features/session/stage-store');
  const { useBoardStore } = await import('../../../src/renderer/src/board/board-store');
  const { ApiProvider } = await import('../../../src/renderer/src/lib/api');
  return { BoardPanel, stage: useStageStore, board: useBoardStore, ApiProvider };
}

/** Renders the panel as the session screen does: in i18n and the API client's context. */
async function renderPanel({ BoardPanel, ApiProvider }: Fresh, extra: ComponentType | null = null) {
  const i18n = await initI18n('en');
  const api = { GET: vi.fn(() => new Promise(() => {})) } as unknown as ApiClient;
  const Extra = extra;
  return render(
    <I18nextProvider i18n={i18n}>
      <ApiProvider client={api}>
        <BoardPanel />
        {Extra && <Extra />}
      </ApiProvider>
    </I18nextProvider>,
  );
}

const DRAW: BoardAction = { kind: 'board.automaton', item: 'fix', spec: CORRECT, reveal: 'none' };

beforeEach(() => {
  canvas.loaded.mockClear();
  canvas.engine.render.mockClear();
  canvas.engine.focus.mockClear();
  canvas.stage = null;
  canvas.lang.length = 0;
  canvas.throws = false;
  layout.resolve = null;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('BoardPanel', () => {
  it('the canvas mounts only once the board panel shows, and stays', async () => {
    const fresh = await freshPanel();
    await renderPanel(fresh);
    expect(screen.getByTestId('board-canvas')).toHaveClass('absolute', 'inset-0');

    // Her paper alone: tldraw isn't even loaded.
    await act(async () => {});
    expect(canvas.loaded).not.toHaveBeenCalled();
    expect(screen.queryByTestId('tldraw')).toBeNull();

    // The board shows beside the paper: tldraw loads and mounts.
    act(() => fresh.stage.getState().requestMode('split'));
    expect(await screen.findByTestId('tldraw')).toBeInTheDocument();
    expect(canvas.loaded).toHaveBeenCalledTimes(1);

    // Back to her paper: the canvas stays, so nothing on the board is lost.
    act(() => fresh.stage.getState().requestMode('paper'));
    expect(screen.getByTestId('tldraw')).toBeInTheDocument();
    act(() => fresh.stage.getState().pin('board'));
    expect(screen.getAllByTestId('tldraw')).toHaveLength(1);
  });

  it('offers labeled zoom and Fit controls once its engine is ready', async () => {
    const fresh = await freshPanel();
    // The stage shows them in the board's top line (Stage.tsx), apart from the panel.
    const { BoardCameraControls } = await import(
      '../../../src/renderer/src/board/BoardCameraControls'
    );
    await renderPanel(fresh, BoardCameraControls);
    expect(screen.queryByRole('group', { name: 'Board camera controls' })).toBeNull();
    act(() => fresh.stage.getState().requestMode('split'));
    const zoomIn = await screen.findByRole('button', { name: 'Zoom in' });
    fireEvent.click(zoomIn);
    expect(canvas.engine.camera.zoom).toHaveBeenLastCalledWith('in');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(canvas.engine.camera.zoom).toHaveBeenLastCalledWith('out');
    fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
    expect(canvas.engine.camera.fit).toHaveBeenCalledOnce();
  });

  it('the canvas mounts once Ada draws, even with the board hidden (P5-R8)', async () => {
    const fresh = await freshPanel();
    await renderPanel(fresh);
    fresh.stage.getState().pin('paper');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    act(() => fresh.board.getState().apply(DRAW));
    expect(await screen.findByTestId('tldraw')).toBeInTheDocument();
    expect(fresh.stage.getState().mode).toBe('paper');
  });

  it("hands the canvas's engine to the board, which draws what's there in the session language", async () => {
    const fresh = await freshPanel();
    await renderPanel(fresh);
    act(() => fresh.board.getState().apply(DRAW));
    await screen.findByTestId('tldraw');
    await waitFor(() => expect(canvas.engine.render).toHaveBeenCalled());
    expect(canvas.engine.render).toHaveBeenLastCalledWith(fresh.board.getState().scene, {});
    expect(canvas.lang).toContain('en');
    expect(screen.getByTestId('board-canvas')).toHaveAttribute('lang', 'en');
  });

  it("starts every session's board blank, and leaves it blank", async () => {
    const fresh = await freshPanel();
    act(() => fresh.board.getState().apply(DRAW));
    expect(fresh.board.getState().scene.items).toHaveLength(1);
    const { unmount } = await renderPanel(fresh);
    expect(fresh.board.getState().scene.items).toHaveLength(0);
    act(() => fresh.board.getState().apply(DRAW));
    unmount();
    expect(fresh.board.getState().scene.items).toHaveLength(0);
  });

  it('says how the board was laid out, so specs can tell without tldraw (I10)', async () => {
    const fresh = await freshPanel();
    await renderPanel(fresh);
    const panel = screen.getByTestId('board-canvas');
    expect(panel).not.toHaveAttribute('data-layout');
    act(() => fresh.board.getState().apply(DRAW));
    await act(async () => {
      layout.resolve?.({
        width: 100,
        height: 100,
        states: {},
        edges: {},
        start: { from: { x: 0, y: 0 }, to: { x: 0, y: 0 } },
      });
    });
    expect(panel).toHaveAttribute('data-layout', 'graphviz');
    act(() => fresh.board.setState({ layoutSources: { fix: 'graphviz', other: 'fallback' } }));
    expect(panel).toHaveAttribute('data-layout', 'fallback');
  });

  it("hands the canvas the stage's geometry, captions setting and all (P5-R9)", async () => {
    const fresh = await freshPanel();
    await renderPanel(fresh);
    act(() => fresh.stage.getState().requestMode('split'));
    await screen.findByTestId('tldraw');
    // jsdom lays nothing out, so every box is empty; the app measures the panel and main.
    const none = { x: 0, y: 0, w: 0, h: 0 };
    expect(canvas.stage?.()).toEqual({ panel: none, main: none, captions: true, tiles: [] });
    act(() => fresh.stage.getState().toggleCaptions());
    expect(canvas.stage?.()).toEqual({ panel: none, main: none, captions: false, tiles: [] });
    // The session's floating tiles, where they rest, so her drawing stays clear of them.
    const { useFloatingTiles } = await import('../../../src/renderer/src/components/FloatingTile');
    const rect = { x: 1198, y: 74, w: 212, h: 176 };
    act(() =>
      useFloatingTiles.getState().place('tutor', { corner: 'top-right', w: 212, h: 176, rect }),
    );
    expect(canvas.stage?.()).toMatchObject({ tiles: [rect] });
  });

  it("refits Ada's focus when a floating tile moves or resizes, not when it stays put", async () => {
    const fresh = await freshPanel();
    const { useFloatingTiles } = await import('../../../src/renderer/src/components/FloatingTile');
    const ada = {
      corner: 'top-right' as const,
      w: 212,
      h: 176,
      rect: { x: 1198, y: 74, w: 212, h: 176 },
    };
    useFloatingTiles.getState().place('tutor', ada);
    await renderPanel(fresh);
    act(() => fresh.stage.getState().requestMode('split'));
    await screen.findByTestId('tldraw');
    await waitFor(() => expect(canvas.engine.render).toHaveBeenCalled());
    expect(canvas.engine.focus).not.toHaveBeenCalled();

    act(() => useFloatingTiles.getState().place('tutor', { ...ada }));
    expect(canvas.engine.focus).not.toHaveBeenCalled();
    act(() =>
      useFloatingTiles
        .getState()
        .place('tutor', { ...ada, corner: 'bottom-left', rect: { x: 30, y: 510, w: 212, h: 176 } }),
    );
    expect(canvas.engine.focus).toHaveBeenCalledTimes(1);
    expect(canvas.engine.focus).toHaveBeenLastCalledWith(null, { animate: true });
    act(() => useFloatingTiles.getState().remove('tutor'));
    expect(canvas.engine.focus).toHaveBeenCalledTimes(2);
  });

  it("refits Ada's focus when captions go on or off, not as their lines come and go", async () => {
    const fresh = await freshPanel();
    await renderPanel(fresh);
    act(() => fresh.stage.getState().requestMode('split'));
    await screen.findByTestId('tldraw');
    await waitFor(() => expect(canvas.engine.render).toHaveBeenCalled());
    expect(canvas.engine.focus).not.toHaveBeenCalled();

    act(() => fresh.stage.getState().pushCaption('tutor', "Here's one. We start at q0."));
    act(() => fresh.stage.getState().pushCaption('student', 'Okay.'));
    expect(canvas.engine.focus).not.toHaveBeenCalled();

    act(() => fresh.stage.getState().toggleCaptions());
    expect(canvas.engine.focus).toHaveBeenCalledTimes(1);
    expect(canvas.engine.focus).toHaveBeenLastCalledWith(null, { animate: true });
    act(() => fresh.board.getState().apply(DRAW));
    act(() => fresh.stage.getState().toggleCaptions());
    expect(canvas.engine.focus).toHaveBeenCalledTimes(2);
    expect(canvas.engine.focus).toHaveBeenLastCalledWith('fix', { animate: true });
  });

  it('describes the board in a visually hidden list', async () => {
    const fresh = await freshPanel();
    await renderPanel(fresh);
    expect(screen.getByRole('list', { name: "What's on Ada's board" })).toHaveClass('sr-only');
  });

  it('a canvas that throws leaves the dotted panel and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // React reports the error it caught; that's not this panel's warning.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    canvas.throws = true;
    const fresh = await freshPanel();
    const Note = () => <p>The session goes on</p>;
    await renderPanel(fresh, Note);
    act(() => fresh.stage.getState().requestMode('board'));
    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(String(warn.mock.calls[0][0])).toMatch(/^\[tassel\] /);

    // The panel is still there, with no canvas, so P1's dotted canvas shows; the session goes on.
    expect(screen.queryByTestId('tldraw')).toBeNull();
    expect(screen.getByText('The session goes on')).toBeInTheDocument();
    act(() => fresh.stage.getState().requestMode('paper'));
    act(() => fresh.stage.getState().requestMode('split'));
    await act(async () => {});
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
