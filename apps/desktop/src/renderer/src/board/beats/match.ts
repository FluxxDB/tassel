// A heard word against a beat's words, by text: for live words that don't say where they sit.
// Words compare as normalizeWord makes them (composed, lower case, letters and digits), so a
// curly apostrophe, a capital or a comma never stops a match, in English, Spanish or Korean.
import { type BeatWord, normalizeWord } from '@tassel/shared/beats';

/** How many words a heard word may skip: words missed in between, or merged into one. */
const LOOKAHEAD = 3;

/**
 * The index of the first of `words[next]` … `words[next + lookahead]` that reads as `heard`, or
 * null. It never looks behind `next`, so a word said twice matches each time at its own place.
 */
export function matchByText(
  words: BeatWord[],
  next: number,
  heard: string,
  lookahead: number = LOOKAHEAD,
): number | null {
  const target = normalizeWord(heard);
  if (!target) return null;
  const last = Math.min(words.length - 1, next + lookahead);
  for (let i = Math.max(0, next); i <= last; i += 1) {
    if (normalizeWord(words[i].text) === target) return i;
  }
  return null;
}
