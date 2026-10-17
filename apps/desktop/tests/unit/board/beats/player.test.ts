import type { BeatAction, BeatDoc } from '@tassel/shared/beats';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBeatPlayer, type HeardWord } from '../../../../src/renderer/src/board/beats/player';

/** An action the test can tell apart by its label: it fires as that label. */
const labelled = (label: string): BeatAction => ({ kind: 'paper.unmark', id: label });

/**
 * A live-style beat: untimed words from `line`, and markers as [word, label]. Its id is its
 * segment.
 */
function beat({
  segment,
  turn = 'turn-1',
  line = '',
  markers = [],
}: {
  segment: string;
  turn?: string;
  line?: string;
  markers?: Array<[word: number, label: string]>;
}): BeatDoc {
  return {
    version: 1,
    id: segment,
    turn,
    segment,
    lang: 'en',
    text: line,
    durationSec: null,
    shapeSet: 'rhubarb9',
    mouthCues: [],
    words: line ? line.split(' ').map((text) => ({ text, start: null, end: null })) : [],
    markers: markers.map(([word, label], i) => ({
      id: `${segment}.${i + 1}`,
      word,
      action: labelled(label),
    })),
  };
}

/** A player on a manual clock that records the labels it fires, in order. */
function setup(opts: { bufferMs?: number; dispatch?: (actions: readonly unknown[]) => void } = {}) {
  let now = 0;
  const fired: string[] = [];
  const dispatch = vi.fn(
    opts.dispatch ??
      ((actions: readonly unknown[]) => {
        for (const action of actions) fired.push((action as { id: string }).id);
      }),
  );
  const player = createBeatPlayer({
    dispatch,
    now: () => now,
    ...(opts.bufferMs !== undefined && { bufferMs: opts.bufferMs }),
  });
  const hear = (text: string, where: Pick<HeardWord, 'segment' | 'index'> = {}) =>
    player.hear({ text, lang: 'en', atMs: now, ...where });
  const advance = (ms: number) => {
    now += ms;
  };
  return { player, fired, dispatch, hear, advance };
}

afterEach(() => vi.restoreAllMocks());

