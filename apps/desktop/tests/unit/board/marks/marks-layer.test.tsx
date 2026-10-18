// @vitest-environment jsdom
import type { ApiClient, Session } from '@tassel/shared/api';
import type { FrameRef, PaperAction, PaperMark, PaperTarget, Pt } from '@tassel/shared/beats';
import type { Lang } from '@tassel/shared/i18n';
import { act, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { i18n as I18n } from 'i18next';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_DFA_WRONG } from '../../../../src/renderer/src/board/marks/fixture-paper';
import { resolveTarget, stepDotFor } from '../../../../src/renderer/src/board/marks/geometry';
import {
  applyPaperAction,
  useMarksStore,
} from '../../../../src/renderer/src/board/marks/marks-store';
import { PaperMarksLayer } from '../../../../src/renderer/src/board/marks/PaperMarksLayer';
import {
  containFit,
  type Fit,
  rectProjector,
} from '../../../../src/renderer/src/board/marks/project';
import { SnapshotTag } from '../../../../src/renderer/src/board/marks/SnapshotTag';
import {
  type LoadedFrame,
  registerSnapshotSource,
  type SnapshotSource,
} from '../../../../src/renderer/src/board/marks/snapshot-sources';
import {
  forgetCurrentSession,
  useCurrentSession,
} from '../../../../src/renderer/src/features/session/current-session';
import { initI18n } from '../../../../src/renderer/src/i18n';
import { ApiProvider } from '../../../../src/renderer/src/lib/api';

const SESSION: Session = {
  id: '5b1e6f0a-3c2d-4e8f-9a7b-6c5d4e3f2a1b',
  title: null,
  title_source: null,
  subject: null,
  type: 'homework',
  language: 'en',
  source: 'paper',
  created_at: '2026-10-17T12:00:00.000000Z',
  last_activity_at: '2026-10-17T12:00:00.000000Z',
};

const FREEZE_FIXTURE: PaperAction = {
  kind: 'paper.freeze',
  frame: { kind: 'fixture', name: 'dfa-wrong' },
};
const at = (el: string) => ({ el }) as PaperTarget;
/** The demo's marks: steps 1–4 along 1010, the washed circle and the callout on q0's loop. */
const DEMO_MARKS: PaperMark[] = [
  { type: 'step', id: 's1', n: 1, target: at('edge:q0>q0') },
  { type: 'step', id: 's2', n: 2, target: at('edge:q0>q1') },
  { type: 'step', id: 's3', n: 3, target: at('edge:q1>q2') },
  { type: 'step', id: 's4', n: 4, target: at('edge:q2>q3') },
  { type: 'circle', id: 'circle', target: at('edge:q0>q0'), wash: true },
  {
    type: 'callout',
    id: 'callout',
    target: at('edge:q0>q0'),
    text: 'A leading 1 loops here, so 1010 gets in',
  },
];
// 140 characters (Review Focus 4).
const LONG_SPANISH =
  'Este bucle en q0 deja pasar al 1010: con un 1 al principio te quedas en q0, y luego el 010 te lleva hasta q3, que así acepta toda la cadena.';

/** A ResizeObserver the test drives: resizePanel() reports a new size for the layer. */
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

/** Gives the snapshot layer a new size, as the stage's reflow or a window resize would. */
function resizePanel(width: number, height: number): void {
  act(() => {
    for (const observer of [...observers]) {
      for (const target of observer.targets) {
        if (target.getAttribute('data-testid') === 'paper-snapshot') {
          observer.fire(target, width, height);
        }
      }
    }
  });
}

let i18n: I18n;
let unregister: Array<() => void> = [];
const register = (kind: FrameRef['kind'], source: SnapshotSource) => {
  unregister.push(registerSnapshotSource(kind, source));
};

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function fakeApi(session: Session = SESSION): ApiClient {
  const GET = vi.fn(async () => ({ data: session, response: new Response(null) }));
  return { GET } as unknown as ApiClient;
}

/** The layer and the tag, as the stage mounts them, in an English UI. */
function renderLayer() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ApiProvider client={fakeApi()}>
        <PaperMarksLayer />
        <SnapshotTag />
      </ApiProvider>
    </I18nextProvider>,
  );
}

/** Opens a session in `language`, as the session screen's load does. */
async function openSession(language: Lang): Promise<void> {
  const client = fakeApi({ ...SESSION, language });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ApiProvider client={client}>{children}</ApiProvider>
  );
  const { result } = renderHook(() => useCurrentSession(), { wrapper });
  await act(() => result.current.load(SESSION.id));
}

