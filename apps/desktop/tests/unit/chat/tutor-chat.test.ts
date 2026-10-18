// @vitest-environment jsdom
import { RTVIEvent } from '@pipecat-ai/client-js';
import fixtures from '@tassel/shared/voice/fixtures.json';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readConfig } from '../../../src/main/config';
import { shortcutFor } from '../../../src/renderer/src/features/session/shortcuts';
import { FAKE_REPLY, FakeTutorClient, REPLY_MS } from '../../../src/renderer/src/tutor/fake-client';
import {
  LiveTutorClient,
  type PipecatLike,
} from '../../../src/renderer/src/tutor/live/live-client';
import { Mic } from '../../../src/renderer/src/tutor/live/mic';
import { initialMapState, mapRtvi } from '../../../src/renderer/src/tutor/live/rtvi-map';
import type { TutorAudio } from '../../../src/renderer/src/tutor/live/tutor-audio';
import type { Clock, FakeScript, TutorEvent } from '../../../src/renderer/src/tutor/types';
import { micHarness } from '../live/audio-fakes';

vi.mock('electron', () => ({ app: { setPath: () => {}, getPreferredSystemLanguages: () => [] } }));

class ManualClock implements Clock {
  time = 0;
  next = 0;
  timers = new Map<number, { at: number; fn: () => void }>();
  now() {
    return this.time;
  }
  setTimeout(fn: () => void, ms: number) {
    const id = ++this.next;
    this.timers.set(id, { at: this.time + ms, fn });
    return id;
  }
  clearTimeout(id: unknown) {
    this.timers.delete(id as number);
  }
  advance(ms: number) {
    const end = this.time + ms;
    for (;;) {
      const due = [...this.timers.entries()].sort(([, a], [, b]) => a.at - b.at)[0];
      if (!due || due[1].at > end) break;
      this.timers.delete(due[0]);
      this.time = due[1].at;
      due[1].fn();
    }
    this.time = end;
  }
}

class FakePipecat implements PipecatLike {
  handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  connect = vi.fn(async (_params: unknown) => this.emit(RTVIEvent.BotReady));
  disconnect = vi.fn(async () => this.emit(RTVIEvent.Disconnected));
  sendText = vi.fn(async () => 'text-id');
  sendClientMessage = vi.fn((_type: string, _data?: unknown) => {});
  on(event: string, handler: (...args: unknown[]) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
  }
  emit(event: string, ...args: unknown[]) {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }
}

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

function liveClient() {
  const h = micHarness();
  const mic = new Mic(h.deps);
  cleanup.push(() => mic.close());
  const clients: FakePipecat[] = [];
  const events: TutorEvent[] = [];
  const client = new LiveTutorClient({
    serverUrl: 'http://localhost:8823',
    getToken: async () => 'test-token',
    getIceServers: async () => [],
    mic,
    audio: {
      interrupt: vi.fn(),
      attach: vi.fn(),
      duck: vi.fn(),
      setSinks: vi.fn(),
      presenterSinkId: null,
    } as unknown as TutorAudio,
    micOptions: () => ({ deviceId: null, processing: true }),
    offerData: () => ({ sensitivity: 'normal', ptt: false }),
    lang: () => 'en',
    createPipecat: () => {
      const pc = new FakePipecat();
      clients.push(pc);
      return pc;
    },
    clock: new ManualClock(),
  });
  client.on((event) => events.push(event));
  return { client, clients, events };
}

describe("the chat's tutor events", () => {
  it('maps the server message event to a message TutorEvent, by id', () => {
    const server = fixtures.server.filter((e) => e.kind === 'message');
    let state = initialMapState('en');
    const events: TutorEvent[] = [];
    for (const data of server) {
      const next = mapRtvi(state, { kind: 'server', data: { tassel: data } });
      state = next.state;
      events.push(...next.events);
    }
    expect(events.map((e) => e.type)).toEqual(server.map(() => 'message'));
    const { kind: _kind, ...first } = server[0] as Record<string, unknown>;
    expect(events[0]).toEqual({ type: 'message', message: first });
  });

  it('the live client sends a student-message, and says when it could not', async () => {
    const { client, clients } = liveClient();
    const message = { clientId: 'c-1', text: 'Why?', attachmentIds: ['att-1'], voice: false };
    expect(client.sendMessage(message)).toBe(false);
    await client.connect('s');
    expect(client.sendMessage(message)).toBe(true);
    expect(clients[0]?.sendClientMessage).toHaveBeenCalledWith('tassel', {
      kind: 'student-message',
      client_id: 'c-1',
      text: 'Why?',
      attachment_ids: ['att-1'],
      voice: false,
    });
    await client.disconnect();
  });

  it('the live client passes the server message event on', async () => {
    const { client, clients, events } = liveClient();
    await client.connect('s');
    clients[0]?.emit(RTVIEvent.ServerMessage, {
      tassel: fixtures.server.find((e) => e.kind === 'message'),
    });
    expect(events.filter((e) => e.type === 'message')).toHaveLength(1);
    await client.disconnect();
  });
});

