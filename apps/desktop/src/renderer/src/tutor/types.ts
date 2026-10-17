// The contract between the session screen and a tutor: P1's scripted fake, and P2's live voice
// tutor behind the same interface.
import type { Lang } from '@tassel/shared/i18n';
import type {
  BackchannelEvent,
  ClientMetrics,
  RouteEvent,
  Sensitivity,
  TurnMetricsEvent,
} from '@tassel/shared/voice';
import type { StageMode, TutorState } from '../features/session/stage-store';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed';
export type VoiceFailure = 'not-configured' | 'unreachable';
export type MicStatus = 'off' | 'live' | 'denied' | 'unavailable';
/** What the latency HUD shows: the server's route, timings and backchannels; the app's timings. */
export type VoiceDebugEvent =
  | RouteEvent
  | TurnMetricsEvent
  | BackchannelEvent
  | ({ kind: 'client-metrics' } & ClientMetrics);

export type TutorEvent =
  | { type: 'state'; state: TutorState }
  | { type: 'caption'; speaker: 'student' | 'tutor'; text: string; lang: Lang; final: boolean }
  | { type: 'stage'; mode: StageMode }
  | { type: 'title'; title: string; subject: string | null }
  // The live voice tutor's own events (P2).
  | { type: 'connection'; status: ConnectionStatus; attempt?: number; reason?: VoiceFailure }
  | { type: 'mic'; status: MicStatus }
  | { type: 'language'; lang: Lang }
  // One per word as Ada says it, in step with her playback; for P5 and P6.
  | { type: 'word'; text: string; lang: Lang }
  | { type: 'voice-debug'; event: VoiceDebugEvent };

/** The live voice tutor's controls, beyond P1's TutorClient. */
export interface VoiceControls {
  /** Push-to-talk: whether Space is held. */
  setTalking(held: boolean): void;
  setSensitivity(level: Sensitivity): void;
  reportClientMetrics(m: ClientMetrics): void;
  /** Connects afresh, with the retry count reset: Retry after a failure, or a language switch. */
  reconnect(): Promise<void>;
  /** How many times this client has connected successfully, reconnects included. */
  readonly connectionCount: number;
}

export interface TutorClient {
  connect(sessionId: string): Promise<void>;
  disconnect(): Promise<void>;
  /** Subscribes to the tutor's events; returns the unsubscribe. */
  on(listener: (e: TutorEvent) => void): () => void;
  /** The dev/fake path: a typed student line. */
  sendText(text: string): void;
  /** Only the live voice tutor has these. */
  readonly voice?: VoiceControls;
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

/** A scripted session: each event `at` ms after connect. */
export interface FakeScript {
  steps: Array<{ at: number; event: TutorEvent }>;
}