/** Freezes the paper, waits for the snapshot, then makes `marks`. */
async function freeze(action: PaperAction = FREEZE_FIXTURE, marks: PaperMark[] = []) {
  await act(async () => {
    applyPaperAction(action);
    await flush();
  });
  act(() => {
    for (const mark of marks) applyPaperAction({ kind: 'paper.mark', mark });
  });
}

function urlFrame(capturedAt: string): { frame: LoadedFrame; revoke: () => void } {
  const revoke = vi.fn();
  return {
    revoke,
    frame: {
      image: { kind: 'url', url: 'blob:app://tassel/frame-1', w: 960, h: 720, revoke },
      project: rectProjector(960, 720),
      capturedAt,
    },
  };
}

function dotCenter(id: string): Pt {
  const dot = screen.getByTestId(`mark-step-${id}`).querySelector('circle');
  if (!dot) throw new Error(`step ${id} has no dot`);
  return { x: Number(dot.getAttribute('cx')), y: Number(dot.getAttribute('cy')) };
}

function expectedDot(el: string, fit: Fit): Pt {
  const target = resolveTarget(at(el), FIXTURE_DFA_WRONG.elements, rectProjector(1100, 850), fit);
  if (!target) throw new Error(`${el} didn't resolve`);
  return stepDotFor(target, 0);
}

function expectNear(actual: Pt, expected: Pt): void {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
}

beforeAll(async () => {
  i18n = await initI18n('en');
});
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  useMarksStore.getState().reset();
});
afterEach(() => {
  for (const off of unregister) off();
  unregister = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  forgetCurrentSession();
  useMarksStore.getState().reset();
});

