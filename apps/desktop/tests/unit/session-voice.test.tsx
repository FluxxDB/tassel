// @vitest-environment jsdom
// The session screen with the live voice tutor (P2 Task 18): the dock's mic level and audio
// settings, push-to-talk's mic button, the language menu, Ada's connection on her tile, the mic
// notice, the developer's HUD, and an AI title typing on. The voice session's own
// resources are replaced by fakes; everything on screen is production code.
import type { ApiClient, Session } from '@tassel/shared/api';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/src/app/App';
import { useRoute } from '../../src/renderer/src/app/route-store';
import { SessionScreen } from '../../src/renderer/src/features/session/SessionScreen';
import { useStageStore } from '../../src/renderer/src/features/session/stage-store';
import { useAudioPrefs } from '../../src/renderer/src/features/voice/audio-prefs';
import { useLiveVoice } from '../../src/renderer/src/features/voice/live-voice';
import { useVoiceDebug } from '../../src/renderer/src/features/voice/voice-debug';
import { initI18n } from '../../src/renderer/src/i18n';
import { ApiProvider } from '../../src/renderer/src/lib/api';
import type { TutorClient, TutorEvent } from '../../src/renderer/src/tutor/types';
import type { AppConfig } from '../../src/shared/bridge';
import type { VoiceConfig } from '../../src/shared/voice-bridge';
import { device } from './live/audio-fakes';

const { useVoiceSession } = vi.hoisted(() => ({ useVoiceSession: vi.fn() }));
vi.mock('../../src/renderer/src/features/voice/use-voice-session', () => ({ useVoiceSession }));

const SESSION: Session = {
  id: '7c2a5f1e-0b3d-4e8a-9f6c-1d2e3f4a5b6c',
  title: null,
  title_source: null,
  subject: null,
  type: 'homework',
  language: 'en',
  source: 'talk',
  created_at: '2026-10-17T12:00:00.000000Z',
  last_activity_at: '2026-10-17T12:00:00.000000Z',
};

const APP: AppConfig = {
  serverUrl: 'http://localhost:8851',
  uiLanguage: 'en',
  tutorMode: 'live',
  fakeScript: 'dfa-opening',
  fakeSpeed: 1,
  tokenReset: false,
};
const DEV: VoiceConfig = {
  devTools: true,
  fakeMic: true,
  canOpenMicSettings: true,
};

