// @vitest-environment jsdom
import type { ApiClient } from '@tassel/shared/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachmentImage,
  fetchHistory,
  snapPaper,
} from '../../../src/renderer/src/features/chat/chat-api';
import { type ChatImage, useChatStore } from '../../../src/renderer/src/features/chat/chat-store';
import { retryMessage, sendMessage } from '../../../src/renderer/src/features/chat/send';
import type { OutgoingMessage, TutorClient } from '../../../src/renderer/src/tutor/types';

const SESSION = '3a8f0d5e-62a4-4c0b-a3bb-2b5c1f7e9d10';
const chat = () => useChatStore.getState();

function fakeApi(answers: { post?: () => Response | Promise<Response>; get?: () => Response }) {
  const POST = vi.fn(async (_path: string, init: { bodySerializer?: () => FormData }) => {
    const response = await (answers.post ?? (() => json({ id: 'att', w: 1, h: 1 }, 201)))();
    const data = response.ok ? await response.clone().json() : undefined;
    init.bodySerializer?.();
    return { data, error: data ? undefined : {}, response };
  });
  const GET = vi.fn(async (_path: string, init: { parseAs?: string }) => {
    const response = (answers.get ?? (() => new Response(null, { status: 501 })))();
    if (!response.ok) return { error: {}, response };
    const data = init.parseAs === 'blob' ? await response.blob() : await response.json();
    return { data, response };
  });
  return { POST, GET, api: { POST, GET } as unknown as ApiClient };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function fakeClient(ok = true) {
  const sent: OutgoingMessage[] = [];
  const client: TutorClient = {
    connect: async () => {},
    disconnect: async () => {},
    on: () => () => {},
    sendText: () => {},
    sendMessage: (message) => {
      sent.push(message);
      return ok;
    },
  };
  return { client, sent };
}

const image = (key: string): ChatImage => ({
  id: null,
  key,
  w: 800,
  h: 600,
  preview: `blob:${key}`,
  blob: new Blob([key], { type: 'image/jpeg' }),
});

beforeEach(() => chat().reset());

describe('sending a chat message', () => {
  it('shows it at once, uploads its images first, then sends their ids', async () => {
    let n = 0;
    const { api, POST } = fakeApi({ post: () => json({ id: `att-${++n}`, w: 1280, h: 960 }, 201) });
    const { client, sent } = fakeClient();
    const going = sendMessage(
      { api, sessionId: SESSION, client, newId: () => 'c-1' },
      { text: "Here's part b", images: [image('a'), image('b')], voice: true },
    );
    expect(chat().lines[0]).toMatchObject({ clientId: 'c-1', status: 'uploading' });
    await going;
    expect(POST).toHaveBeenCalledTimes(2);
    expect(POST.mock.calls[0]?.[0]).toBe('/v1/sessions/{session_id}/attachments');
    expect(sent).toEqual([
      { clientId: 'c-1', text: "Here's part b", attachmentIds: ['att-1', 'att-2'], voice: true },
    ]);
    expect(chat().lines[0]).toMatchObject({ status: 'sending' });
    expect(chat().lines[0]?.images.map((i) => [i.id, i.blob])).toEqual([
      ['att-1', null],
      ['att-2', null],
    ]);
  });

  it('marks it failed when an upload fails, and a retry uploads only what is left', async () => {
    let n = 0;
    const answers = [json({ id: 'att-1', w: 8, h: 6 }, 201), json({ detail: 'no' }, 501)];
    const { api, POST } = fakeApi({
      post: () => answers[n++] ?? json({ id: 'att-2', w: 8, h: 6 }, 201),
    });
    const { client, sent } = fakeClient();
    const deps = { api, sessionId: SESSION, client, newId: () => 'c-2' };
    await sendMessage(deps, { text: '', images: [image('a'), image('b')], voice: false });
    expect(chat().lines[0]).toMatchObject({ status: 'failed' });
    expect(sent).toEqual([]);
    await retryMessage(deps, 'c-2');
    expect(POST).toHaveBeenCalledTimes(3);
    expect(sent).toEqual([
      { clientId: 'c-2', text: '', attachmentIds: ['att-1', 'att-2'], voice: false },
    ]);
  });

  it('marks it failed when there is no connection to send it on', async () => {
    const { api } = fakeApi({});
    const { client } = fakeClient(false);
    await sendMessage(
      { api, sessionId: SESSION, client, newId: () => 'c-3' },
      { text: 'Why?', images: [], voice: true },
    );
    expect(chat().lines[0]).toMatchObject({ status: 'failed', text: 'Why?' });
  });

  it("is matched by the server's echo", async () => {
    const { api } = fakeApi({});
    const { client } = fakeClient();
    await sendMessage(
      { api, sessionId: SESSION, client, newId: () => 'c-4' },
      { text: 'Why?', images: [], voice: true },
    );
    chat().receive({
      id: 'm-9',
      client_id: 'c-4',
      role: 'student',
      source: 'typed',
      text: 'Why?',
      final: true,
      interrupted: false,
      attachments: [],
      action: null,
    });
    expect(chat().lines).toHaveLength(1);
    expect(chat().lines[0]).toMatchObject({ id: 'm-9', status: 'sent', key: 'c-4' });
  });

  it('offers a retry when no echo comes, and a retry waits afresh', async () => {
    vi.useFakeTimers();
    try {
      const { api } = fakeApi({});
      const { client, sent } = fakeClient();
      const deps = { api, sessionId: SESSION, client, newId: () => 'c-6', echoTimeoutMs: 1000 };
      await sendMessage(deps, { text: 'Hello?', images: [], voice: true });
      vi.advanceTimersByTime(999);
      expect(chat().lines[0]?.status).toBe('sending');
      vi.advanceTimersByTime(1);
      expect(chat().lines[0]?.status).toBe('failed');
      await retryMessage(deps, 'c-6');
      expect(sent).toHaveLength(2);
      vi.advanceTimersByTime(500);
      expect(chat().lines[0]?.status).toBe('sending');
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends nothing for an empty message', async () => {
    const { api } = fakeApi({});
    const { client, sent } = fakeClient();
    await sendMessage(
      { api, sessionId: SESSION, client },
      { text: '   ', images: [], voice: true },
    );
    expect(chat().lines).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('trims the text and keeps it under 4000 characters', async () => {
    const { api } = fakeApi({});
    const { client, sent } = fakeClient();
    await sendMessage(
      { api, sessionId: SESSION, client, newId: () => 'c-5' },
      { text: `  ${'x'.repeat(4100)}  `, images: [], voice: true },
    );
    expect(sent[0]?.text).toHaveLength(4000);
  });
});

describe('the chat API', () => {
  it("snaps her paper: the server attaches the frame it's given", async () => {
    const { api, POST } = fakeApi({ post: () => json({ id: 'att-p', w: 1600, h: 1200 }, 201) });
    expect(await snapPaper(api, SESSION, 'frame-7')).toEqual({ id: 'att-p', w: 1600, h: 1200 });
    expect(POST.mock.calls[0]?.[1]).toMatchObject({
      params: { path: { session_id: SESSION }, query: { frame_id: 'frame-7' } },
    });
  });

  it('reads the saved conversation, and an unready server (501) as none', async () => {
    const saved = {
      messages: [
        {
          id: 'm-1',
          client_id: null,
          role: 'student',
          source: 'voice',
          text: 'Hi',
          interrupted: false,
          attachments: [],
          action: null,
          created_at: '2026-10-18T12:00:00Z',
        },
      ],
    };
    expect(await fetchHistory(fakeApi({ get: () => json(saved) }).api, SESSION)).toEqual(
      saved.messages,
    );
    expect(await fetchHistory(fakeApi({}).api, SESSION)).toEqual([]);
    // Anything that isn't a list of messages is none.
    expect(await fetchHistory(fakeApi({ get: () => json({ id: 'x' }) }).api, SESSION)).toEqual([]);
  });

  it("fetches an attachment's image with the device token", async () => {
    const { api, GET } = fakeApi({ get: () => new Response('jpg') });
    const blob = await attachmentImage(api, SESSION, 'att-1');
    expect(await blob?.text()).toBe('jpg');
    expect(GET.mock.calls[0]?.[1]).toMatchObject({ parseAs: 'blob' });
    expect(await attachmentImage(fakeApi({}).api, SESSION, 'att-1')).toBeNull();
  });
});