describe('the beat player', () => {
  it('a document with no words fires all its markers on load (rule 1)', () => {
    const { player, fired } = setup();
    player.load(
      beat({
        segment: 's',
        markers: [
          [0, 'stage'],
          [0, 'reveal'],
        ],
      }),
    );
    expect(fired).toEqual(['stage', 'reveal']);
  });

  it('a word with its segment and index fires the markers up to it; the last word fires the end markers (rule 2)', () => {
    const { player, fired, hear } = setup();
    player.load(
      beat({
        segment: 's',
        line: 'one two three',
        markers: [
          [0, 'a'],
          [3, 'end'],
          [1, 'b'],
          [2, 'c'],
        ],
      }),
    );
    expect(fired).toEqual([]);
    hear('two', { segment: 's', index: 1 });
    expect(fired).toEqual(['a', 'b']);
    hear('three', { segment: 's', index: 2 });
    expect(fired).toEqual(['a', 'b', 'c', 'end']);
  });

  it('keys documents by segment, so each word reaches its own (rule 2)', () => {
    const { player, fired, hear } = setup();
    player.load(beat({ segment: 'seg-1', line: 'a b', markers: [[1, 'x']] }));
    player.load(beat({ segment: 'seg-2', line: 'c d', markers: [[0, 'y']] }));
    hear('c', { segment: 'seg-2', index: 0 });
    hear('b', { segment: 'seg-1', index: 1 });
    expect(fired).toEqual(['y', 'x']);
  });

  it('a word with no segment is matched by its text, skipping up to 3 words (rule 3)', () => {
    const { player, fired, hear } = setup();
    player.load(
      beat({
        segment: 's',
        line: "Let's walk 1010 through your DFA, one symbol at a time.",
        markers: [
          [2, 'number'],
          [6, 'freeze'],
          [11, 'end'],
        ],
      }),
    );
    hear('Let’s');
    hear('walk');
    expect(fired).toEqual([]);
    hear('1010');
    expect(fired).toEqual(['number']);
    // "through" never arrives: "your" still matches, one word on.
    hear('your');
    expect(fired).toEqual(['number']);
    // "DFA," and "one" missed: "symbol" fires the freeze anchored to "one".
    hear('symbol');
    expect(fired).toEqual(['number', 'freeze']);
    hear('time.');
    expect(fired).toEqual(['number', 'freeze', 'end']);
  });

  it('a repeated word ("q zero … q zero") fires each marker once, at its own occurrence', () => {
    const { player, fired, hear } = setup();
    player.load(
      beat({
        segment: 's',
        line: 'From q zero we stay on q zero.',
        markers: [
          [2, 'first'],
          [7, 'second'],
        ],
      }),
    );
    for (const word of ['From', 'q', 'zero']) hear(word);
    expect(fired).toEqual(['first']);
    // The same word again at once: merged or repeated, it fires nothing.
    hear('zero');
    for (const word of ['we', 'stay', 'on', 'q']) hear(word);
    expect(fired).toEqual(['first']);
    hear('zero');
    expect(fired).toEqual(['first', 'second']);
  });

  it('matches text against the oldest unfinished document of the newest turn (rule 3)', () => {
    const { player, fired, hear } = setup();
    player.load(beat({ segment: 'a', line: 'one two', markers: [[1, 'a2']] }));
    player.load(beat({ segment: 'b', line: 'three four', markers: [[0, 'b1']] }));
    // Not the oldest unfinished one's: no match.
    hear('three');
    expect(fired).toEqual([]);
    hear('one');
    hear('two');
    hear('three');
    expect(fired).toEqual(['a2', 'b1']);
  });

  it('a late document fires the markers of words already heard, at once and in order (rule 4)', () => {
    const { player, fired, hear, advance } = setup();
    hear('one', { segment: 's', index: 0 });
    advance(400);
    hear('two', { segment: 's', index: 1 });
    expect(fired).toEqual([]);
    player.load(
      beat({
        segment: 's',
        line: 'one two three',
        markers: [
          [1, 'b'],
          [0, 'a'],
          [2, 'c'],
        ],
      }),
    );
    expect(fired).toEqual(['a', 'b']);
    hear('three', { segment: 's', index: 2 });
    expect(fired).toEqual(['a', 'b', 'c']);
  });

  it('a late document without segments catches up on a run matching its first words (rule 4)', () => {
    const { player, fired, hear } = setup();
    hear('so');
    hear("Let's");
    hear('walk');
    player.load(
      beat({
        segment: 's',
        line: "Let's walk 1010",
        markers: [
          [1, 'walk'],
          [2, 'number'],
        ],
      }),
    );
    expect(fired).toEqual(['walk']);
    hear('1010');
    expect(fired).toEqual(['walk', 'number']);
  });

  it('keeps a word that matches nothing for 8 s, then forgets it (rule 4)', () => {
    const late = setup();
    late.hear('one', { segment: 's', index: 0 });
    late.advance(8_001);
    late.player.load(beat({ segment: 's', line: 'one two', markers: [[0, 'a']] }));
    expect(late.fired).toEqual([]);

    const inTime = setup();
    inTime.hear('one', { segment: 's', index: 0 });
    inTime.advance(7_999);
    inTime.player.load(beat({ segment: 's', line: 'one two', markers: [[0, 'a']] }));
    expect(inTime.fired).toEqual(['a']);

    const short = setup({ bufferMs: 100 });
    short.hear('one', { segment: 's', index: 0 });
    short.advance(101);
    short.player.load(beat({ segment: 's', line: 'one two', markers: [[0, 'a']] }));
    expect(short.fired).toEqual([]);
  });

  it("a new turn drops the old turn's unfired markers (rule 5)", () => {
    const { player, fired, hear } = setup();
    player.load(
      beat({ segment: 'a', turn: 'turn-1', line: 'one two three', markers: [[2, 'old']] }),
    );
    hear('one', { segment: 'a', index: 0 });
    // Barge-in: she interrupts, and Ada's answer is a new turn.
    player.load(beat({ segment: 'b', turn: 'turn-2', line: 'four', markers: [[0, 'new']] }));
    hear('three', { segment: 'a', index: 2 });
    expect(fired).toEqual([]);
    hear('four', { segment: 'b', index: 0 });
    expect(fired).toEqual(['new']);
    // A document of the old turn that arrives late is dropped too, wordless or not.
    player.load(beat({ segment: 'c', turn: 'turn-1', line: 'five', markers: [[0, 'stale']] }));
    player.load(beat({ segment: 'd', turn: 'turn-1', markers: [[0, 'stale-now']] }));
    hear('five', { segment: 'c', index: 0 });
    expect(fired).toEqual(['new']);
  });

  it('a new turn takes the text matching too (rule 5)', () => {
    const { player, fired, hear } = setup();
    player.load(beat({ segment: 'a', turn: 'turn-1', line: 'one two', markers: [[1, 'old']] }));
    player.load(beat({ segment: 'b', turn: 'turn-2', line: 'one two', markers: [[1, 'new']] }));
    hear('one');
    hear('two');
    expect(fired).toEqual(['new']);
  });

  it('a duplicate word event never fires a marker twice (rule 6)', () => {
    const { player, fired, hear } = setup();
    player.load(beat({ segment: 's', line: 'one two three', markers: [[1, 'b']] }));
    hear('two', { segment: 's', index: 1 });
    hear('two', { segment: 's', index: 1 });
    // Late and out of order: already passed.
    hear('one', { segment: 's', index: 0 });
    expect(fired).toEqual(['b']);
    // The same document loaded again never fires them again either.
    player.load(beat({ segment: 's', line: 'one two three', markers: [[1, 'b']] }));
    hear('three', { segment: 's', index: 2 });
    expect(fired).toEqual(['b']);
  });

  it('markers sharing a word fire in array order (rule 6)', () => {
    const { player, fired, hear } = setup();
    player.load(
      beat({
        segment: 's',
        line: 'one two',
        markers: [
          [1, 'x'],
          [0, 'w'],
          [1, 'y'],
        ],
      }),
    );
    hear('two', { segment: 's', index: 1 });
    expect(fired).toEqual(['w', 'x', 'y']);
  });

  it('an invalid marker is dropped and the next still fires (Review Focus 5)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { player, fired, hear } = setup();
    const doc = beat({ segment: 's', line: 'one two', markers: [[1, 'good']] });
    player.load({
      ...doc,
      markers: [{ id: 's.0', word: 1, action: { kind: 'board.erase', item: 'x' } }, ...doc.markers],
    });
    expect(warn).toHaveBeenCalledTimes(1);
    hear('two', { segment: 's', index: 1 });
    expect(fired).toEqual(['good']);
  });

  it('an action that dispatch rejects never stops the rest (rule 6)', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fired: string[] = [];
    const { player } = setup({
      dispatch: (actions) => {
        const { id } = actions[0] as { id: string };
        if (id === 'broken') throw new Error('the sink broke');
        fired.push(id);
      },
    });
    player.load(
      beat({
        segment: 's',
        markers: [
          [0, 'before'],
          [0, 'broken'],
          [0, 'after'],
        ],
      }),
    );
    expect(fired).toEqual(['before', 'after']);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('skips a document that does not parse, with one warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { player, dispatch } = setup();
    player.load({ ...beat({ segment: 's', markers: [[0, 'a']] }), version: 2 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('tells onWord every matched word (rule 7)', () => {
    const { player, hear, advance } = setup();
    const doc = beat({ segment: 's', line: 'one two three' });
    const seen: Array<[string, number, number]> = [];
    const off = player.onWord(({ doc: d, index, atMs }) => seen.push([d.id, index, atMs]));
    player.load(doc);
    advance(100);
    hear('one');
    advance(100);
    hear('zebra');
    hear('three', { segment: 's', index: 2 });
    expect(seen).toEqual([
      ['s', 0, 100],
      ['s', 2, 200],
    ]);
    off();
    player.load(beat({ segment: 't', line: 'four' }));
    hear('four', { segment: 't', index: 0 });
    expect(seen).toHaveLength(2);
  });

  it('tells onWord about the words a late document catches up on (rule 7)', () => {
    const { player, hear } = setup();
    const seen: number[] = [];
    player.onWord(({ index }) => seen.push(index));
    hear('one', { segment: 's', index: 0 });
    player.load(beat({ segment: 's', line: 'one two' }));
    expect(seen).toEqual([0]);
  });

  it('reset empties the documents and the buffer (rule 7)', () => {
    const { player, fired, hear } = setup();
    player.load(beat({ segment: 's', line: 'one two', markers: [[1, 'a']] }));
    hear('one', { segment: 'later', index: 0 });
    player.reset();
    hear('two', { segment: 's', index: 1 });
    player.load(beat({ segment: 'later', line: 'one', markers: [[0, 'b']] }));
    expect(fired).toEqual([]);
    // After a reset, any turn is new again.
    player.load(beat({ segment: 'next', turn: 'turn-0', markers: [[0, 'c']] }));
    expect(fired).toEqual(['c']);
  });
});
