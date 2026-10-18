// @vitest-environment jsdom
import type { ApiClient } from '@tassel/shared/api';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Stage } from '../../src/renderer/src/features/session/Stage';
import { useStageStore } from '../../src/renderer/src/features/session/stage-store';
import { initI18n } from '../../src/renderer/src/i18n';
import { ApiProvider } from '../../src/renderer/src/lib/api';
import { usePaperStore } from '../../src/renderer/src/paper/paper-store';

const stage = () => useStageStore.getState();

/** A stream whose tracks only say whether anyone stopped them. */
function fakeStream() {
  const track = { stop: vi.fn(), kind: 'video' };
  const stream = {
    id: 'desk',
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track };
}

function goLive(stream: MediaStream) {
  act(() => {
    usePaperStore.getState().setFeed({
      kind: 'fake-clip',
      stream,
      contentRect: null,
      devices: [],
      onEnd: () => () => {},
      stop: () => {},
    });
    usePaperStore.getState().setStatus('live');
  });
}

async function renderStage() {
  const i18n = await initI18n('en');
  return render(
    <I18nextProvider i18n={i18n}>
      <ApiProvider client={{ GET: vi.fn() } as unknown as ApiClient}>
        <Stage source="paper" />
      </ApiProvider>
    </I18nextProvider>,
  );
}

/** matchMedia answering `reduce` for prefers-reduced-motion and nothing else. */
function reducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion: reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

beforeEach(() => {
  vi.stubGlobal('tassel', { platform: 'darwin' });
  localStorage.clear();
  stage().reset();
  usePaperStore.getState().reset();
});
afterEach(() => vi.unstubAllGlobals());

describe('the desk camera picture in picture', () => {
  it('shows only on the board, with her camera on and a stream', async () => {
    const { stream } = fakeStream();
    await renderStage();
    goLive(stream);
    const pip = () => screen.queryByRole('group', { name: 'Your desk' });
    expect(pip()).toBeNull();
    act(() => stage().requestMode('board'));
    expect(pip()).toBeInTheDocument();
    expect(pip()).toHaveTextContent(/Your desk/);
    expect(pip()).toHaveTextContent(/Live/);
    expect(pip()?.querySelector('video')).toHaveProperty('srcObject', stream);
    act(() => stage().requestMode('split'));
    expect(pip()).toBeNull();
    act(() => stage().requestMode('board'));
    act(() => stage().toggleCamera());
    expect(pip()).toBeNull();
  });

  it('stays hidden on the board without a stream', async () => {
    await renderStage();
    act(() => stage().requestMode('board'));
    expect(screen.queryByRole('group', { name: 'Your desk' })).toBeNull();
  });

  it('lets go of the stream when it hides, without stopping its tracks', async () => {
    const { stream, track } = fakeStream();
    await renderStage();
    goLive(stream);
    act(() => stage().requestMode('board'));
    const video = screen.getByRole('group', { name: 'Your desk' }).querySelector('video');
    act(() => stage().requestMode('paper'));
    expect(video).toHaveProperty('srcObject', null);
    expect(track.stop).not.toHaveBeenCalled();
  });

  it('pins the split view on a double click, and on Enter', async () => {
    const { stream } = fakeStream();
    await renderStage();
    goLive(stream);
    act(() => stage().requestMode('board'));
    fireEvent.doubleClick(screen.getByRole('group', { name: 'Your desk' }));
    expect(stage()).toMatchObject({ pinned: 'split', mode: 'split' });

    act(() => stage().pin('board'));
    fireEvent.keyDown(screen.getByRole('group', { name: 'Your desk' }), { key: 'Enter' });
    expect(stage()).toMatchObject({ pinned: 'split', mode: 'split' });
  });
});

describe("Ada's tile", () => {
  it('floats, and breathes its iris ring only while she speaks', async () => {
    reducedMotion(false);
    await renderStage();
    expect(screen.getByRole('group', { name: "Ada's tile" })).toBeInTheDocument();
    const tile = screen.getByTestId('tutor-tile');
    for (const state of ['connecting', 'listening', 'thinking', 'watching'] as const) {
      act(() => stage().setTutorState(state));
      expect(tile).not.toHaveClass('tutor-speaking-pulse');
    }
    act(() => stage().setTutorState('speaking'));
    expect(tile).toHaveClass('tutor-speaking-pulse', 'shadow-[0_0_0_2px_var(--color-iris)]');
    act(() => stage().setTutorState('listening'));
    expect(tile).not.toHaveClass('tutor-speaking-pulse');
  });

  it('keeps a still 2px ring under reduced motion', async () => {
    reducedMotion(true);
    await renderStage();
    act(() => stage().setTutorState('speaking'));
    const tile = screen.getByTestId('tutor-tile');
    expect(tile).toHaveClass('shadow-[0_0_0_2px_var(--color-iris)]');
    expect(tile).not.toHaveClass('tutor-speaking-pulse');
  });
});

describe("the board's camera controls", () => {
  it("sit in the board's top line, right after its tag, clear of the captions and tiles", async () => {
    const { useBoardCamera } = await import('../../src/renderer/src/board/BoardCameraControls');
    await renderStage();
    act(() => stage().requestMode('board'));
    expect(screen.queryByRole('group', { name: 'Board camera controls' })).toBeNull();
    const camera = { zoom: vi.fn(), fit: vi.fn(), adaAction: vi.fn() };
    act(() => useBoardCamera.setState({ camera }));
    const controls = screen.getByRole('group', { name: 'Board camera controls' });
    const board = screen.getByRole('region', { name: "Ada's board" });
    expect(board).toContainElement(controls);
    expect(controls.previousElementSibling).toHaveTextContent("Ada's board");
    // The top line lets clicks through; the controls take them.
    expect(controls).toHaveClass('pointer-events-auto');
    fireEvent.click(within(controls).getByRole('button', { name: 'Zoom in' }));
    expect(camera.zoom).toHaveBeenLastCalledWith('in');
    fireEvent.click(within(controls).getByRole('button', { name: 'Fit' }));
    expect(camera.fit).toHaveBeenCalledOnce();
    act(() => useBoardCamera.setState({ camera: undefined }));
    expect(screen.queryByRole('group', { name: 'Board camera controls' })).toBeNull();
  });
});

describe('compact captions', () => {
  it('shows at most two lines, the oldest fading out at the top', async () => {
    const i18n = await initI18n('en');
    const { Captions } = await import('../../src/renderer/src/features/session/Captions');
    render(
      <I18nextProvider i18n={i18n}>
        <Captions />
      </I18nextProvider>,
    );
    act(() => {
      stage().pushCaption('student', 'One.', 'en');
      stage().pushCaption('tutor', 'Two, and a long line that wraps.', 'en');
    });
    const lines = screen.getByTestId('caption-lines');
    // Two of Ada's 27px lines, newest at the bottom (what's cut off above fades in the app).
    expect(lines).toHaveClass('max-h-[54px]', 'overflow-hidden', 'justify-end');
    expect(lines).toHaveTextContent('One.');
    expect(screen.getByText('Two, and a long line that wraps.').closest('p')).toHaveClass(
      'leading-[27px]',
    );
  });
});
