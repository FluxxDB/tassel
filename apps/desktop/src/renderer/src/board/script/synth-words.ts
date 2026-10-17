// Word timings for a fake voice: steady enough to time Ada's marks and lip-sync against, with no
// audio. A word lasts 0.09 s plus 0.055 s a letter; a comma pauses longer than a space, and the
// end of a sentence longer still.
import type { BeatWord } from '@tassel/shared/beats';

const WORD_BASE = 0.09;
const PER_LETTER = 0.055;
const GAP = 0.06;
/** After `,`, `;` or `:`. */
const CLAUSE_GAP = 0.18;
/** After `.`, `?` or `!`. */
const SENTENCE_GAP = 0.32;

/** `text`'s words, as split on whitespace, timed in seconds to the millisecond. */
export function synthWords(text: string): { words: BeatWord[]; durationSec: number } {
  const words: BeatWord[] = [];
  let start = 0;
  for (const word of text.split(/\s+/u).filter(Boolean)) {
    const end = ms(start + WORD_BASE + PER_LETTER * letters(word));
    words.push({ text: word, start, end });
    start = ms(end + gapAfter(word));
  }
  return { words, durationSec: words.length > 0 ? (words[words.length - 1].end as number) : 0 };
}

/** Its letters and digits, in any script; at least 1. */
function letters(word: string): number {
  return Math.max(1, word.match(/[\p{L}\p{N}]/gu)?.length ?? 0);
}

function gapAfter(word: string): number {
  if (/[.?!]$/u.test(word)) return SENTENCE_GAP;
  if (/[,;:]$/u.test(word)) return CLAUSE_GAP;
  return GAP;
}

/** Rounded to the millisecond. */
function ms(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}