/** A live tutor the test drives, and a mic whose level the test sets. */
function liveTutor() {
  const listeners = new Set<(event: TutorEvent) => void>();
  const client = {
    connect: vi.fn(async (_id: string) => {}),
    disconnect: vi.fn(async () => {}),
    on: vi.fn((listener: (event: TutorEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    sendText: vi.fn(),
    voice: {
      setTalking: vi.fn(),
      setSensitivity: vi.fn(),
      reportClientMetrics: vi.fn(),
      reconnect: vi.fn(async () => {}),
      connectionCount: 1,
    },
  } satisfies TutorClient;
  const mic = { level: vi.fn(() => 0) };
  const emit = (event: TutorEvent) =>
    act(() => {
      for (const listener of listeners) listener(event);
    });
  return { client, mic, emit };
}

function fakeApi(session: Session = SESSION) {
  // The library lists sessions; the session screen gets one.
  const GET = vi.fn(async (path: string) => ({
    data: path === '/v1/sessions' ? { items: [session] } : session,
    response: new Response(null),
  }));
  const PATCH = vi.fn(async (_path: string, options: { body: Partial<Session> }) => ({
    data: { ...session, ...options.body },
    response: new Response(null),
  }));
  return { GET, PATCH, api: { GET, PATCH } as unknown as ApiClient };
}

let openMicSettings: ReturnType<typeof vi.fn>;
let frames: FrameRequestCallback[];

beforeEach(() => {
  localStorage.clear();
  useStageStore.getState().reset();
  useAudioPrefs.getState().reset();
  useVoiceDebug.getState().reset();
  useLiveVoice.getState().clear();
  useRoute.getState().openSession(SESSION.id);
  openMicSettings = vi.fn(async () => {});
  vi.stubGlobal('tassel', { platform: 'darwin', voice: { openMicSettings } });
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => frames.push(fn));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  // AudioSettings lists devices; nothing here opens one.
  const events = new EventTarget();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: vi.fn(async () => [
        { ...device('mac-mic'), label: 'MacBook Microphone' },
        { ...device('mac-speaker', 'audiooutput'), label: 'MacBook Speakers' },
      ]),
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    },
  });
  // Radix's browser APIs are absent in jsdom.
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function renderLive(
  opts: { config?: VoiceConfig; session?: Session; tutor?: ReturnType<typeof liveTutor> } = {},
) {
  const tutor = opts.tutor ?? liveTutor();
  useVoiceSession.mockReturnValue({
    resources: { mic: tutor.mic, audio: {}, meter: {} },
    client: tutor.client,
  });
  const api = fakeApi(opts.session);
  render(
    <I18nextProvider i18n={await initI18n('en')}>
      <ApiProvider client={api.api}>
        <SessionScreen sessionId={SESSION.id} app={APP} voiceConfig={opts.config ?? DEV} />
      </ApiProvider>
    </I18nextProvider>,
  );
  await screen.findByRole('heading', { level: 1 });
  await waitFor(() => expect(tutor.client.connect).toHaveBeenCalledWith(SESSION.id));
  return { ...tutor, ...api };
}

const dock = () => screen.getByRole('group', { name: 'Session controls' });
const runFrame = (now: number) =>
  act(() => {
    for (const frame of frames.splice(0)) frame(now);
  });

describe('the session screen with the live voice tutor', () => {
  it('the dock shows the live mic level', async () => {
    const { mic } = await renderLive();
    const meter = within(dock()).getByTestId('mic-level');
    expect(meter).toHaveAttribute('data-level', '0');
    mic.level.mockReturnValue(0.2);
    runFrame(100);
    expect(Number(meter.getAttribute('data-level'))).toBeGreaterThan(0);
    // At most 30 a second: a frame 10 ms later doesn't sample again.
    mic.level.mockReturnValue(0);
    runFrame(110);
    expect(Number(meter.getAttribute('data-level'))).toBeGreaterThan(0);
    runFrame(140);
    expect(meter).toHaveAttribute('data-level', '0');
  });

  it('audio settings open from the dock', async () => {
    await renderLive();
    await userEvent.click(within(dock()).getByRole('button', { name: 'Audio settings' }));
    expect(await screen.findByRole('dialog', { name: 'Audio' })).toBeInTheDocument();
  });

  it('the mic button mutes, and under push-to-talk shows Hold Space to talk', async () => {
    await renderLive();
    const mic = within(dock()).getByRole('button', { name: 'Microphone' });
    expect(mic).toHaveAttribute('aria-pressed', 'true');
    act(() => useAudioPrefs.getState().set({ pushToTalk: true }));
    const hold = within(dock()).getByRole('button', { name: 'Hold Space to talk' });
    expect(hold).toHaveAttribute('aria-pressed', 'false');
    act(() => useLiveVoice.getState().setHeld(true));
    expect(hold).toHaveAttribute('aria-pressed', 'true');
    act(() => useLiveVoice.getState().setHeld(false));
    // Muted, it is P1's microphone toggle again, off.
    fireEvent.keyDown(window, { key: 'm', code: 'KeyM' });
    const off = within(dock()).getByRole('button', { name: 'Microphone' });
    expect(off).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(off);
    expect(useStageStore.getState().micOn).toBe(true);
  });

  it('the language menu switches and reconnects', async () => {
    const { client, PATCH } = await renderLive();
    act(() => useStageStore.getState().setConnection('connected'));
    await userEvent.click(screen.getByRole('button', { name: 'Session language: English' }));
    const menu = await screen.findByRole('dialog', { name: 'Session language' });
    await userEvent.click(within(menu).getByRole('button', { name: 'Español' }));
    await waitFor(() => expect(client.voice.reconnect).toHaveBeenCalledTimes(1));
    expect(PATCH).toHaveBeenCalledWith('/v1/sessions/{session_id}', {
      params: { path: { session_id: SESSION.id } },
      body: { language: 'es' },
    });
    expect(PATCH.mock.invocationCallOrder[0]).toBeLessThan(
      client.voice.reconnect.mock.invocationCallOrder[0] as number,
    );
    expect(screen.getByRole('button', { name: 'Session language: Español' })).toBeInTheDocument();
    // The reconnect starts over: Switching shows until Ada is back.
    act(() => useStageStore.getState().setConnection('connecting'));
    expect(screen.getByRole('status')).toHaveTextContent('Switching to Español…');
    act(() => useStageStore.getState().setConnection('connected'));
    expect(screen.queryByText('Switching to Español…')).not.toBeInTheDocument();
  });

  it('a failed connection offers Retry', async () => {
    const { client } = await renderLive();
    const tile = screen.getByTestId('tutor-tile');
    expect(tile).toHaveTextContent('Connecting to Ada');
    act(() => useStageStore.getState().setConnection('reconnecting'));
    expect(tile).toHaveTextContent('Reconnecting…');
    act(() => useStageStore.getState().setConnection('failed', 'unreachable'));
    expect(tile).toHaveTextContent("Couldn't reach Ada.");
    await userEvent.click(within(tile).getByRole('button', { name: 'Retry' }));
    expect(client.voice.reconnect).toHaveBeenCalledTimes(1);
    act(() => {
      useStageStore.getState().setConnection('connected');
      useStageStore.getState().setTutorState('listening');
    });
    expect(tile).toHaveTextContent('Listening');
    expect(within(tile).queryByRole('button')).not.toBeInTheDocument();
  });

  it('a denied mic shows the notice with Open settings', async () => {
    await renderLive();
    act(() => useStageStore.getState().setMic('denied'));
    const notice = screen.getByText("Tassel can't use your microphone. You can still type to Ada.")
      .parentElement as HTMLElement;
    await userEvent.click(within(notice).getByRole('button', { name: 'Open settings' }));
    expect(openMicSettings).toHaveBeenCalledTimes(1);
    await userEvent.click(within(notice).getByRole('button', { name: 'Dismiss' }));
    expect(
      screen.queryByText("Tassel can't use your microphone. You can still type to Ada."),
    ).not.toBeInTheDocument();
  });

  it('without a settings link the notice has no button', async () => {
    await renderLive({ config: { ...DEV, canOpenMicSettings: false } });
    act(() => useStageStore.getState().setMic('unavailable'));
    const notice = screen.getByText(
      "Your microphone isn't available. It may be in use by another app.",
    ).parentElement as HTMLElement;
    expect(within(notice).queryByRole('button', { name: 'Open settings' })).toBeNull();
    expect(within(notice).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('Ctrl+Shift+L toggles the HUD only in dev', async () => {
    await renderLive();
    expect(screen.queryByRole('region', { name: 'Latency' })).toBeNull();
    fireEvent.keyDown(window, { key: 'L', code: 'KeyL', ctrlKey: true, shiftKey: true });
    expect(screen.getByRole('region', { name: 'Latency' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'L', code: 'KeyL', metaKey: true, shiftKey: true });
    expect(screen.queryByRole('region', { name: 'Latency' })).toBeNull();
  });

  it('the HUD stays off in a packaged app', async () => {
    await renderLive({ config: { ...DEV, devTools: false } });
    fireEvent.keyDown(window, { key: 'L', code: 'KeyL', ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole('region', { name: 'Latency' })).toBeNull();
  });

  it('an AI title types on, and appears at once with reduced motion', async () => {
    const reduced = { matches: false };
    vi.stubGlobal('matchMedia', () => reduced);
    const { emit } = await renderLive();
    vi.useFakeTimers();
    emit({ type: 'title', title: 'Strings that start with 010', subject: 'Automata · DFA' });
    const heading = screen.getByRole('heading', {
      level: 1,
      name: 'Strings that start with 010',
    });
    const typed = () => within(heading).getByTestId('title-typed').textContent;
    expect(typed()).toBe('');
    act(() => vi.advanceTimersByTime(30 * 7));
    expect(typed()).toBe('Strings');
    act(() => vi.advanceTimersByTime(30 * 30));
    expect(typed()).toBe('Strings that start with 010');

    reduced.matches = true;
    emit({ type: 'title', title: 'DFAs for 010 prefixes', subject: null });
    expect(typed()).toBe('DFAs for 010 prefixes');
  });
});

describe('ending the session (R37)', () => {
  it('End session, confirmed, stops the live voice client', async () => {
    const tutor = liveTutor();
    useVoiceSession.mockReturnValue({
      resources: { mic: tutor.mic, audio: {}, meter: {} },
      client: tutor.client,
    });
    render(
      <I18nextProvider i18n={await initI18n('en')}>
        <App api={fakeApi().api} config={APP} voiceConfig={DEV} />
      </I18nextProvider>,
    );
    await waitFor(() => expect(tutor.client.connect).toHaveBeenCalledWith(SESSION.id));
    await userEvent.click(screen.getByRole('button', { name: 'End session' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'End this session?' })).getByRole('button', {
        name: 'End session',
      }),
    );
    expect(tutor.client.disconnect).toHaveBeenCalled();
    expect(useRoute.getState().route.name).toBe('library');
    // The controls no longer hold the finished session's client.
    expect(useLiveVoice.getState().client).toBeNull();
  });
});
