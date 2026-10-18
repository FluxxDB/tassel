// The contract between the session screen and a tutor: P1's scripted fake, and P2's live voice
// tutor behind the same interface.
import type { BeatAction, BeatDoc } from '@tassel/shared/beats';
import type { Lang } from '@tassel/shared/i18n';
import type {
  BackchannelEvent,
  ChatMessage,
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
  /** `pinned`: the student asked for this view herself, so it's pinned like the Board control. */
  | { type: 'stage'; mode: StageMode; pinned?: true }
  | { type: 'title'; title: string; subject: string | null }
  /** Ada's board, paper and stage actions, to apply now (P5). */
  | { type: 'actions'; actions: BeatAction[] }
  /** One line of hers with the actions it carries, applied as its words are heard (P5). */
  | { type: 'beat'; beat: BeatDoc }
  /**
   * A word of hers as it's heard (P2-R13), with where it sits when that's known: the beat's
   * `segment` and its index in that beat's words (P5).
   */
  | { type: 'word'; text: string; lang: Lang; segment?: string; index?: number }
  // The live voice tutor's own events (P2).
  | { type: 'connection'; status: ConnectionStatus; attempt?: number; reason?: VoiceFailure }
  | { type: 'mic'; status: MicStatus }
  | { type: 'language'; lang: Lang }
  | { type: 'voice-debug'; event: VoiceDebugEvent }
  /** The server asks for her paper as it is now: her turn began. */
  | { type: 'paper-request' }
  | { type: 'screen-marks'; data: unknown }
  /** The server asks for the board as it is now, a PNG for Ada's board turn. */
  | { type: 'board-snapshot' }
  /** A line of the conversation for the chat sidebar; a tutor line updates in place by id. */
  | { type: 'message'; message: ChatMessage };

/** A message she typed in the chat: what goes to the server as a `student-message` event. */
export interface OutgoingMessage {
  clientId: string;
  text: string;
  attachmentIds: string[];
  /** False asks Ada for a text-only reply. */
  voice: boolean;
}

/** The live voice tutor's controls, beyond P1's TutorClient. */
export interface VoiceControls {
  setTutorName?(name: string): void;
  /** Push-to-talk: whether Space is held. */
  setTalking(held: boolean): void;
  setSensitivity(level: Sensitivity): void;
  reportClientMetrics(m: ClientMetrics): void;
  reportStageState?(state: import('@tassel/shared/voice').StageState): void;
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
  /**
   * The chat sidebar's message, which interrupts Ada like speaking over her does. False when it
   * couldn't go (no connection), so the sidebar offers a retry.
   */
  sendMessage?(message: OutgoingMessage): boolean;
  /** Immediately suppress the current response until a fresh screen turn is acknowledged. */
  interrupt?(epoch: number): void;
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
