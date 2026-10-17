// The beat player: it holds Ada's beat documents and fires each marker's action as its word is
// heard, so what she draws keeps time with what she says. Task 1's stub, with its final
// interface: `load` fires every marker at once. Task 8 gates them on the words.
import { type BeatDoc, parseBeatDoc } from '@tassel/shared/beats';
import type { Lang } from '@tassel/shared/i18n';
import { dispatchActions } from '../dispatch';

/** A word of Ada's as it's heard: from P2's `word` events, or the fake tutor's. */
export interface HeardWord {
  text: string;
  lang: Lang;
  /** The beat document's segment, when the word event says which. */
  segment?: string;
  /** The word's index in that document's words. */
  index?: number;
  /** When it was heard, on performance.now()'s clock. */
  atMs: number;
}

export interface BeatPlayer {
  /** Takes a beat document (checked with parseBeatDoc; a bad one is dropped with a warning). */
  load(data: unknown): void;
  hear(word: HeardWord): void;
  /** Forgets every document and buffered word. */
  reset(): void;
  /** Told each word that matched a document; returns the unsubscribe. */
  onWord(listener: (m: { doc: BeatDoc; index: number; atMs: number }) => void): () => void;
}

export function createBeatPlayer(deps: {
  dispatch(actions: readonly unknown[]): void;
  now?: () => number;
  bufferMs?: number;
}): BeatPlayer {
  const listeners = new Set<(m: { doc: BeatDoc; index: number; atMs: number }) => void>();
  return {
    load(data) {
      const { doc, problems } = parseBeatDoc(data);
      if (problems.length > 0) {
        console.warn(`[tassel] ${doc ? 'Dropped part of' : 'Skipped'} a beat:`, problems);
      }
      if (!doc || doc.markers.length === 0) return;
      // No word timing yet: every marker now, in the order its words come (a stable sort).
      const markers = [...doc.markers].sort((a, b) => a.word - b.word);
      deps.dispatch(markers.map((marker) => marker.action));
    },
    hear() {},
    reset() {},
    onWord(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The session's player, dispatching through dispatchActions. */
export const beatPlayer: BeatPlayer = createBeatPlayer({ dispatch: dispatchActions });
