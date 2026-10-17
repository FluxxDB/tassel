import type { BeatWord } from '@tassel/shared/beats';
import { describe, expect, it } from 'vitest';
import { matchByText } from '../../../../src/renderer/src/board/beats/match';

/** A line's words, untimed, as a live beat carries them. */
const words = (line: string): BeatWord[] =>
  line.split(' ').map((text) => ({ text, start: null, end: null }));

describe('matchByText', () => {
  const EN = words("Let's walk 1010 through your DFA, one symbol at a time.");

  it('matches the next word exactly, as a normalized word', () => {
    expect(matchByText(EN, 0, "Let's")).toBe(0);
    // Curly apostrophes, case and punctuation don't matter.
    expect(matchByText(EN, 0, 'let’s')).toBe(0);
    expect(matchByText(EN, 5, 'dfa')).toBe(5);
    expect(matchByText(EN, 10, 'Time')).toBe(10);
  });

  it('skips up to 3 words ahead, and no further', () => {
    expect(matchByText(EN, 0, 'through')).toBe(3);
    expect(matchByText(EN, 0, 'your')).toBeNull();
    expect(matchByText(EN, 1, 'your')).toBe(4);
    // A narrower lookahead.
    expect(matchByText(EN, 0, 'through', 2)).toBeNull();
    expect(matchByText(EN, 0, '1010', 2)).toBe(2);
  });

  it('finds nothing for a word that is not ahead', () => {
    expect(matchByText(EN, 0, 'zebra')).toBeNull();
    // Behind `next`, even when it's there.
    expect(matchByText(EN, 3, 'walk')).toBeNull();
    expect(matchByText(EN, 11, 'time')).toBeNull();
    // Nothing comparable at all.
    expect(matchByText(EN, 0, '—')).toBeNull();
  });

  it('matches the first occurrence ahead of a repeated word', () => {
    const repeated = words('From q zero we stay on q zero.');
    expect(matchByText(repeated, 0, 'zero')).toBe(2);
    expect(matchByText(repeated, 3, 'zero')).toBeNull();
    expect(matchByText(repeated, 4, 'zero')).toBe(7);
  });

  it('matches Spanish, with é composed or decomposed', () => {
    const es = words('Él está en q cero.');
    expect(matchByText(es, 0, 'Él')).toBe(0);
    expect(matchByText(es, 0, 'Él')).toBe(0);
    expect(matchByText(es, 1, 'está')).toBe(1);
    expect(matchByText(es, 1, 'cero')).toBe(4);
    expect(matchByText(es, 1, 'uno')).toBeNull();
  });

  it('matches Korean words, particles included', () => {
    const ko = words('이 루프 때문에 1010이 통과해요.');
    expect(matchByText(ko, 0, '이')).toBe(0);
    expect(matchByText(ko, 1, '1010이')).toBe(3);
    expect(matchByText(ko, 1, '통과해요')).toBe(4);
    // The bare number is a different word from "1010이".
    expect(matchByText(ko, 1, '1010')).toBeNull();
  });
});
