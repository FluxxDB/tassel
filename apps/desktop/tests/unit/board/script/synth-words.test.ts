import fixtures from '@tassel/shared/beats/fixtures.json';
import { describe, expect, it } from 'vitest';
import { synthWords } from '../../../../src/renderer/src/board/script/synth-words';

describe('synthWords', () => {
  it("times 'Try 1010.': a word lasts 0.09 + 0.055 × its letters, then a 0.06 s gap", () => {
    expect(synthWords('Try 1010.')).toEqual({
      words: [
        { text: 'Try', start: 0, end: 0.255 },
        { text: '1010.', start: 0.315, end: 0.625 },
      ],
      durationSec: 0.625,
    });
  });

  it("puts 'then' 0.18 s after 'q0,' ends", () => {
    const { words } = synthWords('q0, then');
    expect(words.map((w) => w.text)).toEqual(['q0,', 'then']);
    expect(words[0]).toEqual({ text: 'q0,', start: 0, end: 0.2 });
    expect((words[1].start as number) - (words[0].end as number)).toBeCloseTo(0.18, 9);
  });

  it('pauses 0.18 s after ; and :, and 0.32 s after . ? and !', () => {
    const gaps = (line: string) => {
      const { words } = synthWords(line);
      return words
        .slice(1)
        .map((w, i) => Number(((w.start as number) - (words[i].end as number)).toFixed(3)));
    };
    expect(gaps('a; b: c d')).toEqual([0.18, 0.18, 0.06]);
    expect(gaps('Done. Why? Yes! no')).toEqual([0.32, 0.32, 0.32]);
  });

  it('counts letters and digits in any script, and at least one', () => {
    const length = (word: string) => {
      const [only] = synthWords(word).words;
      return Number(((only.end as number) - (only.start as number)).toFixed(3));
    };
    // "Let's": four letters; the apostrophe doesn't count.
    expect(length("Let's")).toBe(0.31);
    expect(length('상태를,')).toBe(0.255);
    expect(length('—')).toBe(0.145);
  });

  it('rounds every time to the millisecond', () => {
    const { words, durationSec } = synthWords('one two three four five six seven eight nine ten');
    for (const { start, end } of words) {
      expect(Math.round((start as number) * 1000) / 1000).toBe(start);
      expect(Math.round((end as number) * 1000) / 1000).toBe(end);
    }
    expect(durationSec).toBe(words[words.length - 1].end);
  });

  it("reproduces the shared fixture's fake-style beat", () => {
    const [fake] = fixtures.beats;
    expect(synthWords(fake.text)).toEqual({ words: fake.words, durationSec: fake.durationSec });
  });

  it('gives an empty line no words and no duration', () => {
    expect(synthWords('')).toEqual({ words: [], durationSec: 0 });
    expect(synthWords('   ')).toEqual({ words: [], durationSec: 0 });
  });
});