describe('PaperMarksLayer', () => {
  it('renders nothing while live', () => {
    renderLayer();
    expect(screen.queryByTestId('paper-snapshot')).toBeNull();
    expect(screen.queryByTestId('snapshot-tag')).toBeNull();
    // Nothing is observed until there's a snapshot to fit (plan review M11).
    expect(observers.size).toBe(0);
  });

  it('frozen shows the page with step dots 1–4, a circle and a callout', async () => {
    renderLayer();
    await freeze(FREEZE_FIXTURE, DEMO_MARKS);
    resizePanel(1408, 736);

    const snapshot = screen.getByTestId('paper-snapshot');
    expect(snapshot).toHaveClass('absolute', 'inset-0', 'z-[5]', 'bg-paper');
    // The fixture page stands in for the photo, its ink tagged piece by piece.
    expect(within(snapshot).getByRole('img', { name: 'A snapshot of your paper' })).toBeVisible();
    for (const ink of ['start', 'state:q0', 'state:q3', 'edge:q0>q0', 'edge:q2>q3', 'edge:q3>q3']) {
      expect(snapshot.querySelector(`[data-ink="${ink}"]`)).not.toBeNull();
    }
    for (const n of [1, 2, 3, 4]) {
      expect(screen.getByTestId(`mark-step-s${n}`)).toHaveTextContent(String(n));
    }
    expect(screen.getByTestId('mark-circle-circle')).toBeInTheDocument();
    expect(screen.getByTestId('mark-callout-callout')).toHaveTextContent(
      'A leading 1 loops here, so 1010 gets in',
    );
    const fit = containFit({ w: 1100, h: 850 }, { w: 1408, h: 736 });
    expectNear(dotCenter('s2'), expectedDot('edge:q0>q1', fit));
  });

  it('draws its strokes on and fades its dots and pills in, at MOTION’s pace', async () => {
    renderLayer();
    await freeze(FREEZE_FIXTURE, DEMO_MARKS);
    resizePanel(1408, 736);
    const ring = screen.getByTestId('mark-circle-circle').querySelector('path.mark-draw');
    expect(ring).toHaveAttribute('pathLength', '1');
    expect((ring as SVGElement).style.animationDuration).toBe('320ms');
    expect(screen.getByTestId('mark-callout-callout')).toHaveClass('mark-fade');
    expect(screen.getByTestId('mark-callout-callout').style.animationDuration).toBe('150ms');
    expect(screen.getByTestId('mark-step-s1')).toHaveClass('mark-fade');
  });

  it('refits the page and its marks on every resize (Review Focus 3)', async () => {
    renderLayer();
    await freeze(FREEZE_FIXTURE, DEMO_MARKS);
    const panels = [
      { w: 1408, h: 736 },
      { w: 698, h: 736 },
      { w: 992, h: 516 },
      { w: 490, h: 516 },
    ];
    for (const panel of panels) {
      resizePanel(panel.w, panel.h);
      const fit = containFit({ w: 1100, h: 850 }, panel);
      const page = screen.getByTestId('snapshot-image');
      expect(Number.parseFloat(page.style.left)).toBeCloseTo(fit.x, 6);
      expect(Number.parseFloat(page.style.top)).toBeCloseTo(fit.y, 6);
      expect(Number.parseFloat(page.style.width)).toBeCloseTo(1100 * fit.scale, 6);
      expect(Number.parseFloat(page.style.height)).toBeCloseTo(850 * fit.scale, 6);
      expectNear(dotCenter('s2'), expectedDot('edge:q0>q1', fit));
      expectNear(dotCenter('s4'), expectedDot('edge:q2>q3', fit));
    }
  });

  it('resets the store when it mounts and when it unmounts (M11)', async () => {
    await act(async () => {
      applyPaperAction(FREEZE_FIXTURE);
      await flush();
    });
    expect(useMarksStore.getState().status).toBe('frozen');
    const before = Date.now();
    const { unmount } = renderLayer();
    // A new session screen starts on her live paper, with the session's clock started.
    expect(useMarksStore.getState()).toMatchObject({ status: 'live', snapshot: null });
    expect(useMarksStore.getState().sessionStartedAt).toBeGreaterThanOrEqual(before);

    const { frame, revoke } = urlFrame(new Date().toISOString());
    register('frame', { load: async () => frame });
    await freeze({ kind: 'paper.freeze', frame: { kind: 'frame', id: 'f1' } });
    expect(useMarksStore.getState().status).toBe('frozen');
    unmount();
    expect(useMarksStore.getState()).toMatchObject({ status: 'live', snapshot: null });
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('a 140-character Spanish callout gets max-width 320px and a position inside the panel', async () => {
    expect([...LONG_SPANISH]).toHaveLength(140);
    await openSession('es');
    // Its size as layout makes it: 320 wide, wrapped onto six lines.
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.dataset.testid?.startsWith('mark-callout-') ? 320 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.dataset.testid?.startsWith('mark-callout-') ? 152 : 0;
    });
    renderLayer();
    await freeze(FREEZE_FIXTURE, [
      { type: 'callout', id: 'c2', target: at('state:q3'), text: LONG_SPANISH },
    ]);
    // The paper beside the board at 1024×680.
    resizePanel(490, 516);

    const pill = screen.getByTestId('mark-callout-c2');
    expect(pill).toHaveTextContent(LONG_SPANISH);
    expect(pill).toHaveAttribute('lang', 'es');
    expect(pill).toHaveStyle({ maxWidth: '320px' });
    const left = Number.parseFloat(pill.style.left);
    const top = Number.parseFloat(pill.style.top);
    expect(left).toBeGreaterThanOrEqual(14);
    expect(left + 320).toBeLessThanOrEqual(490 - 14);
    expect(top).toBeGreaterThanOrEqual(54);
    expect(top + 152).toBeLessThanOrEqual(516 - 14);
  });

  it('places a callout whose id every object has (__proto__) like any other', async () => {
    const error = vi.spyOn(console, 'error');
    renderLayer();
    await freeze(FREEZE_FIXTURE, [
      { type: 'callout', id: '__proto__', target: at('state:q1'), text: 'Look here.' },
    ]);
    resizePanel(698, 736);
    const pill = screen.getByTestId('mark-callout-__proto__');
    expect(Number.isFinite(Number.parseFloat(pill.style.left))).toBe(true);
    expect(Number.isFinite(Number.parseFloat(pill.style.top))).toBe(true);
    // Not even its first render placed it at NaN.
    expect(error).not.toHaveBeenCalled();
  });

  it('a Korean callout keeps its words whole', async () => {
    await openSession('ko');
    renderLayer();
    await freeze(FREEZE_FIXTURE, [
      {
        type: 'callout',
        id: 'c3',
        target: at('edge:q0>q0'),
        text: '이 루프 때문에 1010이 통과해요.',
      },
    ]);
    resizePanel(698, 736);
    const pill = screen.getByTestId('mark-callout-c3');
    expect(pill).toHaveAttribute('lang', 'ko');
    expect(pill.className).toContain('ko:[word-break:keep-all]');
  });

  it('the description lists the marks in the session language', async () => {
    await openSession('es');
    renderLayer();
    await freeze(FREEZE_FIXTURE, [
      ...DEMO_MARKS,
      { type: 'arrow', id: 'm2', from: { at: { x: 0.5, y: 0.2 } }, to: at('state:q1') },
      { type: 'strike', id: 'm5', target: at('start') },
      { type: 'check', id: 'm6', target: { at: { x: 0.81, y: 0.4 } } },
      { type: 'underline', id: 'm7', target: at('state:q1') },
    ]);
    resizePanel(1408, 736);

    const list = screen.getByRole('list', { name: 'Las marcas de Ada en tu papel' });
    expect(list).toHaveAttribute('lang', 'es');
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Paso 1: de q0 a q0',
      'Paso 2: de q0 a q1',
      'Paso 3: de q1 a q2',
      'Paso 4: de q2 a q3',
      'Marcado: de q0 a q0',
      'Nota: A leading 1 loops here, so 1010 gets in',
      'Flecha hacia estado q1',
      'Tachado: la flecha de inicio',
      'Visto bueno: un punto de tu papel',
      'Subrayado: estado q1',
    ]);
    // Every mark is drawn too.
    for (const id of ['mark-arrow-m2', 'mark-strike-m5', 'mark-check-m6', 'mark-underline-m7']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    // The chrome stays in the UI's language.
    expect(screen.getByRole('button', { name: 'Back to live' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'A snapshot of your paper' })).toBeInTheDocument();
  });
});

