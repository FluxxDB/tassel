// @vitest-environment jsdom
import type { ApiClient, Session } from '@tassel/shared/api';
import type { ChatMessage } from '@tassel/shared/voice';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoute } from '../../../src/renderer/src/app/route-store';
import { useChatPrefs } from '../../../src/renderer/src/features/chat/chat-prefs';
import { useChatStore } from '../../../src/renderer/src/features/chat/chat-store';
import { registerImageStage } from '../../../src/renderer/src/features/chat/image-stage';
import { SessionScreen } from '../../../src/renderer/src/features/session/SessionScreen';
import { useStageStore } from '../../../src/renderer/src/features/session/stage-store';
import { initI18n } from '../../../src/renderer/src/i18n';
import { ApiProvider } from '../../../src/renderer/src/lib/api';
import type { TutorClient, TutorEvent } from '../../../src/renderer/src/tutor/types';
import type { AppConfig } from '../../../src/shared/bridge';

const SESSION: Session = {
  id: '3a8f0d5e-62a4-4c0b-a3bb-2b5c1f7e9d10',
  title: 'Strings that start with 010',
  title_source: 'student',
  subject: null,
  type: 'homework',
  language: 'en',
  source: 'talk',
  created_at: '2026-10-17T12:00:00.000000Z',
  last_activity_at: '2026-10-17T12:00:00.000000Z',
};

const SAVED = {
  messages: [
    {
      id: 'm-1',
      client_id: null,
      role: 'student',
      source: 'voice',
      text: 'Can you draw it?',
      interrupted: false,
      attachments: [],
      action: null,
      created_at: '2026-10-17T12:00:01Z',
    },
    {
      id: 'm-2',
      client_id: null,
      role: 'tutor',
      source: 'voice',
      text: 'Here it is.',
      interrupted: false,
      attachments: [],
      action: null,
      created_at: '2026-10-17T12:00:02Z',
    },
  ],
};

function fakeApi(history: unknown | null) {
  const GET = vi.fn(async (path: string) => {
    if (path === '/v1/sessions/{session_id}/messages')
      return history
        ? { data: history, response: new Response(null) }
        : { error: {}, response: new Response(null, { status: 501 }) };
    return { data: SESSION, response: new Response(null) };
  });
  return { GET, api: { GET } as unknown as ApiClient };
}

/** A tutor the test drives: its listener, and what was sent to it. */
function fakeTutor() {
  let listener: (event: TutorEvent) => void = () => {};
  const tutor: TutorClient = {
    connect: async () => {},
    disconnect: async () => {},
    on: (next) => {
      listener = next;
      return () => {};
    },
    sendText: () => {},
    sendMessage: () => true,
  };
  return { tutor, emit: (event: TutorEvent) => act(() => listener(event)) };
}

async function renderSession({
  history = null as unknown | null,
  app,
}: {
  history?: unknown | null;
  app?: AppConfig;
} = {}) {
  const i18n = await initI18n('en');
  const { api, GET } = fakeApi(history);
  const { tutor, emit } = fakeTutor();
  const user = userEvent.setup();
  useRoute.getState().openSession(SESSION.id);
  const { unmount } = render(
    <I18nextProvider i18n={i18n}>
      <ApiProvider client={api}>
        <SessionScreen sessionId={SESSION.id} createTutor={() => tutor} app={app} />
      </ApiProvider>
    </I18nextProvider>,
  );
  await screen.findByRole('heading', { level: 1, name: SESSION.title ?? '' });
  return { user, GET, emit, unmount };
}

const line = (overrides: Partial<ChatMessage> & Pick<ChatMessage, 'id'>): TutorEvent => ({
  type: 'message',
  message: {
    client_id: null,
    role: 'tutor',
    source: 'voice',
    text: '',
    final: true,
    interrupted: false,
    attachments: [],
    action: null,
    ...overrides,
  },
});

const toggle = () => screen.getByRole('button', { name: 'Chat' });
const sidebar = () => screen.getByTestId('chat-sidebar');

beforeEach(() => {
  vi.stubGlobal('tassel', { platform: 'darwin' });
  localStorage.clear();
  useChatPrefs.setState({ open: null, defaultOpen: true, voiceReplies: true });
  useStageStore.getState().reset();
});
afterEach(() => vi.unstubAllGlobals());

