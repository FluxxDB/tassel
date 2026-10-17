// The contract between the session screen and a tutor: P1's scripted fake, and P2's live voice
// tutor behind the same interface.
import type { BeatAction, BeatDoc } from '@tassel/shared/beats';
import type { Lang } from '@tassel/shared/i18n';
import type { StageMode, TutorState } from '../features/session/stage-store';

export type TutorEvent =
  | { type: 'state'; state: TutorState }
  | { type: 'caption'; speaker: 'student' | 'tutor'; text: string; lang: Lang; final: boolean }
  | { type: 'stage'; mode: StageMode }
  | { type: 'title'; title: string; subject: string | null }
  /** Ada's board, paper and stage actions, to apply now (P5). */
  | { type: 'actions'; actions: BeatAction[] }
  /** One line of hers with the actions it carries, applied as its words are heard (P5). */
  | { type: 'beat'; beat: BeatDoc }
  /**
   * A word of hers as it's heard (P2-R13), with where it sits when that's known: the beat's
   * `segment` and its index in that beat's words (P5).
   */
  | { type: 'word'; text: string; lang: Lang; segment?: string; index?: number };

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
