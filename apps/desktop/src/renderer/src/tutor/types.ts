// The contract between the session screen and a tutor: P1's scripted fake, and P2's live voice
// tutor behind the same interface.
import type { Lang } from '@tassel/shared/i18n';
import type { StageMode, TutorState } from '../features/session/stage-store';

export type TutorEvent =
  | { type: 'state'; state: TutorState }
  | { type: 'caption'; speaker: 'student' | 'tutor'; text: string; lang: Lang; final: boolean }
  | { type: 'stage'; mode: StageMode }
  | { type: 'title'; title: string; subject: string | null };

export interface TutorClient {
  connect(sessionId: string): Promise<void>;
  disconnect(): Promise<void>;
  /** Subscribes to the tutor's events; returns the unsubscribe. */
  on(listener: (e: TutorEvent) => void): () => void;
  /** The dev/fake path: a typed student line. */
  sendText(text: string): void;
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
