// @vitest-environment jsdom
import type { ApiClient, Session } from '@tassel/shared/api';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoute } from '../../src/renderer/src/app/route-store';
import { SessionScreen } from '../../src/renderer/src/features/session/SessionScreen';
import { useStageStore } from '../../src/renderer/src/features/session/stage-store';
import { initI18n } from '../../src/renderer/src/i18n';
import { ApiProvider } from '../../src/renderer/src/lib/api';
import type { TutorClient, TutorEvent } from '../../src/renderer/src/tutor/types';
import { useTutorSession } from '../../src/renderer/src/tutor/use-tutor-session';

const SESSION: Session = {
  id: '7c2a5f1e-0b3d-4e8a-9f6c-1d2e3f4a5b6c',
  title: null,
  title_source: null,
  subject: null,
  type: 'homework',
  language: 'en',
  source: 'paper',
  created_at: '2026-10-17T12:00:00.000000Z',
  last_activity_at: '2026-10-17T12:00:00.000000Z',
};

/** A tutor the test drives: `emit` delivers an event to whoever listens. */
function scriptedTutor() {
  const listeners = new Set<(event: TutorEvent) => void>();
  const client = {
    connect: vi.fn(async (_sessionId: string) => {}),
    disconnect: vi.fn(async () => {}),
    on: vi.fn((listener: (event: TutorEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    sendText: vi.fn(),
  } satisfies TutorClient;
  const emit = (event: TutorEvent) =>
    act(() => {
      for (const listener of listeners) listener(event);
    });
  return { client, emit, listening: () => listeners.size };
}

/** GET answers getSession; PATCH answers patchSession with the changes applied. */
function fakeApi() {
  const GET = vi.fn(async () => ({ data: SESSION, response: new Response(null) }));
  const PATCH = vi.fn(async (_path: string, options: { body: Partial<Session> }) => ({
    data: { ...SESSION, ...options.body, title_source: 'student' },
    response: new Response(null),
  }));
  return { GET, PATCH, api: { GET, PATCH } as unknown as ApiClient };
}

const stage = () => useStageStore.getState();

beforeEach(() => {
  vi.stubGlobal('tassel', { platform: 'darwin' });
  stage().reset();
  useRoute.getState().openSession(SESSION.id);
});
afterEach(() => vi.unstubAllGlobals());

describe('useTutorSession', () => {
  function renderTutor(client: TutorClient) {
    const { api } = fakeApi();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ApiProvider client={api}>{children}</ApiProvider>
    );
    return renderHook(() => useTutorSession(SESSION.id, client, true), { wrapper });
  }

  it('connects to the session on mount and disconnects on unmount', () => {
    const { client, listening } = scriptedTutor();
    const { unmount } = renderTutor(client);
    expect(client.connect).toHaveBeenCalledWith(SESSION.id);
    expect(listening()).toBe(1);
    unmount();
    expect(client.disconnect).toHaveBeenCalled();
    expect(listening()).toBe(0);
  });

  it('connects only once the session is ready', () => {
    const { client, listening } = scriptedTutor();
    const { api } = fakeApi();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ApiProvider client={api}>{children}</ApiProvider>
    );
    const { rerender } = renderHook(({ ready }) => useTutorSession(SESSION.id, client, ready), {
      wrapper,
      initialProps: { ready: false },
    });
    expect(client.connect).not.toHaveBeenCalled();
    expect(listening()).toBe(0);
    rerender({ ready: true });
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(listening()).toBe(1);
  });

  it('routes state events to the stage', () => {
    const { client, emit } = scriptedTutor();
    renderTutor(client);
    emit({ type: 'state', state: 'speaking' });
    expect(stage().tutorState).toBe('speaking');
  });

  it('stage event calls requestMode', () => {
    const { client, emit } = scriptedTutor();
    renderTutor(client);
    emit({ type: 'stage', mode: 'split' });
    expect(stage()).toMatchObject({ mode: 'split', requested: 'split' });
    // Pinned is respected: the request waits, remembered.
    act(() => stage().pin('paper'));
    emit({ type: 'stage', mode: 'board' });
    expect(stage()).toMatchObject({ mode: 'paper', pinned: 'paper', requested: 'board' });
  });

  it('captions flow into the store', () => {
    const { client, emit } = scriptedTutor();
    renderTutor(client);
    emit({ type: 'caption', speaker: 'student', text: 'Hola Ada.', lang: 'es', final: true });
    emit({ type: 'caption', speaker: 'tutor', text: 'Great, draw it.', lang: 'en', final: true });
    expect(stage().caption).toEqual({
      previous: { speaker: 'student', text: 'Hola Ada.', lang: 'es' },
      current: { speaker: 'tutor', text: 'Great, draw it.', lang: 'en' },
    });
    // A line still being heard isn't shown until it's final.
    emit({ type: 'caption', speaker: 'student', text: 'I think', lang: 'en', final: false });
    expect(stage().caption.current?.text).toBe('Great, draw it.');
  });
});

describe('the session screen with its tutor', () => {
  /** Renders the screen; GET answers `answer` (the untitled SESSION by default) once. */
  async function renderScreen(
    client: TutorClient,
    answer?: Promise<{ data: Session; response: Response }>,
  ) {
    const i18n = await initI18n('en');
    const api = fakeApi();
    if (answer) api.GET.mockReturnValueOnce(answer);
    const view = render(
      <I18nextProvider i18n={i18n}>
        <ApiProvider client={api.api}>
          <SessionScreen sessionId={SESSION.id} createTutor={() => client} />
        </ApiProvider>
      </I18nextProvider>,
    );
    return { ...api, ...view };
  }

  it('title event shows the new title in the title strip, once', async () => {
    const { client, emit } = scriptedTutor();
    const { PATCH } = await renderScreen(client);
    await screen.findByRole('heading', { level: 1, name: 'Untitled Session' });
    emit({ type: 'title', title: 'Strings that start with 010', subject: 'Automata · DFA' });

    const strip = screen.getByRole('banner');
    expect(
      within(strip).getByRole('heading', { level: 1, name: 'Strings that start with 010' }),
    ).toBeInTheDocument();
    expect(within(strip).getByText('Automata · DFA')).toBeInTheDocument();
    // R16: the title persists, so the library shows it afterwards.
    await waitFor(() => expect(PATCH).toHaveBeenCalledTimes(1));
    expect(PATCH).toHaveBeenCalledWith('/v1/sessions/{session_id}', {
      params: { path: { session_id: SESSION.id } },
      body: { title: 'Strings that start with 010', subject: 'Automata · DFA' },
    });
    // Her title replaced the placeholder; a later one doesn't replace hers.
    emit({ type: 'title', title: 'Something else', subject: null });
    expect(within(strip).getByRole('heading', { level: 1 })).toHaveTextContent(
      'Strings that start with 010',
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(PATCH).toHaveBeenCalledTimes(1);
  });

  it("leaves a titled session's own title, and saves nothing (spec §5.1)", async () => {
    const { client, emit } = scriptedTutor();
    const titled: Session = {
      ...SESSION,
      title: 'Sums of odd numbers',
      title_source: 'student',
      subject: 'Induction',
    };
    const { PATCH } = await renderScreen(
      client,
      Promise.resolve({ data: titled, response: new Response(null) }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Sums of odd numbers' });
    emit({ type: 'title', title: 'Strings that start with 010', subject: 'Automata · DFA' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sums of odd numbers');
    expect(within(screen.getByRole('banner')).getByText('Induction')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(PATCH).not.toHaveBeenCalled();
  });

  it('starts the tutor only once the session has loaded', async () => {
    const { client, listening } = scriptedTutor();
    let answer!: (value: { data: Session; response: Response }) => void;
    await renderScreen(
      client,
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    expect(client.connect).not.toHaveBeenCalled();
    expect(listening()).toBe(0);
    await act(async () => answer({ data: SESSION, response: new Response(null) }));
    expect(client.connect).toHaveBeenCalledWith(SESSION.id);
    expect(listening()).toBe(1);
  });

  it("doesn't start the tutor for a session that can't be loaded", async () => {
    const { client, listening } = scriptedTutor();
    await renderScreen(client, Promise.reject(new Error('Session not found')));
    expect(await screen.findByText("Couldn't load this session")).toBeInTheDocument();
    expect(client.connect).not.toHaveBeenCalled();
    expect(listening()).toBe(0);
  });

  it('keeps the title on screen when saving it fails, without an unhandled rejection', async () => {
    const { client, emit } = scriptedTutor();
    const { PATCH } = await renderScreen(client);
    await screen.findByRole('heading', { level: 1, name: 'Untitled Session' });
    PATCH.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    emit({ type: 'title', title: 'Strings that start with 010', subject: null });
    await waitFor(() => expect(PATCH).toHaveBeenCalled());
    expect(
      screen.getByRole('heading', { level: 1, name: 'Strings that start with 010' }),
    ).toBeInTheDocument();
  });

  it('stops listening when she ends the session', async () => {
    const { client, listening } = scriptedTutor();
    const { unmount } = await renderScreen(client);
    await waitFor(() => expect(client.connect).toHaveBeenCalledWith(SESSION.id));
    unmount();
    expect(client.disconnect).toHaveBeenCalled();
    expect(listening()).toBe(0);
  });

  it('keeps the screen up without a tutor when one cannot be made', async () => {
    const i18n = await initI18n('en');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <I18nextProvider i18n={i18n}>
        <ApiProvider client={fakeApi().api}>
          <SessionScreen
            sessionId={SESSION.id}
            createTutor={() => {
              throw new Error('live tutor arrives in P2');
            }}
          />
        </ApiProvider>
      </I18nextProvider>,
    );
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'End session' })).toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('without a tutor'),
      expect.any(Error),
    );
    warn.mockRestore();
  });
});
