import type { ChatMessage } from '@tassel/shared/voice';
import fixtures from '@tassel/shared/voice/fixtures.json';
import { beforeEach, describe, expect, it } from 'vitest';
import { useChatStore } from '../../../src/renderer/src/features/chat/chat-store';

const chat = () => useChatStore.getState();

function line(overrides: Partial<ChatMessage> & Pick<ChatMessage, 'id'>): ChatMessage {
  return {
    client_id: null,
    role: 'tutor',
    source: 'voice',
    text: '',
    final: true,
    interrupted: false,
    attachments: [],
    action: null,
    ...overrides,
  };
}

beforeEach(() => chat().reset());

describe('the chat store', () => {
  it("keeps lines in arrival order and grows Ada's line in place by id", () => {
    chat().receive(line({ id: 's1', role: 'student', text: 'Draw it?' }));
    chat().receive(line({ id: 't1', text: 'We start', final: false }));
    chat().receive(line({ id: 'a1', role: 'action', source: null }));
    chat().receive(line({ id: 't1', text: 'We start at q0.', final: true }));
    expect(chat().lines.map((l) => [l.id, l.text, l.final])).toEqual([
      ['s1', 'Draw it?', true],
      ['t1', 'We start at q0.', true],
      ['a1', '', true],
    ]);
  });

  it('shows only her final spoken lines', () => {
    chat().receive(line({ id: 's1', role: 'student', text: 'Can you', final: false }));
    expect(chat().lines).toEqual([]);
    chat().receive(line({ id: 's1', role: 'student', text: 'Can you draw it?' }));
    expect(chat().lines.map((l) => l.text)).toEqual(['Can you draw it?']);
  });

  it("shows her typed message at once and puts the server's echo in its place", () => {
    const blob = new Blob(['jpeg']);
    chat().addPending({
      clientId: 'c-1',
      text: "Here's part b",
      voice: false,
      images: [{ id: null, key: 'img-1', w: 640, h: 480, preview: 'blob:img-1', blob }],
    });
    chat().receive(line({ id: 't0', text: 'Earlier line' }));
    expect(chat().lines[0]).toMatchObject({ key: 'c-1', id: null, status: 'uploading' });
    chat().update('c-1', {
      status: 'sending',
      images: [{ id: 'att-1', key: 'img-1', w: 640, h: 480, preview: 'blob:img-1', blob: null }],
    });
    chat().receive(
      line({
        id: 'm-1',
        client_id: 'c-1',
        role: 'student',
        source: 'typed',
        text: "Here's part b",
        attachments: [{ id: 'att-1', w: 1280, h: 960 }],
      }),
    );
    const [mine] = chat().lines;
    expect(chat().lines).toHaveLength(2);
    // Same key, so React keeps the row; her preview stays, the server's size wins.
    expect(mine).toMatchObject({ key: 'c-1', id: 'm-1', status: 'sent', voice: false });
    expect(mine?.images).toEqual([
      { id: 'att-1', key: 'img-1', w: 1280, h: 960, preview: 'blob:img-1', blob: null },
    ]);
  });

  it('marks a failed message and keeps it for a retry', () => {
    chat().addPending({ clientId: 'c-2', text: 'Why?', voice: true, images: [] });
    expect(chat().lines[0]?.status).toBe('sending');
    chat().update('c-2', { status: 'failed' });
    expect(chat().lines[0]).toMatchObject({ status: 'failed', text: 'Why?' });
  });

  it("ends Ada's line in progress as cut off, and leaves finished ones alone", () => {
    chat().receive(line({ id: 't1', text: 'Done.' }));
    chat().receive(line({ id: 't2', text: 'We start at', final: false }));
    chat().interruptCurrent();
    expect(chat().lines.map((l) => [l.id, l.final, l.interrupted])).toEqual([
      ['t1', true, false],
      ['t2', true, true],
    ]);
    chat().interruptCurrent();
    expect(chat().lines[1]).toMatchObject({ interrupted: true });
  });

  it('loads the saved conversation ahead of lines that came while it loaded', () => {
    chat().receive(line({ id: 'live-1', text: 'New line' }));
    chat().receive(line({ id: 'm-2', text: 'Saved and live' }));
    chat().loadHistory([
      { ...line({ id: 'm-1', role: 'student', source: 'typed', text: 'Saved' }) },
      { ...line({ id: 'm-2', text: 'Saved and live' }) },
    ]);
    expect(chat().lines.map((l) => l.id)).toEqual(['m-1', 'm-2', 'live-1']);
  });

  it('takes every message fixture the contract defines', () => {
    const messages = fixtures.server.filter((e) => e.kind === 'message') as unknown as Array<
      { kind: 'message' } & ChatMessage
    >;
    for (const { kind: _kind, ...message } of messages) chat().receive(message);
    // The interim tutor line shows; every fixture is a line of its own.
    expect(chat().lines.map((l) => l.id)).toEqual(['m-1', 'm-2', 'm-3', 'm-4', 'm-5', 'm-6']);
    expect(chat().lines[3]).toMatchObject({ interrupted: true });
  });

  it('starts empty after a reset', () => {
    chat().receive(line({ id: 't1', text: 'Hi' }));
    chat().reset();
    expect(chat().lines).toEqual([]);
  });
});
