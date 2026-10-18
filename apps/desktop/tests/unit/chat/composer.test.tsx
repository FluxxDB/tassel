// @vitest-environment jsdom
import type { ApiClient } from '@tassel/shared/api';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatSidebar } from '../../../src/renderer/src/features/chat/ChatSidebar';
import { useChatPrefs } from '../../../src/renderer/src/features/chat/chat-prefs';
import { useChatStore } from '../../../src/renderer/src/features/chat/chat-store';
import { initI18n } from '../../../src/renderer/src/i18n';
import { ApiProvider } from '../../../src/renderer/src/lib/api';
import { useLatestFrame } from '../../../src/renderer/src/paper/latest-frame';
import { usePaperStore } from '../../../src/renderer/src/paper/paper-store';
import type { OutgoingMessage, TutorClient } from '../../../src/renderer/src/tutor/types';

const SESSION = '3a8f0d5e-62a4-4c0b-a3bb-2b5c1f7e9d10';

function setup({ upload = () => true }: { upload?: () => boolean } = {}) {
  let uploaded = 0;
  const POST = vi.fn(async (_path: string, init: { params: { query?: { frame_id?: string } } }) => {
    if (init.params.query?.frame_id)
      return {
        data: { id: 'att-paper', w: 1600, h: 1200 },
        response: new Response(null, { status: 201 }),
      };
    if (!upload()) return { error: {}, response: new Response(null, { status: 501 }) };
    uploaded += 1;
    return {
      data: { id: `att-${uploaded}`, w: 800, h: 600 },
      response: new Response(null, { status: 201 }),
    };
  });
  const GET = vi.fn(async () => ({ error: {}, response: new Response(null, { status: 501 }) }));
  const api = { POST, GET } as unknown as ApiClient;
  const sent: OutgoingMessage[] = [];
  const client: TutorClient = {
    connect: async () => {},
    disconnect: async () => {},
    on: () => () => {},
    sendText: () => {},
    sendMessage: (message) => {
      sent.push(message);
      return true;
    },
  };
  const prepare = vi.fn(async (file: Blob) => {
    if ((file as File).name === 'broken.heic') throw new Error('unreadable');
    return { blob: new Blob(['jpeg'], { type: 'image/jpeg' }), w: 800, h: 600 };
  });
  return { api, POST, client, sent, prepare };
}

async function renderSidebar(deps = setup()) {
  const i18n = await initI18n('en');
  const user = userEvent.setup();
  render(
    <I18nextProvider i18n={i18n}>
      <ApiProvider client={deps.api}>
        <ChatSidebar sessionId={SESSION} lang="en" client={deps.client} prepare={deps.prepare} />
      </ApiProvider>
    </I18nextProvider>,
  );
  const field = screen.getByRole('textbox', { name: 'Message to Ada' });
  return { ...deps, user, field };
}

const png = (name = 'part-b.png') => new File(['png'], name, { type: 'image/png' });
const chips = () => screen.queryAllByRole('button', { name: /^Remove image/ });

beforeEach(() => {
  localStorage.clear();
  useChatPrefs.setState({ open: null, defaultOpen: true, voiceReplies: true });
  useChatStore.getState().reset();
  let n = 0;
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => `blob:${++n}`, revokeObjectURL: () => {} }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  usePaperStore.setState(usePaperStore.getInitialState(), true);
  useLatestFrame.getState().reset();
});