describe('the chat sidebar', () => {
  it('opens with a session, beside the stage, with its toggle in the title strip', async () => {
    await renderSession();
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(toggle()).toHaveAttribute('aria-controls', sidebar().id);
    expect(toggle()).toHaveAttribute('aria-keyshortcuts', 'T');
    expect(toggle()).toHaveAttribute('title', 'Chat (T)');
    expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Chat' })).toBe(toggle());
    expect(sidebar()).not.toHaveAttribute('inert');
    expect(screen.getByRole('log', { name: 'Conversation' })).toHaveAttribute(
      'aria-live',
      'polite',
    );
  });

  it('T and the toggle hide and show it, and the choice is remembered', async () => {
    const { user } = await renderSession();
    await user.keyboard('t');
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(sidebar()).toHaveAttribute('inert');
    expect(JSON.parse(localStorage.getItem('tassel.chat-prefs') ?? '{}').state).toMatchObject({
      open: false,
    });
    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    // Opened, the field takes focus, so she can type at once.
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Message to Ada' })).toHaveFocus(),
    );
  });

  it('Hide hands focus back to the toggle', async () => {
    const { user } = await renderSession();
    await user.click(screen.getByRole('button', { name: 'Hide chat' }));
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(toggle()).toHaveFocus());
  });

  it('starts hidden when the launch says so (TASSEL_CHAT_SIDEBAR=closed)', async () => {
    await renderSession({
      app: {
        serverUrl: 'http://127.0.0.1:8799',
        uiLanguage: 'en',
        tutorMode: 'fake',
        fakeScript: 'dfa-opening',
        fakeSpeed: 1,
        tokenReset: false,
        chatSidebar: 'closed',
      },
    });
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(sidebar()).toHaveAttribute('inert');
  });

  it("loads the session's saved conversation, and a 501 as an empty chat", async () => {
    await renderSession({ history: SAVED });
    const log = screen.getByRole('log', { name: 'Conversation' });
    expect(await within(log).findByText('Here it is.')).toBeInTheDocument();
    expect(within(log).getByText('Can you draw it?').closest('p')).toHaveClass('italic');
  });

  it('shows an empty chat when the history is not there', async () => {
    const { GET } = await renderSession();
    await waitFor(() =>
      expect(GET).toHaveBeenCalledWith('/v1/sessions/{session_id}/messages', expect.anything()),
    );
    expect(screen.getByText(/Talk to Ada, or type to her here/)).toBeInTheDocument();
  });

  it("grows Ada's line as she speaks, marks a cut-off one, and keeps captions on", async () => {
    const { emit } = await renderSession();
    emit(line({ id: 't1', text: 'We start', final: false }));
    expect(screen.getByText('We start')).toBeInTheDocument();
    emit(line({ id: 't1', text: 'We start at q0, and', final: true, interrupted: true }));
    expect(screen.getAllByTestId('chat-line')).toHaveLength(1);
    expect(screen.getByText('We start at q0, and')).toBeInTheDocument();
    expect(screen.getByText('Cut off')).toBeInTheDocument();
    // Her label, iris.
    expect(screen.getByText('Ada', { selector: '[data-role="tutor"] p' })).toHaveClass(
      'text-iris-ink',
    );
    // The chat never hides the captions.
    emit({ type: 'caption', speaker: 'tutor', text: 'We start at q0.', lang: 'en', final: true });
    expect(screen.getByTestId('captions')).toHaveTextContent('We start at q0.');
  });

  it('an action row pins the stage where Ada did it', async () => {
    const { emit, user } = await renderSession();
    emit(
      line({
        id: 'a1',
        role: 'action',
        source: null,
        action: { kind: 'draw', side: 'board', item: null, attachment_id: null },
      }),
    );
    emit(
      line({
        id: 'a2',
        role: 'action',
        source: null,
        action: { kind: 'mark', side: 'paper', item: null, attachment_id: null },
      }),
    );
    emit(
      line({
        id: 'a3',
        role: 'action',
        source: null,
        action: { kind: 'undo', side: 'board', item: null, attachment_id: null },
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Drew on the board' }));
    expect(useStageStore.getState()).toMatchObject({ pinned: 'board', mode: 'board' });
    await user.click(screen.getByRole('button', { name: 'Marked your paper' }));
    expect(useStageStore.getState()).toMatchObject({ pinned: 'paper', mode: 'paper' });
    expect(screen.getByRole('button', { name: 'Undid that' })).toHaveAttribute(
      'title',
      'Show the board',
    );
  });

  it('an action row on her image goes to the image stage', async () => {
    const { emit, user } = await renderSession();
    // The latest registration is the stage (the session screen's own, when it has one, comes
    // back when this one goes).
    const shown: string[] = [];
    const off = registerImageStage((id) => shown.push(id));
    emit(
      line({
        id: 'a1',
        role: 'action',
        source: null,
        action: { kind: 'mark', side: 'image', item: 'm4', attachment_id: 'att-1' },
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Marked your image' }));
    expect(shown).toEqual(['att-1']);
    expect(screen.queryByRole('dialog', { name: 'Your image' })).not.toBeInTheDocument();
    off();
  });

  it('leaves the chat empty when the session screen goes', async () => {
    const { emit, unmount } = await renderSession();
    emit(line({ id: 't1', text: 'Hello' }));
    expect(useChatStore.getState().lines).toHaveLength(1);
    unmount();
    expect(useChatStore.getState().lines).toEqual([]);
  });
});
