// @vitest-environment jsdom
// The student's image on the stage: it takes the paper panel's slot, Ada's marks sit on it,
// scaled to the image itself, and Back to paper brings her paper back.
import type { ApiClient } from '@tassel/shared/api';
import type { DetectedElements, ImageAction, PaperMark } from '@tassel/shared/beats';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { i18n as I18n } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTarget, stepDotFor } from '../../../../src/renderer/src/board/marks/geometry';
import {
  applyImageAction,
  type ImageSource,
  type LoadedImage,
  registerImageSource,
  useImageStore,
} from '../../../../src/renderer/src/board/marks/image-store';
import { useMarksStore } from '../../../../src/renderer/src/board/marks/marks-store';
import { containFit, rectProjector } from '../../../../src/renderer/src/board/marks/project';
import { showImageOnStage } from '../../../../src/renderer/src/features/chat/image-stage';
import { Stage } from '../../../../src/renderer/src/features/session/Stage';
import { useStageStore } from '../../../../src/renderer/src/features/session/stage-store';
import { initI18n } from '../../../../src/renderer/src/i18n';
import { ApiProvider } from '../../../../src/renderer/src/lib/api';

const A = '0f6a1d2e-7b3c-4d5e-8f90-1a2b3c4d5e6f';
const B = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const DETECTED: DetectedElements = {
  width: 960,
  height: 720,
  items: [
    { id: 'm1', kind: 'label', box: { x: 100, y: 100, w: 200, h: 60 } },
    { id: 'm2', kind: 'circle', box: { x: 400, y: 300, w: 120, h: 120 } },
  ],
};

const show = (attachmentId: string): ImageAction => ({ kind: 'image.show', attachmentId });
const mark = (attachmentId: string, m: PaperMark): ImageAction => ({
  kind: 'image.mark',
  attachmentId,
  mark: m,
});

/** A ResizeObserver the test drives: resizeLayer() reports a new size for the image layer. */
const observers = new Set<FakeResizeObserver>();
class FakeResizeObserver {
  readonly targets = new Set<Element>();
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.targets.add(target);
    observers.add(this);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
    observers.delete(this);
  }
  fire(target: Element, width: number, height: number) {
    const entry = { target, contentRect: { width, height } } as unknown as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }
}

function resizeLayer(width: number, height: number): void {
  act(() => {
    for (const observer of [...observers]) {
      for (const target of observer.targets) {
        if (target.getAttribute('data-testid') === 'stage-image-layer') {
          observer.fire(target, width, height);
        }
      }
    }
  });
}

/** A source answering at once with a 960×720 image, with its Set-of-Mark for A only. */
function instantSource() {
  const revokes: string[] = [];
  const source: ImageSource = {
    async load(attachmentId) {
      const image: LoadedImage = {
        url: `blob:app://tassel/${attachmentId}`,
        w: 960,
        h: 720,
        revoke: () => revokes.push(attachmentId),
        ...(attachmentId === A && { detected: DETECTED }),
      };
      return image;
    },
  };
  return { source, revokes };
}

let i18n: I18n;
let unregister: Array<() => void> = [];

async function renderStage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ApiProvider client={{ GET: vi.fn() } as unknown as ApiClient}>
        <Stage source="paper" />
      </ApiProvider>
    </I18nextProvider>,
  );
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

const paperPanel = () => screen.getByRole('region', { name: /Your paper · Desk View|Your image/ });
const stage = () => useStageStore.getState();