describe('the chat composer', () => {
  it('sends on Enter, and Shift+Enter starts a new line', async () => {
    const { user, field, sent } = await renderSidebar();
    await user.type(field, 'Why does q2 loop?{Shift>}{Enter}{/Shift}Part b');
    expect(field).toHaveValue('Why does q2 loop?\nPart b');
    expect(sent).toEqual([]);
    await user.keyboard('{Enter}');
    expect(sent).toEqual([
      {
        clientId: expect.any(String),
        text: 'Why does q2 loop?\nPart b',
        attachmentIds: [],
        voice: true,
      },
    ]);
    expect(field).toHaveValue('');
    // Shown at once, before any echo: hers, on the right.
    const log = screen.getByRole('log', { name: 'Conversation' });
    expect(within(log).getByText(/Why does q2 loop\?/)).toBeInTheDocument();
  });

  it('never sends the Enter that ends an IME composition', async () => {
    const { field, sent } = await renderSidebar();
    fireEvent.change(field, { target: { value: '안녕' } });
    fireEvent.compositionStart(field);
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(field, { key: 'Enter', keyCode: 229 });
    fireEvent.compositionEnd(field);
    expect(sent).toEqual([]);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(sent.map((m) => m.text)).toEqual(['안녕']);
  });

  it('ignores an empty send', async () => {
    const { user, field, sent } = await renderSidebar();
    await user.type(field, '   {Enter}');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(sent).toEqual([]);
    expect(useChatStore.getState().lines).toEqual([]);
  });

  it('caps the message at 4000 characters and counts down near the end', async () => {
    const { field } = await renderSidebar();
    expect(field).toHaveAttribute('maxlength', '4000');
    fireEvent.change(field, { target: { value: 'x'.repeat(3700) } });
    expect(screen.getByText('3700 of 4000 characters')).toBeInTheDocument();
    expect(field).toHaveAccessibleDescription('3700 of 4000 characters');
  });

  it('takes images by the paperclip, by paste and by a drop, four at most', async () => {
    const { user, field, prepare } = await renderSidebar();
    const input = screen.getByTestId('chat-file-input');
    expect(input).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp,image/heic');
    await user.upload(input, [png('a.png'), png('b.png')]);
    await waitFor(() => expect(chips()).toHaveLength(2));
    fireEvent.paste(field, { clipboardData: { files: [png('c.png')] } });
    await waitFor(() => expect(chips()).toHaveLength(3));
    const sidebar = screen.getByRole('complementary', { name: 'Conversation' });
    fireEvent.drop(sidebar, {
      dataTransfer: { types: ['Files'], files: [png('d.png'), png('e.png')] },
    });
    await waitFor(() => expect(chips()).toHaveLength(4));
    expect(screen.getByRole('status')).toHaveTextContent('Up to 4 images in a message');
    expect(prepare).toHaveBeenCalledTimes(4);
    // A chip comes off; what isn't an image never goes on.
    await user.click(screen.getByRole('button', { name: 'Remove image 2' }));
    expect(chips()).toHaveLength(3);
    fireEvent.paste(field, {
      clipboardData: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] },
    });
    expect(chips()).toHaveLength(3);
  });

  it("says when an image can't be read", async () => {
    const { user } = await renderSidebar();
    await user.upload(screen.getByTestId('chat-file-input'), [
      new File(['heic'], 'broken.heic', { type: 'image/heic' }),
    ]);
    expect(await screen.findByRole('status')).toHaveTextContent("That image couldn't be read");
    expect(chips()).toHaveLength(0);
  });

  it('uploads the images first, then sends their ids, and retries a failed upload', async () => {
    let ok = false;
    const deps = setup({ upload: () => ok });
    const { user, field, sent } = await renderSidebar(deps);
    await user.upload(screen.getByTestId('chat-file-input'), [png()]);
    await waitFor(() => expect(chips()).toHaveLength(1));
    await user.type(field, "Here's part b{Enter}");
    expect(await screen.findByText('Not sent')).toBeInTheDocument();
    expect(sent).toEqual([]);
    ok = true;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(sent).toEqual([
        {
          clientId: expect.any(String),
          text: "Here's part b",
          attachmentIds: ['att-1'],
          voice: true,
        },
      ]),
    );
    expect(screen.queryByText('Not sent')).not.toBeInTheDocument();
    // The echo takes its place: one line, hers.
    act(() =>
      useChatStore.getState().receive({
        id: 'm-1',
        client_id: sent[0]?.clientId ?? null,
        role: 'student',
        source: 'typed',
        text: "Here's part b",
        final: true,
        interrupted: false,
        attachments: [{ id: 'att-1', w: 800, h: 600 }],
        action: null,
      }),
    );
    expect(screen.getAllByTestId('chat-line')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Image 1' })).toBeInTheDocument();
  });

  it('remembers the voice pill: Ada speaks replies, or text replies only', async () => {
    const { user, field, sent } = await renderSidebar();
    const pill = screen.getByTestId('chat-voice');
    expect(pill).toHaveAccessibleName('Ada speaks replies');
    await user.click(pill);
    expect(pill).toHaveAccessibleName('Text replies only');
    expect(JSON.parse(localStorage.getItem('tassel.chat-prefs') ?? '{}').state).toMatchObject({
      voiceReplies: false,
    });
    await user.type(field, 'Just text{Enter}');
    expect(sent[0]).toMatchObject({ voice: false });
  });

  it('snaps her paper while a paper source is live: the server attaches her latest frame', async () => {
    const deps = setup();
    usePaperStore.setState({ status: 'live' } as never);
    useLatestFrame.getState().record(SESSION, 'frame-9');
    const { user, POST } = await renderSidebar(deps);
    await user.click(screen.getByRole('button', { name: 'Snap my paper' }));
    await waitFor(() => expect(chips()).toHaveLength(1));
    expect(POST.mock.calls.at(-1)?.[1]).toMatchObject({
      params: { query: { frame_id: 'frame-9' } },
    });
  });

  it('shows no Snap my paper without a live paper source', async () => {
    await renderSidebar();
    expect(screen.queryByRole('button', { name: 'Snap my paper' })).not.toBeInTheDocument();
  });

  it("opens an image action row in the sidebar's own viewer when no stage shows images", async () => {
    const { user } = await renderSidebar();
    act(() =>
      useChatStore.getState().receive({
        id: 'a1',
        client_id: null,
        role: 'action',
        source: null,
        text: '',
        final: true,
        interrupted: false,
        attachments: [],
        action: { kind: 'mark', side: 'image', item: 'm4', attachment_id: 'att-1' },
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Marked your image' }));
    expect(await screen.findByRole('dialog', { name: 'Your image' })).toBeInTheDocument();
  });
});
