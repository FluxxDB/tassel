// A beat: one line of Ada's speech with what she does as she says it. Its markers fire as their
// words are heard, so her board and her marks on the paper keep time with her voice. The cue
// document is Rhubarb-compatible (`mouthCues`), so its wire keys are camelCase.
import { type Lang, SUPPORTED_LANGS } from '../i18n';
import { type BeatAction, parseAction } from './actions';

export const MOUTH_SHAPES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X'] as const;
export type MouthShape = (typeof MOUTH_SHAPES)[number];

/** In seconds from the beat's first audio. */
export interface MouthCue {
  start: number;
  end: number;
  value: MouthShape;
}

/** `start` and `end` are null until the timing is known (P5-R4). */
export interface BeatWord {
  text: string;
  start: number | null;
  end: number | null;
}

/** Fires as `words[word]` is heard; `word === words.length` fires with the last word. */
export interface BeatMarker {
  id: string;
  word: number;
  action: BeatAction;
}

export interface BeatDoc {
  version: 1;
  id: string;
  turn: string;
  segment: string;
  lang: Lang;
  /** The line as captions show it. */
  text: string;
  durationSec: number | null;
  shapeSet: 'rhubarb9';
  mouthCues: MouthCue[];
  words: BeatWord[];
  markers: BeatMarker[];
}

const LIMITS = { words: 80, markers: 40, id: 64, text: 400 } as const;
const DOC_FIELDS = [
  'version',
  'id',
  'turn',
  'segment',
  'lang',
  'text',
  'durationSec',
  'shapeSet',
  'mouthCues',
  'words',
  'markers',
];
/** How far apart, in seconds, one cue's end and the next one's start may be. */
const CUE_TOLERANCE = 1e-6;

/**
 * The beat document in `data`, checked field by field. A bad marker is dropped and reported, and
 * the rest of the beat kept; anything else rejects the document (`doc: null`). The problems:
 * - the document: `bad document`, `unknown field <key>`, `bad version`, `bad id`, `bad turn`,
 *   `bad segment` (each 1–64 characters), `bad lang`, `bad text`, `text too long` (over 400),
 *   `bad durationSec` (null, or 0 and up), `bad shapeSet`;
 * - its cues: `bad mouthCues`, `bad mouthCue <i>`, `mouthCues must start at 0 and end on X`,
 *   `mouthCues have a gap at 0.20` (where the earlier cue ends), `mouthCues need durationSec`;
 * - its words: `bad words`, `too many words` (over 80), `bad word <i>` (start and end both null,
 *   or both set with start ≤ end), `words out of order at <i>` (a start before the last one);
 * - its markers: `bad markers`, `too many markers` (over 40); and per marker, dropped:
 *   `bad marker <i>`, `duplicate marker <id>`, `marker <id> anchors to word <w> of <n>`,
 *   `marker <id> has an invalid action`.
 */
export function parseBeatDoc(data: unknown): { doc: BeatDoc | null; problems: string[] } {
  if (!isFields(data)) return { doc: null, problems: ['bad document'] };
  const problems: string[] = [];
  let rejected = false;
  const reject = (problem: string) => {
    problems.push(problem);
    rejected = true;
  };

  for (const key of Object.keys(data)) {
    if (!DOC_FIELDS.includes(key)) reject(`unknown field ${key}`);
  }
  if (data.version !== 1) reject('bad version');
  for (const key of ['id', 'turn', 'segment'] as const) {
    if (!isId(data[key])) reject(`bad ${key}`);
  }
  if (!SUPPORTED_LANGS.includes(data.lang as Lang)) reject('bad lang');
  if (typeof data.text !== 'string') reject('bad text');
  else if (codePoints(data.text) > LIMITS.text) reject('text too long');
  const durationSec = data.durationSec;
  const durationOk = durationSec === null || (isNumber(durationSec) && durationSec >= 0);
  if (!durationOk) reject('bad durationSec');
  if (data.shapeSet !== 'rhubarb9') reject('bad shapeSet');

  const mouthCues = readCues(data.mouthCues, durationSec, reject);
  const words = readWords(data.words, reject);
  const markers = readMarkers(data.markers, words?.length ?? null, reject, (problem) =>
    problems.push(problem),
  );

  if (rejected || !mouthCues || !words || !markers) return { doc: null, problems };
  const doc: BeatDoc = {
    version: 1,
    id: data.id as string,
    turn: data.turn as string,
    segment: data.segment as string,
    lang: data.lang as Lang,
    text: data.text as string,
    durationSec: durationSec as number | null,
    shapeSet: 'rhubarb9',
    mouthCues,
    words,
    markers,
  };
  return { doc, problems };
}

/** A rest (X) for the whole beat: the cues for a voice with no mouth timing. */
export function restCues(durationSec: number): MouthCue[] {
  return [{ start: 0, end: durationSec, value: 'X' }];
}

