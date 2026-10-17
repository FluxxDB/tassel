// @vitest-environment jsdom
// The board panel loads tldraw the first time the board shows, keeps it from then on, and
// survives tldraw failing. The canvas is a stand-in that says when its module loads.
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { useStageStore as StageStore } from '../../../src/renderer/src/features/session/stage-store';

const canvas = vi.hoisted(() => ({ loaded: vi.fn(), throws: false }));

vi.mock('../../../src/renderer/src/board/tldraw/TldrawCanvas', async () => {
  const { createElement } = await import('react');
  canvas.loaded();
  return {
    TldrawCanvas: () => {
      if (canvas.throws) throw new Error('tldraw failed to start');
      return createElement('div', { 'data-testid': 'tldraw' });
    },
  };
});

/** A fresh BoardPanel module (and so a fresh lazy canvas) and stage store for each test. */
async function freshPanel(): Promise<{ BoardPanel: ComponentType; stage: typeof StageStore }> {
  vi.resetModules();
  const { BoardPanel } = await import('../../../src/renderer/src/board/BoardPanel');
  const { useStageStore } = await import('../../../src/renderer/src/features/session/stage-store');
  return { BoardPanel, stage: useStageStore };
}

beforeEach(() => {
  canvas.loaded.mockClear();
  canvas.throws = false;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('BoardPanel', () => {
  it('the canvas mounts only once the board panel shows, and stays', async () => {
    const { BoardPanel, stage } = await freshPanel();
    render(<BoardPanel />);
    expect(screen.getByTestId('board-canvas')).toHaveClass('absolute', 'inset-0');

    // Her paper alone: tldraw isn't even loaded.
    await act(async () => {});
    expect(canvas.loaded).not.toHaveBeenCalled();
    expect(screen.queryByTestId('tldraw')).toBeNull();

    // The board shows beside the paper: tldraw loads and mounts.
    act(() => stage.getState().requestMode('split'));
    expect(await screen.findByTestId('tldraw')).toBeInTheDocument();
    expect(canvas.loaded).toHaveBeenCalledTimes(1);

    // Back to her paper: the canvas stays, so nothing on the board is lost.
    act(() => stage.getState().requestMode('paper'));
    expect(screen.getByTestId('tldraw')).toBeInTheDocument();
    act(() => stage.getState().pin('board'));
    expect(screen.getAllByTestId('tldraw')).toHaveLength(1);
  });

  it('a canvas that throws leaves the dotted panel and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // React reports the error it caught; that's not this panel's warning.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    canvas.throws = true;
    const { BoardPanel, stage } = await freshPanel();
    render(
      <>
        <BoardPanel />
        <p>The session goes on</p>
      </>,
    );
    act(() => stage.getState().requestMode('board'));
    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(String(warn.mock.calls[0][0])).toMatch(/^\[tassel\] /);

    // The panel is still there, empty, so P1's dotted canvas shows; the session carries on.
    expect(screen.getByTestId('board-canvas')).toBeEmptyDOMElement();
    expect(screen.getByText('The session goes on')).toBeInTheDocument();
    act(() => stage.getState().requestMode('paper'));
    act(() => stage.getState().requestMode('split'));
    await act(async () => {});
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