const SCRIPT: FakeScript = {
  steps: [
    {
      at: 100,
      event: { type: 'caption', speaker: 'student', text: 'Hi Ada', lang: 'en', final: true },
    },
    { at: 200, event: { type: 'caption', speaker: 'tutor', text: 'Hi.', lang: 'en', final: true } },
  ],
};

function fake(chat: boolean) {
  const clock = new ManualClock();
  const client = new FakeTutorClient(SCRIPT, { clock, chat });
  const events: TutorEvent[] = [];
  client.on((event) => events.push(event));
  const messages = () => events.flatMap((e) => (e.type === 'message' ? [e.message] : []));
  return { clock, client, events, messages };
}

describe('the fake tutor with chat on', () => {
  it('plays each scripted final line as a spoken chat line', async () => {
    const { clock, client, messages } = fake(true);
    await client.connect('s');
    clock.advance(300);
    expect(messages().map((m) => [m.role, m.source, m.text])).toEqual([
      ['student', 'voice', 'Hi Ada'],
      ['tutor', 'voice', 'Hi.'],
    ]);
  });

  it('echoes a typed message and answers aloud, growing the line, then an action row', async () => {
    const { clock, client, events, messages } = fake(true);
    await client.connect('s');
    clock.advance(300);
    const before = messages().length;
    const sent = { clientId: 'c-1', text: 'Draw it?', attachmentIds: ['att-1'], voice: true };
    expect(client.sendMessage(sent)).toBe(true);
    clock.advance(REPLY_MS.action);
    const after = messages().slice(before);
    expect(after[0]).toMatchObject({
      role: 'student',
      source: 'typed',
      client_id: 'c-1',
      text: 'Draw it?',
    });
    expect(after[0]?.attachments).toEqual([{ id: 'att-1', w: 0, h: 0 }]);
    expect(after.slice(1, 3).map((m) => [m.role, m.text, m.final])).toEqual([
      ['tutor', FAKE_REPLY.voice[0], false],
      ['tutor', FAKE_REPLY.voice[1], true],
    ]);
    expect(after[1]?.id).toBe(after[2]?.id);
    expect(after[3]).toMatchObject({ role: 'action', action: { kind: 'draw', side: 'board' } });
    expect(events).toContainEqual({
      type: 'caption',
      speaker: 'tutor',
      text: FAKE_REPLY.voice[1],
      lang: 'en',
      final: true,
    });
  });

  it('answers a text-only message without a word spoken', async () => {
    const { clock, client, events, messages } = fake(true);
    await client.connect('s');
    clock.advance(300);
    const captions = events.filter((e) => e.type === 'caption').length;
    client.sendMessage({ clientId: 'c-2', text: 'Quietly', attachmentIds: [], voice: false });
    clock.advance(REPLY_MS.action);
    expect(messages().at(-2)).toMatchObject({ role: 'tutor', text: FAKE_REPLY.text[1] });
    expect(events.filter((e) => e.type === 'caption')).toHaveLength(captions);
    expect(events.filter((e) => e.type === 'state')).toEqual([]);
  });

  it('plays no chat lines with chat off, as the unit specs construct it', async () => {
    const { clock, client, messages } = fake(false);
    await client.connect('s');
    clock.advance(300);
    expect(messages()).toEqual([]);
  });

  it('refuses a message before it connects', () => {
    const { client } = fake(true);
    expect(client.sendMessage({ clientId: 'c', text: 'x', attachmentIds: [], voice: true })).toBe(
      false,
    );
  });
});

describe('the chat shortcut and launch setting', () => {
  it('T toggles the sidebar, by its key or its position', () => {
    expect(shortcutFor(new KeyboardEvent('keydown', { key: 't' }))).toBe('t');
    expect(shortcutFor(new KeyboardEvent('keydown', { key: 'ㅅ', code: 'KeyT' }))).toBe('t');
    expect(shortcutFor(new KeyboardEvent('keydown', { key: 't', metaKey: true }))).toBeNull();
  });

  it('TASSEL_CHAT_SIDEBAR=closed starts it hidden; otherwise nothing is set', () => {
    expect(readConfig({ TASSEL_CHAT_SIDEBAR: 'closed' })).toMatchObject({ chatSidebar: 'closed' });
    expect(readConfig({})).not.toHaveProperty('chatSidebar');
    expect(readConfig({ TASSEL_CHAT_SIDEBAR: 'open' })).not.toHaveProperty('chatSidebar');
  });
});
