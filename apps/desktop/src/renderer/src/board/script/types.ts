// Fake tutor scripts as they're written: Ada's turns as lines, with `{#id}` anchors that time her
// actions to her words. compileScript turns one into the FakeScript the fake tutor plays.
import type { BeatAction } from '@tassel/shared/beats';
import type { Lang } from '@tassel/shared/i18n';
import type { TutorState } from '../../features/session/stage-store';
import type { TutorEvent } from '../../tutor/types';

/** One line of Ada's. Each `{#id}` in it anchors `actions[id]` to the word that follows. */
export interface AuthoredBeat {
  say: string;
  actions?: Record<string, BeatAction | BeatAction[]>;
}

export type AuthoredStep =
  /** Passes through as it is. */
  | { at: number; event: TutorEvent }
  /** An `actions` event: applied at once. */
  | { at: number; do: BeatAction[] }
  /** Ada speaks, beat by beat, then goes to `then` (listening by default). */
  | { at: number; turn: AuthoredBeat[]; then?: TutorState };

/** `at` is ms after connect, at speed 1. */
export interface AuthoredScript {
  lang: Lang;
  steps: AuthoredStep[];
}