/**
 * A word as heard and as written, made comparable: composed (NFC), in lower case, with only
 * letters, digits and inner apostrophes. A curly apostrophe counts as a straight one.
 */
export function normalizeWord(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[\u2018\u2019\u02BC]/gu, "'")
    .replace(/[^\p{L}\p{M}\p{N}']/gu, '')
    .replace(/^'+|'+$/gu, '');
}

type Fields = Record<string, unknown>;

function isFields(data: unknown): data is Fields {
  return typeof data === 'object' && data !== null && !Array.isArray(data);
}

/** `data` has exactly `keys`. */
function hasExactly(data: Fields, keys: readonly string[]): boolean {
  const own = Object.keys(data);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

function isNumber(value: unknown): value is number {
  return Number.isFinite(value);
}

function codePoints(text: string): number {
  return [...text].length;
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && codePoints(value) <= LIMITS.id;
}

function readCues(
  value: unknown,
  durationSec: unknown,
  reject: (problem: string) => void,
): MouthCue[] | null {
  if (!Array.isArray(value)) {
    reject('bad mouthCues');
    return null;
  }
  const cues: MouthCue[] = [];
  for (const [i, cue] of value.entries()) {
    const ok =
      isFields(cue) &&
      hasExactly(cue, ['start', 'end', 'value']) &&
      isNumber(cue.start) &&
      isNumber(cue.end) &&
      cue.start >= 0 &&
      cue.end >= cue.start &&
      MOUTH_SHAPES.includes(cue.value as MouthShape);
    if (!ok) {
      reject(`bad mouthCue ${i}`);
      return null;
    }
    cues.push({
      start: cue.start as number,
      end: cue.end as number,
      value: cue.value as MouthShape,
    });
  }
  if (cues.length === 0) return cues;
  let ok = true;
  if (cues[0].start !== 0 || cues[cues.length - 1].value !== 'X') {
    reject('mouthCues must start at 0 and end on X');
    ok = false;
  }
  const gap = cues.findIndex(
    (cue, i) => i > 0 && Math.abs(cue.start - cues[i - 1].end) > CUE_TOLERANCE,
  );
  if (gap > 0) {
    reject(`mouthCues have a gap at ${cues[gap - 1].end.toFixed(2)}`);
    ok = false;
  }
  if (durationSec === null) {
    reject('mouthCues need durationSec');
    ok = false;
  }
  return ok ? cues : null;
}

function readWords(value: unknown, reject: (problem: string) => void): BeatWord[] | null {
  if (!Array.isArray(value)) {
    reject('bad words');
    return null;
  }
  if (value.length > LIMITS.words) {
    reject('too many words');
    return null;
  }
  const words: BeatWord[] = [];
  let lastStart = -Infinity;
  for (const [i, word] of value.entries()) {
    const untimed = isFields(word) && word.start === null && word.end === null;
    const timed =
      isFields(word) &&
      isNumber(word.start) &&
      isNumber(word.end) &&
      word.start >= 0 &&
      word.end >= word.start;
    const ok =
      isFields(word) &&
      hasExactly(word, ['text', 'start', 'end']) &&
      typeof word.text === 'string' &&
      word.text.length > 0 &&
      (untimed || timed);
    if (!ok) {
      reject(`bad word ${i}`);
      return null;
    }
    const start = word.start as number | null;
    if (start !== null) {
      if (start < lastStart) {
        reject(`words out of order at ${i}`);
        return null;
      }
      lastStart = start;
    }
    words.push({ text: word.text as string, start, end: word.end as number | null });
  }
  return words;
}

function readMarkers(
  value: unknown,
  wordCount: number | null,
  reject: (problem: string) => void,
  drop: (problem: string) => void,
): BeatMarker[] | null {
  if (!Array.isArray(value)) {
    reject('bad markers');
    return null;
  }
  if (value.length > LIMITS.markers) {
    reject('too many markers');
    return null;
  }
  const markers: BeatMarker[] = [];
  const seen = new Set<string>();
  for (const [i, marker] of value.entries()) {
    if (
      !isFields(marker) ||
      !hasExactly(marker, ['id', 'word', 'action']) ||
      !isId(marker.id) ||
      typeof marker.word !== 'number'
    ) {
      drop(`bad marker ${i}`);
      continue;
    }
    const { id, word } = marker;
    if (seen.has(id)) {
      drop(`duplicate marker ${id}`);
      continue;
    }
    seen.add(id);
    const inRange =
      Number.isInteger(word) && word >= 0 && (wordCount === null || word <= wordCount);
    if (!inRange) {
      drop(`marker ${id} anchors to word ${word} of ${wordCount}`);
      continue;
    }
    const action = parseAction(marker.action);
    if (!action) {
      drop(`marker ${id} has an invalid action`);
      continue;
    }
    markers.push({ id, word, action });
  }
  return markers;
}
