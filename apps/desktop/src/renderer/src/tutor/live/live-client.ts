import {
  type BotOutputData,
  PipecatClient,
  RTVIEvent,
  type TransportState,
} from '@pipecat-ai/client-js';
import {
  SmallWebRTCTransport,
  type SmallWebRTCTransportConstructorOptions,
} from '@pipecat-ai/small-webrtc-transport';
import type { Lang } from '@tassel/shared/i18n';
import { type ClientEvent, type OfferRequestData, voiceOfferPath } from '@tassel/shared/voice';
import { systemClock } from '../clock';
import type { Clock, TutorClient, TutorEvent, VoiceControls } from '../types';
import { asTransportMediaManager, TasselMediaManager } from './media-manager';
import type { Mic, MicOptions } from './mic';
import { initialMapState, type MapState, mapRtvi, type RtviInput } from './rtvi-map';
import type { TutorAudio } from './tutor-audio';
import { VoiceConnectionError } from './voice-error';

export interface PipecatLike {
  connect(params: unknown): Promise<unknown>;
  disconnect(): Promise<void>;
  // SDK event signatures vary per event; the boundary handlers below narrow their payloads.
  // biome-ignore lint/suspicious/noExplicitAny: matches the SDK's event emitter overloads
  on(event: string, handler: (...args: any[]) => void): unknown;
  sendText(text: string, options?: object): Promise<string>;
  sendClientMessage(type: string, data?: unknown): void;
}
export interface LiveClientDeps {
  serverUrl: string;
  getToken(): Promise<string>;
  getIceServers(): Promise<RTCIceServer[]>;
  mic: Mic;
  audio: TutorAudio;
  micOptions(): MicOptions;
  offerData(): OfferRequestData;
  lang(): Lang;
  createPipecat?(transport: unknown): PipecatLike;
  backoffMs?: number[];
  clock?: Clock;
}
interface Connection {
  client: PipecatLike | null;
  retired: boolean;
  ready: boolean;
  micOpening?: Promise<void>;
  closing?: Promise<void>;
}