describe('SnapshotTag', () => {
  it('the tag reads Snapshot 14:32 for a frame captured 14:32 into the session (M1)', async () => {
    const opened = Date.parse('2026-10-17T13:05:00.000Z');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(opened);
    renderLayer();
    clock.mockRestore();
    expect(useMarksStore.getState().sessionStartedAt).toBe(opened);

    const { frame } = urlFrame(new Date(opened + 872_000).toISOString());
    register('frame', { load: async () => frame });
    await freeze({ kind: 'paper.freeze', frame: { kind: 'frame', id: 'f1' } });
    resizePanel(698, 736);

    const tag = screen.getByTestId('snapshot-tag');
    expect(within(tag).getByTestId('snapshot-time')).toHaveTextContent(/^Snapshot 14:32$/);
    expect(within(tag).getByRole('button', { name: 'Back to live' })).toBeInTheDocument();
    // A stored frame shows as an image, contain-fit: 960×720 in 698×736.
    const image = within(screen.getByTestId('paper-snapshot')).getByRole('img', {
      name: 'A snapshot of your paper',
    });
    expect(image.tagName).toBe('IMG');
    expect(image).toHaveAttribute('src', 'blob:app://tassel/frame-1');
    const fit = containFit({ w: 960, h: 720 }, { w: 698, h: 736 });
    expect(Number.parseFloat(image.style.width)).toBeCloseTo(960 * fit.scale, 6);
    expect(Number.parseFloat(image.style.top)).toBeCloseTo(fit.y, 6);
  });

  it('Back to live returns to live', async () => {
    const user = userEvent.setup();
    renderLayer();
    await freeze(FREEZE_FIXTURE, DEMO_MARKS);
    await user.click(screen.getByRole('button', { name: 'Back to live' }));
    expect(useMarksStore.getState().status).toBe('live');
    expect(screen.queryByTestId('paper-snapshot')).toBeNull();
    expect(screen.queryByTestId('snapshot-tag')).toBeNull();
  });

  it('says it is getting the snapshot, then shows a failure for 4 s', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let fail: (error: unknown) => void = () => {};
    register('frame', {
      load: () =>
        new Promise<LoadedFrame>((_, reject) => {
          fail = reject;
        }),
    });
    renderLayer();
    act(() => applyPaperAction({ kind: 'paper.freeze', frame: { kind: 'frame', id: 'f1' } }));
    expect(screen.getByTestId('snapshot-tag')).toHaveTextContent('Getting the snapshot…');
    expect(screen.queryByTestId('paper-snapshot')).toBeNull();

    vi.useFakeTimers();
    await act(async () => {
      fail(new Error('the frame is gone'));
      await flush();
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('snapshot-tag')).toHaveTextContent("Couldn't load the snapshot");
    expect(screen.queryByTestId('paper-snapshot')).toBeNull();
    act(() => vi.advanceTimersByTime(3_999));
    expect(screen.getByTestId('snapshot-tag')).toHaveTextContent("Couldn't load the snapshot");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId('snapshot-tag')).toBeNull();
  });
});
