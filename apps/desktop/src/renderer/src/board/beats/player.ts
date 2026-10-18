// The beat player: it holds Ada's beat documents and fires each marker's action as its word is
// heard, so what she draws keeps time with what she says (P5-R4). Words find their document by
// segment and index, or else by text; a word that comes before its document waits for it. A new
// turn drops what an interrupted one hadn't said. Each marker fires once, only for a word she
// reached, in order (Review Focus 2).
import { type BeatDoc, parseBeatDoc } from '@tassel/shared/beats';
import type { Lang } from '@tassel/shared/i18n';
import { dispatchActions } from '../dispatch';
import { matchByText } from './match';

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

/** How long a word that matched nothing waits for its document. */
const BUFFER_MS = 8_000;

interface Playing {
  doc: BeatDoc;
  /** The ids of its markers that have fired. */
  fired: Set<string>;
  /** Its next word to be heard: every word before it has been. */
  next: number;
}

type WordListener = (m: { doc: BeatDoc; index: number; atMs: number }) => void;

/**
 * A player that sends each due marker's action to `dispatch`. `now` is the clock heard words'
 * `atMs` use (performance.now by default); `bufferMs` is how long an unmatched word waits.
 */
export function createBeatPlayer(deps: {
  dispatch(actions: readonly unknown[]): void;
  now?: () => number;
  bufferMs?: number;
}): BeatPlayer {
  const now = deps.now ?? (() => performance.now());
  const bufferMs = deps.bufferMs ?? BUFFER_MS;
  const listeners = new Set<WordListener>();
  /** By segment, in the order they loaded. */
  let playing = new Map<string, Playing>();
  /** Every turn seen, oldest first: the last is the turn Ada is in. */
  let turns: string[] = [];
  /** Words that matched nothing yet, in the order they were heard. */
  let buffer: HeardWord[] = [];

  const finished = (p: Playing) => p.next >= p.doc.words.length;

  /** Fires `p`'s unfired markers anchored at or before word `upTo`: by word, then in order. */
  const fireUpTo = (p: Playing, upTo: number) => {
    const due = p.doc.markers
      .filter((marker) => marker.word <= upTo && !p.fired.has(marker.id))
      .sort((a, b) => a.word - b.word);
    for (const marker of due) {
      p.fired.add(marker.id);
      try {
        deps.dispatch([marker.action]);
      } catch (error) {
        // A bug behind dispatch, not bad input: report it and go on with the rest.
        console.error(`[tassel] Tutor's marker ${marker.id} failed:`, error);
      }
    }
  };

  /** `p`'s word `index` was heard at `atMs`; a word already passed changes nothing. */
  const reach = (p: Playing, index: number, atMs: number) => {
    if (index < p.next) return;
    const last = p.doc.words.length - 1;
    const word = Math.min(index, last);
    // The last word also fires what's anchored after it.
    fireUpTo(p, word === last ? p.doc.words.length : word);
    p.next = word + 1;
    for (const listener of [...listeners]) {
      try {
        listener({ doc: p.doc, index: word, atMs });
      } catch (error) {
        console.error("[tassel] A listener to the tutor's words failed:", error);
      }
    }
  };

  /** Forgets words that have waited too long. */
  const expire = () => {
    const oldest = now() - bufferMs;
    buffer = buffer.filter((word) => word.atMs >= oldest);
  };

  /**
   * True when a document of `turn` can play. A new turn becomes Ada's and drops the documents
   * of the turns before it, with their unfired markers (barge-in); an older turn's is too late.
   */
  const enterTurn = (turn: string) => {
    if (turn === turns[turns.length - 1]) return true;
    if (turns.includes(turn)) return false;
    turns.push(turn);
    for (const [segment, p] of playing) {
      if (p.doc.turn !== turn) playing.delete(segment);
    }
    return true;
  };

  /** The document a word heard without its place belongs to: the turn's oldest unfinished. */
  const oldestUnfinished = () => {
    const turn = turns[turns.length - 1];
    for (const p of playing.values()) {
      if (p.doc.turn === turn && !finished(p)) return p;
    }
    return undefined;
  };

  /** A document that loads late takes the words it missed: of its segment, or else by text. */
  const catchUp = (p: Playing) => {
    expire();
    const placed = buffer.filter((word) => hasPlace(word) && word.segment === p.doc.segment);
    if (placed.length > 0) {
      buffer = buffer.filter((word) => !placed.includes(word));
      for (const word of placed) reach(p, word.index as number, word.atMs);
      return;
    }
    // A run of unplaced words matching its first words, noise before it skipped.
    const used = new Set<HeardWord>();
    for (const word of buffer) {
      if (hasPlace(word) || finished(p)) continue;
      const index = matchByText(p.doc.words, p.next, word.text);
      if (index === null) {
        if (used.size > 0) break;
        continue;
      }
      used.add(word);
      reach(p, index, word.atMs);
    }
    buffer = buffer.filter((word) => !used.has(word));
  };

  return {
    load(data) {
      const { doc, problems } = parseBeatDoc(data);
      if (problems.length > 0) {
        console.warn(`[tassel] ${doc ? 'Dropped part of' : 'Skipped'} a beat:`, problems);
      }
      if (!doc || !enterTurn(doc.turn)) return;
      const known = playing.get(doc.segment);
      if (known) {
        // The same beat again (with timing, say): what has fired never fires again.
        known.doc = doc;
        return;
      }
      const p: Playing = { doc, fired: new Set(), next: 0 };
      playing.set(doc.segment, p);
      // Nothing to hear: everything fires now.
      if (doc.words.length === 0) fireUpTo(p, 0);
      else catchUp(p);
    },
    hear(word) {
      expire();
      if (hasPlace(word)) {
        const p = playing.get(word.segment as string);
        if (p) reach(p, word.index as number, word.atMs);
        else buffer.push(word);
        return;
      }
      const p = oldestUnfinished();
      const index = p ? matchByText(p.doc.words, p.next, word.text) : null;
      if (p && index !== null) reach(p, index, word.atMs);
      else buffer.push(word);
    },
    reset() {
      playing = new Map();
      turns = [];
      buffer = [];
    },
    onWord(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** True when a word says where it sits: its document's segment and its index there. */
function hasPlace(word: HeardWord): boolean {
  return (
    word.segment !== undefined &&
    word.index !== undefined &&
    Number.isInteger(word.index) &&
    word.index >= 0
  );
}

/** The session's player, dispatching through dispatchActions. */
export const beatPlayer: BeatPlayer = createBeatPlayer({ dispatch: dispatchActions });
