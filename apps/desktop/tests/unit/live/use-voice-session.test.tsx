// @vitest-environment jsdom
import { createApiClient } from '@tassel/shared/api';
import { act, cleanup, fireEvent, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, useMemo } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStageStore } from '../../../src/renderer/src/features/session/stage-store';
import { useAudioPrefs } from '../../../src/renderer/src/features/voice/audio-prefs';
import { useVoiceSession } from '../../../src/renderer/src/features/voice/use-voice-session';
import { useVoiceDebug } from '../../../src/renderer/src/features/voice/voice-debug';
import { ApiProvider } from '../../../src/renderer/src/lib/api';
import { createTutorClient } from '../../../src/renderer/src/tutor/create-client';
import { FakeTutorClient } from '../../../src/renderer/src/tutor/fake-client';
import { LiveTutorClient } from '../../../src/renderer/src/tutor/live/live-client';
import { useTutorSession } from '../../../src/renderer/src/tutor/use-tutor-session';
import type { AppConfig } from '../../../src/shared/bridge';
import { FakeContext, FakeStream, micHarness } from './audio-fakes';

// Only the transport peer is replaced. The factory, HTTP auth, resource ownership,
// event routing and actual Mic gain graph remain production code.
const peers = vi.hoisted(() => ({
  all: [] as Array<{
    emit(e: string, data?: unknown): void;
    sendClientMessage: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }>,
}));
vi.mock('@pipecat-ai/client-js', async (original) => {
  const sdk = await original<typeof import('@pipecat-ai/client-js')>();
  return {
    ...sdk,
    PipecatClient: class {
      listeners = new Map<string, (data?: unknown) => void>();
      sendClientMessage = vi.fn();
      disconnect = vi.fn(async () => {});
      constructor() {
        peers.all.push(this);
      }
      on(e: string, fn: (data?: unknown) => void) {
        this.listeners.set(e, fn);
      }
      emit(e: string, data?: unknown) {
        this.listeners.get(e)?.(data);
      }
      async connect() {
        this.emit(sdk.RTVIEvent.BotReady);
      }
      async sendText() {
        return 'id';
      }
    },
  };
});
const app: AppConfig = {
  serverUrl: 'http://localhost:8821',
  uiLanguage: 'en',
  tutorMode: 'live',
  fakeScript: 'dfa-opening',
  fakeSpeed: 1,
  tokenReset: false,
};
const config = { devTools: true, fakeMic: true, devConsole: false, canOpenMicSettings: true };
let h: ReturnType<typeof micHarness>;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
let refresh: ReturnType<typeof vi.fn<() => Promise<string>>>;
let api: ReturnType<typeof createApiClient>;
beforeEach(() => {
  useStageStore.getState().reset();
  useAudioPrefs.getState().reset();
  useVoiceDebug.getState().reset();
  peers.all = [];
  h = micHarness();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: h.media });
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('MediaStream', FakeStream);
  vi.stubGlobal('tassel', { getToken: async () => 'test-token' });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', {
    configurable: true,
    value: vi.fn(async () => {}),
  });
  fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        ice_servers: [{ urls: ['stun:example.test'], username: null, credential: null }],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    ),
  );
  // Responses are single-use; each request gets its own clone.
  fetcher.mockImplementation(
    async () =>
      new Response(JSON.stringify({ ice_servers: [] }), {
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  refresh = vi.fn(async () => 'refreshed');
  api = createApiClient({
    baseUrl: app.serverUrl,
    getToken: async () => 'test-token',
    refreshToken: refresh,
    fetch: fetcher,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mount(mode = app.tutorMode, strict = false) {
  return renderHook(
    () => {
      const launch = useMemo(() => ({ ...app, tutorMode: mode }), []);
      const voice = useVoiceSession({ sessionId: 'session', lang: 'ko', app: launch, config, api });
      useTutorSession('session', voice.client, true);
      return voice;
    },
    {
      wrapper: ({ children }) =>
        strict ? (
          <StrictMode>
            <ApiProvider client={api}>{children}</ApiProvider>
          </StrictMode>
        ) : (
          <ApiProvider client={api}>{children}</ApiProvider>
        ),
    },
  );
}
it('uses the live client by default and connects with authenticated ICE; only explicit fake runs a script', async () => {
  const view = mount();
  await waitFor(() => expect(useStageStore.getState().connection).toBe('connected'));
  expect(view.result.current.client).toBeInstanceOf(LiveTutorClient);
  const request = fetcher.mock.calls[0]?.[0];
  if (!(request instanceof Request)) throw new Error('Missing ICE request');
  expect(request.url).toBe(`${app.serverUrl}/v1/voice/ice-servers`);
  expect(request.headers.get('Authorization')).toBe('Bearer test-token');
  expect(useStageStore.getState().caption).toEqual({});
  view.unmount();
  const calls = fetcher.mock.calls.length;
  const fake = mount('fake');
  await waitFor(() => expect(fake.result.current.client).toBeInstanceOf(FakeTutorClient));
  expect(fetcher).toHaveBeenCalledTimes(calls);
  expect(() => createTutorClient(app)).toThrow(/deps/i);
});
it.each([503, 404, 'offline'] as const)(
  'reports %s honestly without a scripted caption or mic capture',
  async (failure) => {
    fetcher.mockImplementation(async () => {
      if (failure === 'offline') throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ detail: 'Voice is not configured' }), {
        status: failure,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const view = mount();
    await waitFor(() =>
      expect(useStageStore.getState().voiceError).toBe(
        failure === 'offline' ? 'unreachable' : 'not-configured',
      ),
    );
    expect(view.result.current.client).toBeInstanceOf(LiveTutorClient);
    expect(h.media.getUserMedia).not.toHaveBeenCalled();
    expect(useStageStore.getState().caption).toEqual({});
    expect(peers.all).toHaveLength(0);
  },
);
it('refreshes a stale token once through the shared API client', async () => {
  fetcher.mockResolvedValueOnce(new Response(null, { status: 401 }));
  mount();
  await waitFor(() => expect(useStageStore.getState().connection).toBe('connected'));
  expect(refresh).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('M sends silence, even when Space is held, and PTT changes reconnect', async () => {
  const view = mount();
  await waitFor(() => expect(h.media.getUserMedia).toHaveBeenCalledOnce());
  const resources = view.result.current.resources;
  if (!resources) throw new Error('Missing resources');
  const mic = resources.mic;
  expect(mic.sentLevel()).toBeCloseTo(0.5);
  fireEvent.keyDown(window, { code: 'Space' });
  expect(peers.all[0]?.sendClientMessage).not.toHaveBeenCalledWith(
    'tassel',
    expect.objectContaining({ kind: 'ptt' }),
  );
  act(() => useAudioPrefs.getState().set({ pushToTalk: true }));
  await waitFor(() => expect(peers.all).toHaveLength(2));
  expect(mic.sentLevel()).toBe(0);
  fireEvent.keyDown(window, { code: 'Space' });
  expect(mic.sentLevel()).toBeCloseTo(0.5);
  act(() => useStageStore.getState().toggleMic());
  expect(mic.isEnabled).toBe(false);
  expect(mic.sentLevel()).toBe(0);
  fireEvent.keyUp(window, { code: 'Space' });
  fireEvent.keyDown(window, { code: 'Space' });
  expect(mic.sentLevel()).toBe(0);
  expect(peers.all[1]?.sendClientMessage).toHaveBeenLastCalledWith('tassel', {
    kind: 'ptt',
    enabled: true,
    held: false,
  });
  act(() => useAudioPrefs.getState().set({ pushToTalk: false }));
  await waitFor(() => expect(peers.all).toHaveLength(3));
  act(() => useStageStore.getState().toggleMic());
  expect(mic.sentLevel()).toBeCloseTo(0.5);
});
it('applies input/processing, sinks and sensitivity, records openedAt, and disposes on unmount', async () => {
  useAudioPrefs.getState().set({ inputId: 'mic-2', outputId: 'speaker', sensitivity: 'high' });
  const view = mount();
  await waitFor(() => expect(useStageStore.getState().mic).toBe('live'));
  expect(h.media.getUserMedia).toHaveBeenCalledWith({
    audio: {
      deviceId: { exact: 'mic-2' },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  });
  expect(HTMLMediaElement.prototype.setSinkId).toHaveBeenCalledWith('speaker');
  act(() => useAudioPrefs.getState().set({ sensitivity: 'low' }));
  expect(peers.all[0]?.sendClientMessage).toHaveBeenCalledWith('tassel', {
    kind: 'sensitivity',
    level: 'low',
  });
  expect(useVoiceDebug.getState().micOpenedAt).toBeTypeOf('number');
  const resources = view.result.current.resources;
  if (!resources) throw new Error('Missing resources');
  const { mic, audio } = resources;
  view.unmount();
  await waitFor(() => expect(peers.all[0]?.disconnect).toHaveBeenCalled());
  expect(mic.status).toBe('off');
  expect(audio.element.isConnected).toBe(false);
  expect(h.captures.every((s) => s.getTracks().every((t) => t.readyState === 'ended'))).toBe(true);
});
it('StrictMode leaves only one live resource owner and no orphan audio elements', async () => {
  const view = mount('live', true);
  await waitFor(() => expect(useStageStore.getState().mic).toBe('live'));
  expect(document.querySelectorAll('[data-testid="tutor-audio"]')).toHaveLength(1);
  view.unmount();
  expect(document.querySelectorAll('[data-testid="tutor-audio"]')).toHaveLength(0);
});

it('samples metrics with current sensitivity, forwards duck timestamps, and cancels sampling', async () => {
  vi.useFakeTimers();
  const view = mount();
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
  const resources = view.result.current.resources;
  if (!resources) throw new Error('Missing resources');
  const sample = vi
    .spyOn(resources.meter, 'sample')
    .mockReturnValueOnce({ ttfa_ms: 900, barge_in_ms: null, yield_ms: null })
    .mockReturnValue(null);
  const duck = vi.spyOn(resources.meter, 'markDuck');
  act(() => useAudioPrefs.getState().set({ sensitivity: 'high' }));
  act(() => vi.advanceTimersByTime(20));
  const metrics = { ttfa_ms: 900, barge_in_ms: null, yield_ms: null, sensitivity: 'high' };
  expect(useVoiceDebug.getState().client.at(-1)).toMatchObject(metrics);
  expect(peers.all[0]?.sendClientMessage).toHaveBeenCalledWith('tassel', {
    kind: 'client-metrics',
    ...metrics,
  });
  resources.audio.duck(true);
  expect(duck).toHaveBeenCalledExactlyOnceWith(expect.any(Number));
  resources.audio.duck(false);
  expect(duck).toHaveBeenCalledOnce();
  view.unmount();
  const calls = sample.mock.calls.length;
  act(() => vi.advanceTimersByTime(100));
  expect(sample).toHaveBeenCalledTimes(calls);
});

it('sends current stage, frozen snapshot and meaningful page revision to the director', async () => {
  const { useMarksStore } = await import('../../../src/renderer/src/board/marks/marks-store');
  const { usePaperStore } = await import('../../../src/renderer/src/paper/paper-store');
  const view = mount();
  await waitFor(() => expect(useStageStore.getState().connection).toBe('connected'));
  act(() => {
    useStageStore.getState().pin('board');
    useMarksStore.setState({ status: 'frozen' });
    usePaperStore.getState().setUploads({ sent: 2, pending: 0, failed: 0, lastError: null });
  });
  expect(peers.all[0].sendClientMessage).toHaveBeenLastCalledWith('tassel', {
    kind: 'stage-state',
    view: 'board',
    frozen: true,
    page_revision: 2,
  });
  view.unmount();
  useMarksStore.getState().reset();
  usePaperStore.getState().reset();
});