beforeAll(async () => {
  i18n = await initI18n('en');
});
beforeEach(() => {
  vi.stubGlobal('tassel', { platform: 'darwin' });
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  stage().reset();
  useMarksStore.getState().reset();
  useImageStore.getState().reset();
});
afterEach(() => {
  for (const off of unregister) off();
  unregister = [];
  useImageStore.getState().reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the image on the stage', () => {
  it('takes the paper panel, tagged as her image, until Back to paper', async () => {
    const { source } = instantSource();
    unregister.push(registerImageSource(source));
    const user = userEvent.setup();
    await renderStage();
    expect(screen.getByRole('region', { name: 'Your paper · Desk View' })).toBeInTheDocument();
    expect(screen.queryByTestId('stage-image')).toBeNull();

    await act(async () => {
      applyImageAction(show(A));
      await flush();
    });
    const panel = screen.getByRole('region', { name: 'Your image' });
    const image = within(panel).getByTestId('stage-image');
    expect(image).toHaveAttribute('src', `blob:app://tassel/${A}`);
    expect(image).toHaveAttribute('alt', 'The image you sent');
    const topLine = panel.querySelector('[data-top-line]');
    if (!topLine) throw new Error('no top line');
    expect(within(topLine as HTMLElement).getByText('Your image')).toHaveClass('mono');
    // The paper's own snapshot pill stays out of the way while the image is up.
    expect(screen.queryByTestId('snapshot-tag')).toBeNull();

    await user.click(within(topLine as HTMLElement).getByRole('button', { name: 'Back to paper' }));
    expect(screen.getByRole('region', { name: 'Your paper · Desk View' })).toBeInTheDocument();
    expect(screen.queryByTestId('stage-image')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back to paper' })).toBeNull();
  });

  it("draws Ada's marks on it, scaled to the image, each image's own", async () => {
    const { source } = instantSource();
    unregister.push(registerImageSource(source));
    await renderStage();
    await act(async () => {
      applyImageAction(show(A));
      applyImageAction(mark(A, { type: 'step', id: 's1', n: 1, target: { el: 'm1' } }));
      applyImageAction(mark(A, { type: 'circle', id: 'ring', target: { el: 'm2' }, wash: true }));
      applyImageAction(
        mark(A, {
          type: 'callout',
          id: 'why',
          target: { box: { x: 0.1, y: 0.6, w: 0.3, h: 0.1 } },
          text: 'This line is where the sign flips.',
        }),
      );
      applyImageAction(mark(B, { type: 'check', id: 'ok', target: { at: { x: 0.5, y: 0.5 } } }));
      await flush();
    });
    resizeLayer(800, 600);
    const panel = paperPanel();
    expect(within(panel).getByTestId('mark-step-s1')).toHaveTextContent('1');
    expect(within(panel).getByTestId('mark-circle-ring')).toBeInTheDocument();
    expect(within(panel).getByTestId('mark-callout-why')).toHaveTextContent(
      'This line is where the sign flips.',
    );
    // B's check mark is B's: it isn't on A.
    expect(within(panel).queryByTestId('mark-check-ok')).toBeNull();
    // The step dot sits where m1's box projects, through the image's own fit.
    const fit = containFit({ w: 960, h: 720 }, { w: 800, h: 600 });
    const resolved = resolveTarget(
      { el: 'm1' },
      { states: {}, edges: {}, detected: DETECTED },
      rectProjector(960, 720),
      fit,
    );
    if (!resolved) throw new Error('m1 did not resolve');
    const expected = stepDotFor(resolved, 0);
    const dot = within(panel).getByTestId('mark-step-s1').querySelector('circle');
    expect(Number(dot?.getAttribute('cx'))).toBeCloseTo(expected.x, 5);
    expect(Number(dot?.getAttribute('cy'))).toBeCloseTo(expected.y, 5);
    // In words too, for a screen reader.
    expect(
      within(panel).getByRole('list', { name: "Ada's marks on your image" }),
    ).toHaveTextContent('Step 1');

    // Switching to B shows B's marks; clearing A takes A's away for when it comes back.
    await act(async () => {
      applyImageAction(show(B));
      await flush();
    });
    expect(within(paperPanel()).getByTestId('mark-check-ok')).toBeInTheDocument();
    expect(within(paperPanel()).queryByTestId('mark-step-s1')).toBeNull();
    await act(async () => {
      applyImageAction({ kind: 'image.clear', attachmentId: A });
      applyImageAction(show(A));
      await flush();
    });
    expect(within(paperPanel()).queryByTestId('mark-step-s1')).toBeNull();
    expect(within(paperPanel()).queryByTestId('mark-circle-ring')).toBeNull();
  });

  it('says so while loading and when the load fails, her paper staying up', async () => {
    let settle: (image: LoadedImage) => void = () => {};
    let fail: (error: unknown) => void = () => {};
    unregister.push(
      registerImageSource({
        load: () =>
          new Promise<LoadedImage>((resolve, reject) => {
            settle = resolve;
            fail = reject;
          }),
      }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await renderStage();
    act(() => applyImageAction(show(A)));
    expect(screen.getByRole('status')).toHaveTextContent('Getting your image…');
    expect(screen.queryByTestId('stage-image')).toBeNull();
    await act(async () => {
      fail(new Error('404'));
      await flush();
    });
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't load your image");
    expect(screen.getByRole('region', { name: 'Your paper · Desk View' })).toBeInTheDocument();
    expect(warn).toHaveBeenCalledTimes(1);

    act(() => applyImageAction(show(B)));
    await act(async () => {
      settle({ url: 'blob:b', w: 10, h: 10, revoke: () => {} });
      await flush();
    });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByTestId('stage-image')).toHaveAttribute('src', 'blob:b');
  });

  it("shows the chat's image and brings the panel in beside the board", async () => {
    const { source } = instantSource();
    unregister.push(registerImageSource(source));
    await renderStage();
    act(() => stage().requestMode('board'));
    await act(async () => {
      expect(showImageOnStage(A)).toBe(true);
      await flush();
    });
    expect(stage()).toMatchObject({ mode: 'split', requested: 'split', pinned: null });
    expect(screen.getByTestId('stage-image')).toBeInTheDocument();

    // With the board pinned, the student's own click pins the two side by side.
    act(() => stage().pin('board'));
    await act(async () => {
      showImageOnStage(B);
      await flush();
    });
    expect(stage()).toMatchObject({ mode: 'split', pinned: 'split' });
  });

  it('is gone, and its images let go, once the stage unmounts', async () => {
    const { source, revokes } = instantSource();
    unregister.push(registerImageSource(source));
    const view = await renderStage();
    await act(async () => {
      applyImageAction(show(A));
      await flush();
    });
    view.unmount();
    expect(useImageStore.getState().shown).toBeNull();
    expect(revokes).toEqual([A]);
    expect(showImageOnStage(A)).toBe(false);
  });
});
