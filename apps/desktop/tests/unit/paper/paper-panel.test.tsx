// @vitest-environment jsdom
// The paper panel (Task 12): the live feed, a state card for every other status, the extras on
// P1's top line, and the tag and live dot the stage and title strip read.
import type { Lang } from '@tassel/shared/i18n';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStageStore } from '../../../src/renderer/src/features/session/stage-store';
import { initI18n } from '../../../src/renderer/src/i18n';
import type { DetectorStats } from '../../../src/renderer/src/paper/contracts';
import { PaperPanel } from '../../../src/renderer/src/paper/PaperPanel';
import { PaperTopLineExtras } from '../../../src/renderer/src/paper/PaperTopLineExtras';
import { DEFAULT_PAPER_CONFIG, setPaperConfig } from '../../../src/renderer/src/paper/paper-config';
import { usePaperStore } from '../../../src/renderer/src/paper/paper-store';
import type { PaperFeed, PaperStatus } from '../../../src/renderer/src/paper/types';
import { usePaperLive, usePaperTag } from '../../../src/renderer/src/paper/use-paper-capture';

const store = () => usePaperStore.getState();

async function renderIn(lang: Lang, ui: ReactNode) {
  const i18n = await initI18n(lang);
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

function panel(status: PaperStatus, lang: Lang = 'en') {
  act(() => usePaperStore.setState({ status }));
  return renderIn(lang, <PaperPanel fallback={<p>P1 waiting</p>} />);
}

function bridge() {
  return {
    getConfig: vi.fn(),
    startHelper: vi.fn(async () => ({ ok: false as const, reason: 'unsupported' as const })),
    stopHelper: vi.fn(async () => {}),
    cameraAccess: vi.fn(async () => 'granted' as const),
    requestCameraAccess: vi.fn(async () => true),
    openCameraSettings: vi.fn(async () => {}),
  };
}

const button = (name: string) => screen.getByRole('button', { name });

const STATS: DetectorStats = {
  t: 1_000,
  busy: false,
  occluded: false,
  quiet: 3,
  cols: 50,
  rows: 38,
  changed: [7, 8],
  solid: [],
  quad: null,
  refAgeMs: 400,
  triggers: 0,
  opencv: true,
};

function feed(devices: PaperFeed['devices']): PaperFeed {
  return {
    kind: 'deskview-helper',
    stream: { id: 'helper' } as unknown as MediaStream,
    contentRect: null,
    devices,
    onEnd: () => () => {},
    stop: () => {},
  };
}

let paperBridge: ReturnType<typeof bridge>;

beforeEach(() => {
  store().reset();
  useStageStore.getState().reset();
  setPaperConfig(DEFAULT_PAPER_CONFIG);
  paperBridge = bridge();
  vi.stubGlobal('tassel', { platform: 'darwin', paper: paperBridge });
  // jsdom has no canvas: the heatmap gets no context and draws nothing (heatmap.test.tsx draws).
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PaperPanel', () => {
  it('idle shows the fallback', async () => {
    await panel('idle');
    expect(screen.getByText('P1 waiting')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('each state shows its title, and its body where it has one, and its actions, in en', async () => {
    const cases: Array<{ status: PaperStatus; title: string; body?: string; actions: string[] }> = [
      { status: 'starting', title: 'Getting your paper ready…', actions: [] },
      {
        status: 'off',
        title: 'Camera is off',
        body: 'Turn it on when you want Ada to see your paper.',
        actions: ['Turn camera on'],
      },
      {
        status: 'denied',
        title: "Tassel can't use the camera",
        body: "Allow camera access for Tassel in System Settings, then try again. If it still doesn't work, quit and reopen Tassel.",
        actions: ['Open System Settings', 'Retry'],
      },
      {
        status: 'unavailable',
        title: 'No Desk View camera found',
        body: 'Desk View needs a recent Mac camera or an iPhone on a stand.',
        actions: ['Open Desk View setup', 'Share the Desk View window instead'],
      },
      {
        status: 'lost',
        title: 'Desk View stopped',
        body: 'The camera disconnected or another app is using it.',
        actions: ['Retry'],
      },
      {
        status: 'ended',
        title: 'Sharing stopped',
        body: "Share the Desk View window again when you're ready. If nothing appears, allow Screen & System Audio Recording for Tassel in System Settings.",
        actions: ['Share again'],
      },
      {
        status: 'error',
        title: 'Something went wrong with the camera',
        body: 'Try again. If it keeps happening, quit and reopen Tassel.',
        actions: ['Retry'],
      },
    ];
    for (const { status, title, body, actions } of cases) {
      const { unmount } = await panel(status);
      const card = screen.getByRole('status');
      expect(card).toHaveTextContent(title);
      if (body) expect(card).toHaveTextContent(body);
      expect(screen.queryAllByRole('button').map((b) => b.textContent)).toEqual(actions);
      // The first action is the ink pill, the rest are ghost buttons.
      if (actions[0]) expect(button(actions[0])).toHaveClass('bg-ink');
      for (const ghost of actions.slice(1)) expect(button(ghost)).toHaveClass('bg-transparent');
      unmount();
    }
  });

  it("every state's action does what it says", async () => {
    // The camera is off when the panel says so.
    act(() => useStageStore.setState({ cameraOn: false }));
    let view = await panel('off');
    fireEvent.click(button('Turn camera on'));
    expect(useStageStore.getState().cameraOn).toBe(true);
    view.unmount();

    for (const status of ['denied', 'lost', 'error'] as const) {
      view = await panel(status);
      const before = store().restartNonce;
      fireEvent.click(button('Retry'));
      expect(store()).toMatchObject({ restartNonce: before + 1, retrying: true });
      view.unmount();
    }

    view = await panel('ended');
    fireEvent.click(button('Share again'));
    expect(store().retrying).toBe(true);
    view.unmount();

    view = await panel('unavailable');
    fireEvent.click(button('Share the Desk View window instead'));
    expect(store().override).toBe('window-capture');
    fireEvent.click(button('Open Desk View setup'));
    await act(async () => {});
    // Task 10's openDeskViewSetup, which starts the helper (here it can't: unsupported).
    expect(paperBridge.startHelper).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('denied in es shows Abrir Configuración del Sistema, which calls openCameraSettings', async () => {
    await panel('denied', 'es');
    expect(screen.getByRole('status')).toHaveTextContent('Tassel no puede usar la cámara');
    fireEvent.click(button('Abrir Configuración del Sistema'));
    expect(paperBridge.openCameraSettings).toHaveBeenCalledTimes(1);
    expect(button('Reintentar')).toBeInTheDocument();
  });

  it('unavailable in ko shows both actions', async () => {
    await panel('unavailable', 'ko');
    expect(screen.getByRole('status')).toHaveTextContent('Desk View 카메라를 찾지 못했어요');
    expect(button('Desk View 설정 열기')).toBeInTheDocument();
    expect(button('대신 Desk View 창 공유하기')).toBeInTheDocument();
  });

  it('the state card is 320px wide in every language', async () => {
    for (const lang of ['en', 'es', 'ko'] as const) {
      for (const status of ['off', 'denied', 'unavailable', 'ended'] as const) {
        const { unmount } = await panel(status, lang);
        expect(screen.getByRole('status')).toHaveClass('w-[320px]');
        unmount();
      }
    }
  });

  it('live shows the video on the desk, with no spinner and no card', async () => {
    act(() => store().setFeed(feed([])));
    await panel('live');
    const video = screen.getByTestId('paper-video');
    expect(video.tagName).toBe('VIDEO');
    expect((video as HTMLVideoElement).srcObject).toEqual({ id: 'helper' });
    expect(video.parentElement).toHaveClass('bg-desk');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('no heatmap toggle unless debug', async () => {
    act(() => {
      store().setFeed(feed([]));
      store().setStats(STATS);
    });
    const plain = await panel('live');
    expect(screen.queryByRole('button', { name: /Heatmap/ })).not.toBeInTheDocument();
    plain.unmount();

    setPaperConfig({ ...DEFAULT_PAPER_CONFIG, debug: true });
    await panel('live');
    const toggle = button('Heatmap');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.getByText('deskview-helper · 2 changed · quiet 3/5 · 0 sent'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/OpenCV didn't load/)).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('paper-heatmap')).toBeInTheDocument();
    act(() => store().setOpenCv(false));
    expect(screen.getByText("OpenCV didn't load: using the central crop")).toBeInTheDocument();
  });
});

describe('PaperTopLineExtras', () => {
  it('shows Switch camera only with two devices, and the failing notice only after an offline, server or auth failure', async () => {
    const view = await renderIn('en', <PaperTopLineExtras />);
    expect(view.container).toBeEmptyDOMElement();

    act(() =>
      store().setFeed(feed([{ id: 'mac', name: 'MacBook Pro Desk View Camera', builtIn: true }])),
    );
    expect(screen.queryByRole('button', { name: 'Switch camera' })).not.toBeInTheDocument();
    act(() =>
      store().setFeed(
        feed([
          { id: 'mac', name: 'MacBook Pro Desk View Camera', builtIn: true },
          { id: 'phone', name: 'iPhone Desk View Camera', builtIn: false },
        ]),
      ),
    );
    // The helper started on the built-in camera, so Switch camera moves to the iPhone, and back.
    fireEvent.click(button('Switch camera'));
    expect(store().deviceId).toBe('phone');
    fireEvent.click(button('Switch camera'));
    expect(store().deviceId).toBe('mac');
    expect(button('Switch camera')).toHaveClass('pointer-events-auto');

    const failing = "Ada can't see your latest work yet. Reconnecting…";
    for (const lastError of ['rejected', 'gone', null] as const) {
      act(() => store().setUploads({ sent: 1, pending: 0, failed: 1, lastError }));
      expect(screen.queryByText(failing)).not.toBeInTheDocument();
    }
    for (const lastError of ['offline', 'server', 'auth'] as const) {
      act(() => store().setUploads({ sent: 1, pending: 1, failed: 0, lastError }));
      expect(screen.getByText(failing)).toBeInTheDocument();
    }
    // The next success clears it.
    act(() => store().setUploads({ sent: 2, pending: 0, failed: 0, lastError: null }));
    expect(screen.queryByText(failing)).not.toBeInTheDocument();
  });
});

describe('the tag and the live dot', () => {
  async function hook<T>(use: () => T) {
    const i18n = await initI18n('en');
    return renderHook(use, {
      wrapper: ({ children }) => <I18nextProvider i18n={i18n}>{children}</I18nextProvider>,
    });
  }

  it("usePaperTag gives Desk View's tag for the helper and the fake clip, and paper.tag.window for window capture", async () => {
    const { result } = await hook(usePaperTag);
    expect(result.current).toBe('Your paper · Desk View'); // no kind yet
    for (const [kind, tag] of [
      ['deskview-helper', 'Your paper · Desk View'],
      ['fake-clip', 'Your paper · Desk View'],
      ['window-capture', 'Your paper · Desk View window'],
      ['screen', 'Your screen'],
    ] as const) {
      act(() => usePaperStore.setState({ kind }));
      expect(result.current).toBe(tag);
    }
  });

  it('usePaperLive is true only while live', async () => {
    const { result } = await hook(usePaperLive);
    for (const status of [
      'idle',
      'starting',
      'off',
      'denied',
      'unavailable',
      'lost',
      'ended',
      'error',
    ] as const) {
      act(() => store().setStatus(status));
      expect(result.current).toBe(false);
    }
    act(() => store().setStatus('live'));
    expect(result.current).toBe(true);
  });
});
