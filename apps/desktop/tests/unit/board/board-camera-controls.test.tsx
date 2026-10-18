// @vitest-environment jsdom
// The Download board button in the board's camera pill: one click saves the board as a PNG, and
// it waits, disabled with its reason, while the board is empty.
import type { ApiClient } from '@tassel/shared/api';
import type { BoardAction } from '@tassel/shared/beats';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../../src/renderer/src/i18n';
import { ApiProvider } from '../../../src/renderer/src/lib/api';
import { CORRECT } from './fixtures';

const download = vi.hoisted(() => ({ run: vi.fn(async () => true) }));
vi.mock('../../../src/renderer/src/board/download', () => ({
  downloadBoardPng: download.run,
}));
vi.mock('../../../src/renderer/src/board/layout/client', () => ({
  getLayoutClient: () => ({
    layout: () => new Promise(() => {}),
    layoutDiagram: () => new Promise(() => {}),
  }),
}));

const DRAW: BoardAction = { kind: 'board.automaton', item: 'fix', spec: CORRECT };

async function renderControls(lang: 'en' | 'es' | 'ko' = 'en') {
  const i18n = await initI18n(lang);
  const { BoardCameraControls, useBoardCamera } = await import(
    '../../../src/renderer/src/board/BoardCameraControls'
  );
  const { useBoardStore } = await import('../../../src/renderer/src/board/board-store');
  useBoardStore.getState().reset();
  const camera = { zoom: vi.fn(), fit: vi.fn(), adaAction: vi.fn() };
  useBoardCamera.setState({ camera });
  render(
    <I18nextProvider i18n={i18n}>
      <ApiProvider client={{ GET: vi.fn() } as unknown as ApiClient}>
        <BoardCameraControls />
      </ApiProvider>
    </I18nextProvider>,
  );
  return { camera, store: useBoardStore };
}

beforeEach(() => {
  download.run.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the Download board button', () => {
  it('sits after −, + and Fit, disabled with its reason while the board is empty', async () => {
    const { store } = await renderControls();
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Zoom out',
      'Zoom in',
      'Fit',
      'Download board',
    ]);
    const button = screen.getByRole('button', { name: 'Download board' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Nothing on the board to download yet');
    // The same 24 px pill as the others, with a drawn icon, not a glyph.
    expect(button).toHaveClass('h-6', 'rounded-pill');
    expect(button.querySelector('svg')).not.toBeNull();
    fireEvent.click(button);
    expect(download.run).not.toHaveBeenCalled();

    act(() => store.getState().apply(DRAW));
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('title', 'Download board');
  });

  it('downloads the board on one click', async () => {
    const { store } = await renderControls();
    act(() => store.getState().apply(DRAW));
    fireEvent.click(screen.getByRole('button', { name: 'Download board' }));
    expect(download.run).toHaveBeenCalledOnce();
  });

  it("speaks the session's language", async () => {
    await renderControls('ko');
    const button = screen.getByRole('button', { name: '보드 다운로드' });
    expect(button).toHaveAttribute('title', '아직 다운로드할 내용이 보드에 없어요');
  });
});
