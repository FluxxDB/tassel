// Authored scripts into the FakeScript the fake tutor plays. Each of Ada's lines becomes a
// caption, a beat document carrying its anchored actions, and one word event per word at the
// fake voice's times, so the beat player fires her marks on their words. A FakeScript passes
// through as it is.
import { type BeatAction, type BeatDoc, type BeatMarker, restCues } from '@tassel/shared/beats';
import type { FakeScript, TutorEvent } from '../../tutor/types';
import { synthWords } from './synth-words';
import type { AuthoredBeat, AuthoredScript, AuthoredStep } from './types';

/** From a turn's start to its first beat. */
const TURN_LEAD_MS = 150;
/** Between one beat's end and the next one's start. */
const BEAT_GAP_MS = 280;
/** From the last beat's end to the state after the turn. */
const TURN_TAIL_MS = 300;

const ANCHOR = /\{#([a-z0-9-]+)\}/g;

/**
 * The FakeScript for `script`, named `name` in its ids and its errors. Throws when a beat's
 * anchors and actions don't pair up, or when an anchor can't be read.
 */
export function compileScript(script: AuthoredScript | FakeScript, name: string): FakeScript {
  if (!('lang' in script)) return script;
  const steps: FakeScript['steps'] = [];
  script.steps.forEach((step, i) => {
    if ('event' in step) {
      steps.push({ at: step.at, event: step.event });
    } else if ('do' in step) {
      steps.push({ at: step.at, event: { type: 'actions', actions: step.do } });
    } else {
      steps.push(...compileTurn(step, i, name, script.lang));
    }
  });
  // In time order; events at one time keep their order (a stable sort).
  return { steps: steps.sort((a, b) => a.at - b.at) };
}

type Turn = Extract<AuthoredStep, { turn: unknown }>;

function compileTurn(
  step: Turn,
  i: number,
  name: string,
  lang: AuthoredScript['lang'],
): FakeScript['steps'] {
  const out: FakeScript['steps'] = [];
  const at = (ms: number, event: TutorEvent) => out.push({ at: Math.round(ms), event });
  at(step.at, { type: 'state', state: 'speaking' });
  let start = step.at + TURN_LEAD_MS;
  let end = start;
  step.turn.forEach((line, k) => {
    const doc = compileBeat(line, { name, step: i, beat: k, lang });
    // A line of anchors only says nothing: its beat fires on arrival, with no caption.
    if (doc.text) {
      at(start, { type: 'caption', speaker: 'tutor', text: doc.text, lang, final: true });
    }
    at(start, { type: 'beat', beat: doc });
    doc.words.forEach((word, index) => {
      at(start + (word.start as number) * 1000, {
        type: 'word',
        text: word.text,
        lang,
        segment: doc.segment,
        index,
      });
    });
    // Whole milliseconds, so a long turn never drifts.
    end = Math.round(start + (doc.durationSec as number) * 1000);
    start = end + BEAT_GAP_MS;
  });
  at(end + TURN_TAIL_MS, { type: 'state', state: step.then ?? 'listening' });
  return out;
}

function compileBeat(
  line: AuthoredBeat,
  where: { name: string; step: number; beat: number; lang: AuthoredScript['lang'] },
): BeatDoc {
  const fail = (problem: string): never => {
    throw new Error(`script ${where.name}: step ${where.step} beat ${where.beat} ${problem}`);
  };
  const id = `${where.name}-${where.step}-${where.beat}`;
  const { text, anchors } = readAnchors(line.say);
  const bad = text.match(/\{#[^}\s]*\}?/u);
  if (bad) fail(`has a bad anchor "${bad[0]}"`);
  const { words, durationSec } = synthWords(text);
  const actions = line.actions ?? {};

  const markers: BeatMarker[] = [];
  for (const anchor of anchors) {
    if (!Object.hasOwn(actions, anchor.id)) fail(`has no action "${anchor.id}"`);
    const word = wordAt(text, anchor.at);
    for (const action of ([] as BeatAction[]).concat(actions[anchor.id])) {
      markers.push({ id: `${id}.${markers.length + 1}`, word, action });
    }
  }
  const used = new Set(anchors.map((anchor) => anchor.id));
  for (const key of Object.keys(actions)) {
    if (!used.has(key)) fail(`never uses "${key}"`);
  }

  return {
    version: 1,
    id,
    turn: `${where.name}-${where.step}`,
    segment: id,
    lang: where.lang,
    text,
    durationSec,
    shapeSet: 'rhubarb9',
    mouthCues: restCues(durationSec),
    words,
    markers,
  };
}

/**
 * The line without its anchors, its spaces made single, and where each anchor was in it: a
 * position in that text.
 */
function readAnchors(say: string): { text: string; anchors: Array<{ id: string; at: number }> } {
  const anchors: Array<{ id: string; at: number }> = [];
  let text = '';
  let rest = 0;
  for (const match of say.matchAll(ANCHOR)) {
    text += collapse(say.slice(rest, match.index), text);
    anchors.push({ id: match[1], at: text.length });
    rest = match.index + match[0].length;
  }
  text += collapse(say.slice(rest), text);
  return { text: text.trimEnd(), anchors };
}

/** `piece` with its runs of whitespace made single, and none leading the line. */
function collapse(piece: string, before: string): string {
  const single = piece.replace(/\s+/gu, ' ');
  return before === '' || before.endsWith(' ') ? single.replace(/^ /u, '') : single;
}

/** The index of the first word starting at or after `at`: the word an anchor there precedes. */
function wordAt(text: string, at: number): number {
  let index = 0;
  for (const match of text.matchAll(/\S+/gu)) {
    if (match.index >= at) return index;
    index += 1;
  }
  return index;
}
