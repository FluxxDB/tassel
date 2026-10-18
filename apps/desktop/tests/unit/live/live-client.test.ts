// @vitest-environment jsdom
import { RTVIEvent } from '@pipecat-ai/client-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LiveTutorClient,
  type PipecatLike,
} from '../../../src/renderer/src/tutor/live/live-client';
import { Mic } from '../../../src/renderer/src/tutor/live/mic';
import type { TutorAudio } from '../../../src/renderer/src/tutor/live/tutor-audio';
import type { Clock, TutorEvent } from '../../../src/renderer/src/tutor/types';
import { FakeTrack, micHarness } from './audio-fakes';

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
    this.time += ms;
    for (const [id, t] of this.timers)
      if (t.at <= this.time) {
        this.timers.delete(id);
        t.fn();
      }
  }
}
class FakePipecat implements PipecatLike {
  handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  connect = vi.fn(async (_params: unknown) => {
    this.emit(RTVIEvent.BotReady);
  });
  disconnect = vi.fn(async () => {
    this.emit(RTVIEvent.Disconnected);
  });
  sendText = vi.fn(async (_text: string, _options?: object) => 'text-id');
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
function setup(opts: { lang?: () => 'en' | 'es' | 'ko' } = {}) {
  const h = micHarness();
  const mic = new Mic(h.deps);
  cleanup.push(() => mic.close());
  const audio = { attach: vi.fn(), duck: vi.fn(), setSinks: vi.fn(), presenterSinkId: null };
  const clock = new ManualClock();
  const clients: FakePipecat[] = [];
  const events: TutorEvent[] = [];
  let behavior: (pc: FakePipecat) => void = () => {};
  const getIceServers = vi.fn(
    async (): Promise<RTCIceServer[]> => [{ urls: 'stun:example.test:3478' }],
  );
  const getToken = vi.fn(async () => 'test-token');
  const createPipecat = vi.fn((_transport: unknown) => {
    const pc = new FakePipecat();
    clients.push(pc);
    behavior(pc);
    return pc;
  });
  const client = new LiveTutorClient({
    serverUrl: 'http://localhost:8823',
    getToken,
    getIceServers,
    mic,
    audio: audio as unknown as TutorAudio,
    micOptions: () => ({ deviceId: null, processing: true }),
    offerData: () => ({ sensitivity: 'normal', ptt: false }),
    lang: opts.lang ?? (() => 'en'),
    createPipecat,
    clock,
  });
  client.on((event) => events.push(event));
  return {
    ...h,
    mic,
    audio,
    clock,
    clients,
    events,
    getIceServers,
    getToken,
    createPipecat,
    client,
    setBehavior: (fn: typeof behavior) => {
      behavior = fn;
    },
  };
}
async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
describe('LiveTutorClient', () => {
  it('retires only after the SDK synchronous error callback unwinds', async () => {
    const { client, clients } = setup();
    await client.connect('s');
    const pc = clients[0] as FakePipecat;
    // SmallWebRTC.stop(error) emits error before closing/nulling its peer connection.
    // Calling disconnect from that callback reenters stop and double-closes the same PC.
    pc.emit(RTVIEvent.TransportStateChanged, 'error');
    expect(pc.disconnect).not.toHaveBeenCalled();
    await flush();
    expect(pc.disconnect).toHaveBeenCalledOnce();
    await client.disconnect();
  });

  it('connects with bearer Headers, requestData and a 15s timeout', async () => {
    const { client, clients, events, getIceServers } = setup();
    await client.connect('session /1');
    const params = clients[0]?.connect.mock.calls[0]?.[0] as {
      webrtcRequestParams: {
        endpoint: string;
        headers: Headers;
        requestData: unknown;
        timeout: number;
      };
    };
    expect(params.webrtcRequestParams.endpoint).toBe(
      'http://localhost:8823/v1/sessions/session%20%2F1/voice/offer',
    );
    expect(params.webrtcRequestParams.headers).toBeInstanceOf(Headers);
    expect(params.webrtcRequestParams.headers.get('Authorization')).toBe('Bearer test-token');
    expect(params.webrtcRequestParams.requestData).toEqual({ sensitivity: 'normal', ptt: false });
    expect(params.webrtcRequestParams.timeout).toBe(15000);
    expect(getIceServers).toHaveBeenCalledOnce();
    expect(client.voice.connectionCount).toBe(1);
    expect(events).toContainEqual({ type: 'connection', status: 'connected' });
    await client.disconnect();
  });
  it('opens capture only after BotReady, and ignores duplicate ready notifications', async () => {
    const { client, clients, media, setBehavior } = setup();
    let ready!: () => void;
    setBehavior((pc) =>
      pc.connect.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            ready = () => {
              pc.emit(RTVIEvent.BotReady);
              resolve();
            };
          }),
      ),
    );
    const connecting = client.connect('s');
    await flush();
    expect(media.getUserMedia).not.toHaveBeenCalled();
    ready();
    await connecting;
    expect(media.getUserMedia).toHaveBeenCalledOnce();
    clients[0]?.emit(RTVIEvent.BotReady);
    await flush();
    expect(media.getUserMedia).toHaveBeenCalledOnce();
    await client.disconnect();
  });
  it('a typed line shows immediately and sends run_immediately/audio_response', async () => {
    const { client, clients, events } = setup();
    await client.connect('s');
    client.sendText('Explain this');
    expect(events.at(-1)).toEqual({
      type: 'caption',
      speaker: 'student',
      text: 'Explain this',
      final: true,
      lang: 'en',
    });
    expect(clients[0]?.sendText).toHaveBeenCalledWith('Explain this', {
      run_immediately: true,
      audio_response: true,
    });
    await client.disconnect();
  });
  it('remote audio without participant attaches, while local audio and video do not', async () => {
    const { client, clients, audio } = setup();
    await client.connect('s');
    const track = new FakeTrack().asTrack();
    clients[0]?.emit(RTVIEvent.TrackStarted, track);
    clients[0]?.emit(RTVIEvent.TrackStarted, track, { local: true });
    clients[0]?.emit(RTVIEvent.TrackStarted, { kind: 'video' });
    expect(audio.attach).toHaveBeenCalledExactlyOnceWith(track);
    await client.disconnect();
  });
  it('both UserTranscript and UserInput become student captions and numeric segments map', async () => {
    const { client, clients, events } = setup();
    await client.connect('s');
    const pc = clients[0];
    pc?.emit(RTVIEvent.UserTranscript, { text: 'one', final: false });
    pc?.emit(RTVIEvent.UserInput, { text: 'two', final: true });
    pc?.emit(RTVIEvent.BotStartedSpeaking);
    pc?.emit(RTVIEvent.BotOutput, {
      segment_id: 1,
      text: 'Hi',
      spoken_status: 'completed',
      spoken_progress: { accumulated_text: 'Hi', remaining_text: '' },
    });
    pc?.emit(RTVIEvent.BotStoppedSpeaking);
    expect(events.filter((e) => e.type === 'caption')).toEqual([
      { type: 'caption', speaker: 'student', text: 'one', final: false, lang: 'en' },
      { type: 'caption', speaker: 'student', text: 'two', final: true, lang: 'en' },
      { type: 'caption', speaker: 'tutor', text: 'Hi', final: false, lang: 'en' },
      { type: 'caption', speaker: 'tutor', text: 'Hi', final: true, lang: 'en' },
    ]);
    await client.disconnect();
  });
  it('retries after 1, 2 and 4 seconds, deduplicates error/disconnect and then fails', async () => {
    const { client, clients, clock, events, setBehavior } = setup();
    await client.connect('s');
    setBehavior((pc) => pc.connect.mockRejectedValue(new Error('offline')));
    clients[0]?.emit(RTVIEvent.TransportStateChanged, 'error');
    clients[0]?.emit(RTVIEvent.Disconnected);
    for (const [index, delay] of [1000, 2000, 4000].entries()) {
      clock.advance(delay - 1);
      await flush();
      expect(clients).toHaveLength(index + 1);
      clock.advance(1);
      await flush();
      expect(clients).toHaveLength(index + 2);
    }
    expect(events.filter((e) => e.type === 'connection' && e.status === 'reconnecting')).toEqual(
      [1, 2, 3].map((attempt) => ({
        type: 'connection',
        status: 'reconnecting',
        attempt,
        ...(attempt > 1 && { reason: 'unreachable' }),
      })),
    );
    expect(events.at(-1)).toEqual({ type: 'connection', status: 'failed', reason: 'unreachable' });
    clock.advance(20000);
    await flush();
    expect(clients).toHaveLength(4);
    expect(client.voice.connectionCount).toBe(1);
    setBehavior(() => {});
    await client.voice.reconnect();
    expect(client.voice.connectionCount).toBe(2);
    await client.disconnect();
  });
  it('intentional disconnect cancels retries and ignores old-client events', async () => {
    const { client, clients, clock, events, audio } = setup();
    await client.connect('s');
    clients[0]?.emit(RTVIEvent.Disconnected);
    await client.disconnect();
    clients[0]?.emit(RTVIEvent.BotReady);
    clients[0]?.emit(RTVIEvent.TrackStarted, new FakeTrack().asTrack());
    clock.advance(10000);
    await flush();
    expect(clients).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: 'connection', status: 'closed' });
    expect(audio.attach).not.toHaveBeenCalled();
  });
  it.each(['stop', 'timeout'])('defers spoken language reconnect until %s', async (trigger) => {
    const { client, clients, clock, events } = setup();
    await client.connect('s');
    clients[0]?.emit(RTVIEvent.BotStartedSpeaking);
    clients[0]?.emit(RTVIEvent.ServerMessage, { tassel: { kind: 'language', lang: 'es' } });
    clock.advance(2999);
    await flush();
    expect(clients).toHaveLength(1);
    if (trigger === 'stop') clients[0]?.emit(RTVIEvent.BotStoppedSpeaking);
    else clock.advance(1);
    await flush();
    expect(clients).toHaveLength(2);
    clock.advance(10000);
    await flush();
    expect(clients).toHaveLength(2);
    client.sendText('Hola');
    expect(events.at(-1)).toMatchObject({ type: 'caption', lang: 'es' });
    await client.disconnect();
  });
  it("the student's language switch reconnects in the session's new language", async () => {
    let lang: 'en' | 'es' | 'ko' = 'en';
    const { client, clients, events } = setup({ lang: () => lang });
    await client.connect('s');
    client.sendText('Hi');
    expect(events.at(-1)).toMatchObject({ type: 'caption', lang: 'en' });
    lang = 'ko';
    await client.voice.reconnect();
    expect(clients).toHaveLength(2);
    client.sendText('안녕하세요');
    expect(events.at(-1)).toMatchObject({ type: 'caption', lang: 'ko' });
    await client.disconnect();
  });
  it('a quiet language switch reconnects immediately and VAD/backchannel control ducking', async () => {
    const { client, clients, audio } = setup();
    await client.connect('s');
    clients[0]?.emit(RTVIEvent.BotStartedSpeaking);
    clients[0]?.emit(RTVIEvent.ServerMessage, { tassel: { kind: 'vad', speaking: true } });
    expect(audio.duck).toHaveBeenCalledWith(true);
    clients[0]?.emit(RTVIEvent.ServerMessage, { tassel: { kind: 'backchannel', text: 'uh-huh' } });
    expect(audio.duck).toHaveBeenLastCalledWith(false);
    clients[0]?.emit(RTVIEvent.BotStoppedSpeaking);
    clients[0]?.emit(RTVIEvent.ServerMessage, { tassel: { kind: 'language', lang: 'ko' } });
    await flush();
    expect(clients).toHaveLength(2);
    await client.disconnect();
  });
  it('ptt, sensitivity and metrics use the tassel envelope', async () => {
    const { client, clients, mic } = setup();
    await client.connect('s');
    client.voice.setTalking(false);
    expect(mic.sentLevel()).toBe(0);
    client.voice.setTalking(true);
    expect(mic.sentLevel()).toBeCloseTo(0.5);
    client.voice.setSensitivity('high');
    const metrics = {
      ttfa_ms: 42,
      barge_in_ms: null,
      yield_ms: null,
      sensitivity: 'high' as const,
    };
    client.voice.reportClientMetrics(metrics);
    expect(clients[0]?.sendClientMessage.mock.calls).toEqual([
      ['tassel', { kind: 'ptt', enabled: true, held: false }],
      ['tassel', { kind: 'ptt', enabled: true, held: true }],
      ['tassel', { kind: 'sensitivity', level: 'high' }],
      ['tassel', { kind: 'client-metrics', ...metrics }],
    ]);
    await client.disconnect();
  });
  it('reports an unconfigured offer even when the transport emits error before rejecting', async () => {
    const { client, clock, clients, events, setBehavior } = setup();
    setBehavior((pc) =>
      pc.connect.mockImplementation(async () => {
        pc.emit(RTVIEvent.TransportStateChanged, 'error');
        throw Object.assign(new Error('Offer refused'), { status: 503 });
      }),
    );
    await client.connect('s');
    expect(events.at(-1)).toEqual({
      type: 'connection',
      status: 'failed',
      reason: 'not-configured',
    });
    clock.advance(10000);
    await flush();
    expect(clients).toHaveLength(1);
    await client.disconnect();
  });
  it('a denied mic still connects and emits mic denied', async () => {
    const { client, media, events, mic } = setup();
    media.getUserMedia.mockRejectedValue(new DOMException('', 'NotAllowedError'));
    await client.connect('s');
    expect(events).toContainEqual({ type: 'mic', status: 'denied' });
    expect(events).toContainEqual({ type: 'connection', status: 'connected' });
    expect(client.voice.connectionCount).toBe(1);
    expect(mic.sentLevel()).toBe(0);
    await client.disconnect();
  });
  it('a disconnect during ICE lookup cannot create a late connection', async () => {
    const { client, getIceServers, clients, events } = setup();
    let resolve!: (ice: RTCIceServer[]) => void;
    getIceServers.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const opening = client.connect('s');
    await flush();
    await client.disconnect();
    resolve([]);
    await opening;
    expect(clients).toHaveLength(0);
    expect(events.at(-1)).toEqual({ type: 'connection', status: 'closed' });
  });
  it('nonfatal provider errors do not cause a reconnect loop', async () => {
    const { client, clients, clock } = setup();
    await client.connect('s');
    clients[0]?.emit(RTVIEvent.Error, { data: { fatal: false, error: 'recoverable' } });
    clock.advance(10000);
    await flush();
    expect(clients).toHaveLength(1);
    await client.disconnect();
  });
});