/** A session owns this client and the separate Mic/TutorAudio lifecycles. */
export class LiveTutorClient implements TutorClient {
  readonly voice: VoiceControls;
  private readonly clock: Clock;
  private readonly backoff: number[];
  private listeners = new Set<(event: TutorEvent) => void>();
  private state: MapState;
  private sessionId: string | null = null;
  private active = false;
  private generation = 0;
  private current: Connection | null = null;
  private retryTimer: unknown = null;
  private languageTimer: unknown = null;
  private retries = 0;
  private successes = 0;
  private talking = false;
  constructor(private readonly deps: LiveClientDeps) {
    this.clock = deps.clock ?? systemClock;
    this.backoff = deps.backoffMs ?? [1000, 2000, 4000];
    this.state = initialMapState(deps.lang());
    const self = this;
    this.voice = {
      setTalking(held) {
        self.talking = held;
        deps.mic.setGate(held);
        self.send({ kind: 'ptt', enabled: true, held });
      },
      setSensitivity(level) {
        self.send({ kind: 'sensitivity', level });
      },
      reportStageState(state) {
        self.send({ kind: 'stage-state', ...state });
      },
      reportClientMetrics(metrics) {
        self.send({ kind: 'client-metrics', ...metrics });
      },
      // Retry, or the student's own language switch: the session's language as it is now.
      reconnect: () => {
        this.state = initialMapState(deps.lang());
        return this.restart();
      },
      get connectionCount() {
        return self.successes;
      },
    };
  }
  async connect(sessionId: string) {
    this.sessionId = sessionId;
    this.state = initialMapState(this.deps.lang());
    await this.restart();
  }
  async disconnect() {
    this.active = false;
    ++this.generation;
    this.clearTimers();
    const old = this.current;
    this.current = null;
    await this.retire(old);
    this.deps.audio.duck(false);
    this.emit({ type: 'connection', status: 'closed' });
  }
  on(listener: (event: TutorEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  sendText(text: string) {
    this.emit({ type: 'caption', speaker: 'student', text, final: true, lang: this.state.lang });
    const connection = this.current;
    if (!connection?.client || connection.retired) return;
    void connection.client
      .sendText(text, { run_immediately: true, audio_response: true })
      .catch(() => this.failed(connection));
  }
  private async restart() {
    if (this.sessionId === null) return;
    this.active = true;
    const generation = ++this.generation;
    this.clearTimers();
    this.retries = 0;
    const old = this.current;
    this.current = null;
    this.emit({ type: 'connection', status: 'connecting' });
    await this.retire(old);
    if (!this.active || this.generation !== generation) return;
    this.deps.audio.duck(false);
    await this.openConnection(generation);
  }
  private async openConnection(generation: number) {
    const connection: Connection = { client: null, retired: false, ready: false };
    this.current = connection;
    this.state = initialMapState(this.state.lang);
    const valid = () =>
      this.active &&
      generation === this.generation &&
      this.current === connection &&
      !connection.retired;
    try {
      const iceServers = await this.deps.getIceServers();
      if (!valid()) return;
      const token = await this.deps.getToken();
      if (!valid()) return;
      const requestData = this.deps.offerData();
      this.deps.mic.setGate(!requestData.ptt || this.talking);
      const manager = new TasselMediaManager(this.deps.mic, this.deps.audio);
      const transport = new SmallWebRTCTransport({
        // The only nominal cast: see asTransportMediaManager's P2-R3 explanation.
        mediaManager: asTransportMediaManager(
          manager,
        ) as SmallWebRTCTransportConstructorOptions['mediaManager'],
        iceServers,
        waitForICEGathering: false,
      });
      const client =
        this.deps.createPipecat?.(transport) ??
        new PipecatClient({ transport, enableMic: true, enableCam: false });
      connection.client = client;
      this.bind(connection, valid);
      await client.connect({
        webrtcRequestParams: {
          endpoint:
            this.deps.serverUrl.replace(/\/$/u, '') + voiceOfferPath(this.sessionId as string),
          headers: new Headers({ Authorization: `Bearer ${token}` }),
          requestData,
          timeout: 15000,
        },
      });
      if (!valid()) return;
      ++this.successes;
      this.retries = 0;
      await connection.micOpening;
    } catch (error) {
      const unavailable =
        error instanceof VoiceConnectionError
          ? error.reason === 'not-configured'
          : typeof error === 'object' &&
            error !== null &&
            'status' in error &&
            (error.status === 503 || error.status === 404);
      // The transport emits its error state before rejecting connect. That callback
      // may already have retired this connection and scheduled a retry. Preserve
      // the HTTP refusal reason, but never let an old attempt change a new session.
      if (
        unavailable &&
        this.active &&
        generation === this.generation &&
        this.current === connection
      ) {
        this.clearTimers();
        void this.retire(connection);
        this.emit({ type: 'connection', status: 'failed', reason: 'not-configured' });
      } else if (valid()) this.failed(connection, 'unreachable');
    }
  }
  private bind(connection: Connection, valid: () => boolean) {
    const client = connection.client as PipecatLike;
    // biome-ignore lint/suspicious/noExplicitAny: each handler narrows the SDK payload below
    const on = (event: string, handler: (...args: any[]) => void) =>
      client.on(event, (...args) => {
        if (valid()) handler(...args);
      });
    const map = (input: RtviInput) => this.map(input);
    on(RTVIEvent.TransportStateChanged, (state: TransportState) => {
      if (state === 'error') this.failed(connection);
      else if (
        !connection.ready &&
        this.retries === 0 &&
        state !== 'disconnected' &&
        state !== 'disconnecting'
      )
        map({ kind: 'transport', state });
    });
    on(RTVIEvent.Disconnected, () => this.failed(connection));
    on(RTVIEvent.Error, (message: { data?: { fatal?: boolean }; fatal?: boolean }) => {
      // Nonfatal service errors do not imply transport loss; keep the ongoing session.
      if (message?.data?.fatal === false || message?.fatal === false) return;
      this.failed(connection);
    });
    on(RTVIEvent.BotReady, () => {
      if (connection.ready) return;
      connection.ready = true;
      map({ kind: 'bot-ready' });
      connection.micOpening = this.deps.mic
        .open(this.deps.micOptions())
        .then((status) => {
          if (valid()) this.emit({ type: 'mic', status });
        })
        .catch(() => {
          if (valid()) this.emit({ type: 'mic', status: 'unavailable' });
        });
    });
    on(RTVIEvent.UserStartedSpeaking, () => map({ kind: 'user-started' }));
    on(RTVIEvent.UserStoppedSpeaking, () => map({ kind: 'user-stopped' }));
    on(RTVIEvent.BotStartedSpeaking, () => map({ kind: 'bot-started' }));
    on(RTVIEvent.BotStoppedSpeaking, () => {
      map({ kind: 'bot-stopped' });
      if (this.languageTimer !== null) {
        this.clearLanguageTimer();
        void this.restart();
      }
    });
    const userText = (data: { text: string; final: boolean }) =>
      map({ kind: 'user-text', text: data.text, final: data.final });
    on(RTVIEvent.UserTranscript, userText);
    on(RTVIEvent.UserInput, userText);
    on(RTVIEvent.BotOutput, (data: BotOutputData) =>
      map({
        kind: 'bot-output',
        segmentId: String(data.segment_id ?? ''),
        status: data.spoken_status ?? null,
        text: data.text,
        accumulated: data.spoken_progress?.accumulated_text ?? null,
      }),
    );
    on(RTVIEvent.ServerMessage, (data: unknown) => map({ kind: 'server', data }));
    on(RTVIEvent.TrackStarted, (track: MediaStreamTrack, participant?: { local?: boolean }) => {
      if (track.kind === 'audio' && !participant?.local) this.deps.audio.attach(track);
    });
  }
  private map(input: RtviInput) {
    const result = mapRtvi(this.state, input);
    this.state = result.state;
    for (const event of result.events) this.emit(event);
    for (const effect of result.effects) {
      if (effect.type === 'duck') this.deps.audio.duck(effect.on);
      else if (effect.when === 'now') void this.restart();
      else if (this.languageTimer === null)
        this.languageTimer = this.clock.setTimeout(() => {
          this.languageTimer = null;
          void this.restart();
        }, 3000);
    }
  }
  private failed(connection: Connection, reason?: 'not-configured' | 'unreachable') {
    if (!this.active || this.current !== connection || connection.retired) return;
    const closing = this.retire(connection);
    this.clearLanguageTimer();
    this.deps.audio.duck(false);
    if (reason === 'not-configured' || this.retries >= this.backoff.length) {
      this.emit({ type: 'connection', status: 'failed', ...(reason && { reason }) });
      return;
    }
    const delay = this.backoff[this.retries] as number;
    const attempt = ++this.retries;
    const generation = this.generation;
    this.emit({ type: 'connection', status: 'reconnecting', attempt, ...(reason && { reason }) });
    this.retryTimer = this.clock.setTimeout(() => {
      this.retryTimer = null;
      void closing.then(() => {
        if (this.active && generation === this.generation) return this.openConnection(generation);
      });
    }, delay);
  }
  private retire(connection: Connection | null): Promise<void> {
    if (!connection) return Promise.resolve();
    if (connection.closing) return connection.closing;
    connection.retired = true;
    // SmallWebRTC emits error synchronously from stop(), before it closes/nulls its PC.
    // Mark retired now, but let that callback unwind before asking the SDK to disconnect.
    connection.closing = Promise.resolve()
      .then(() => connection.client?.disconnect())
      .catch(() => {});
    return connection.closing;
  }
  private send(event: ClientEvent) {
    const connection = this.current;
    if (connection?.client && !connection.retired)
      connection.client.sendClientMessage('tassel', event);
  }
  private emit(event: TutorEvent) {
    for (const listener of this.listeners) listener(event);
  }
  private clearLanguageTimer() {
    if (this.languageTimer !== null) this.clock.clearTimeout(this.languageTimer);
    this.languageTimer = null;
  }
  private clearTimers() {
    if (this.retryTimer !== null) this.clock.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.clearLanguageTimer();
  }
}
