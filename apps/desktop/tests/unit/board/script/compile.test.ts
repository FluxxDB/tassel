import { type BeatAction, type BeatDoc, parseBeatDoc } from '@tassel/shared/beats';
import fixtures from '@tassel/shared/beats/fixtures.json';
import { describe, expect, it } from 'vitest';
import { compileScript } from '../../../../src/renderer/src/board/script/compile';
import { synthWords } from '../../../../src/renderer/src/board/script/synth-words';
import type { AuthoredScript, AuthoredStep } from '../../../../src/renderer/src/board/script/types';
import dfaOpening from '../../../../src/renderer/src/tutor/scripts/dfa-opening.json';
import type { FakeScript, TutorEvent } from '../../../../src/renderer/src/tutor/types';

const FREEZE: BeatAction = { kind: 'paper.freeze', frame: { kind: 'fixture', name: 'dfa-wrong' } };
const STEP1: BeatAction = {
  kind: 'paper.mark',
  mark: { type: 'step', id: 's1', n: 1, target: { el: 'edge:q0>q0' } },
};
const SPLIT: BeatAction = { kind: 'stage', view: 'split' };

const SCRIPT: AuthoredScript = {
  lang: 'en',
  steps: [
    { at: 0, event: { type: 'state', state: 'connecting' } },
    {
      at: 1000,
      turn: [
        {
          say: "Let's walk 1010 through your DFA, {#freeze}one symbol at a time.",
          actions: { freeze: FREEZE },
        },
        { say: 'Try 1010.' },
      ],
    },
  ],
};

/** One line per event, to read a compiled timeline at a glance. */
function summary(event: TutorEvent): string {
  switch (event.type) {
    case 'state':
      return `state ${event.state}`;
    case 'caption':
      return `caption ${event.speaker} ${event.text}`;
    case 'beat':
      return `beat ${event.beat.id}`;
    case 'word':
      return `word ${event.text}`;
    case 'actions':
      return `actions ${event.actions.map((a) => a.kind).join(' ')}`;
    default:
      return event.type;
  }
}

const timeline = (script: FakeScript) =>
  script.steps.map(({ at, event }) => `${at} ${summary(event)}`);

const beatsOf = (script: FakeScript): BeatDoc[] =>
  script.steps.flatMap(({ event }) => (event.type === 'beat' ? [event.beat] : []));

/** A script of one step: a turn. */
const oneTurn = (step: Extract<AuthoredStep, { turn: unknown }>): AuthoredScript => ({
  lang: 'en',
  steps: [step],
});

describe('compileScript', () => {
  it('a turn compiles to speaking, then per beat a caption, the beat and its words, then listening', () => {
    expect(timeline(compileScript(SCRIPT, 'demo'))).toEqual([
      '0 state connecting',
      '1000 state speaking',
      "1150 caption tutor Let's walk 1010 through your DFA, one symbol at a time.",
      '1150 beat demo-1-0',
      "1150 word Let's",
      '1520 word walk',
      '1890 word 1010',
      '2260 word through',
      '2795 word your',
      '3165 word DFA,',
      '3600 word one',
      '3915 word symbol',
      '4395 word at',
      '4655 word a',
      '4860 word time.',
      '5450 caption tutor Try 1010.',
      '5450 beat demo-1-1',
      '5450 word Try',
      '5765 word 1010.',
      '6375 state listening',
    ]);
  });

  it('the next beat starts 280 ms after the last one ends, and then comes 300 ms after the turn', () => {
    const { steps } = compileScript(SCRIPT, 'demo');
    const captions = steps.filter(({ event }) => event.type === 'caption').map(({ at }) => at);
    const [first, second] = beatsOf({ steps });
    expect(captions).toEqual([1150, 1150 + (first.durationSec as number) * 1000 + 280]);
    expect(steps.at(-1)?.at).toBe(captions[1] + (second.durationSec as number) * 1000 + 300);
  });

  it('a caption is final, Ada’s, in the script’s language, and has no anchors', () => {
    const caption = compileScript(SCRIPT, 'demo').steps.find(
      ({ event }) => event.type === 'caption',
    )?.event;
    expect(caption).toEqual({
      type: 'caption',
      speaker: 'tutor',
      text: "Let's walk 1010 through your DFA, one symbol at a time.",
      lang: 'en',
      final: true,
    });
  });

  it('{#id} anchors to the next word', () => {
    const [first] = beatsOf(compileScript(SCRIPT, 'demo'));
    expect(first.markers).toEqual([{ id: 'demo-1-0.1', word: 6, action: FREEZE }]);
    expect(first.words[6].text).toBe('one');
  });

  it('a trailing {#id} anchors after the last word', () => {
    const [spaced, tight] = beatsOf(
      compileScript(
        oneTurn({
          at: 0,
          turn: [
            { say: 'Try 1010. {#end}', actions: { end: STEP1 } },
            { say: 'Look.{#tail}', actions: { tail: SPLIT } },
          ],
        }),
        'demo',
      ),
    );
    expect(spaced.text).toBe('Try 1010.');
    expect(spaced.markers).toEqual([{ id: 'demo-0-0.1', word: 2, action: STEP1 }]);
    expect(tight.text).toBe('Look.');
    expect(tight.markers).toEqual([{ id: 'demo-0-1.1', word: 1, action: SPLIT }]);
  });

  it('an anchor holding several actions makes a marker for each, in order', () => {
    const [doc] = beatsOf(
      compileScript(
        oneTurn({
          at: 0,
          turn: [
            {
              say: '{#setup}Here we go, {#again}again.',
              actions: { setup: [FREEZE, STEP1], again: SPLIT },
            },
          ],
        }),
        'demo',
      ),
    );
    expect(doc.markers).toEqual([
      { id: 'demo-0-0.1', word: 0, action: FREEZE },
      { id: 'demo-0-0.2', word: 0, action: STEP1 },
      { id: 'demo-0-0.3', word: 3, action: SPLIT },
    ]);
  });

  it('an anchor with no action throws, naming the script, step and beat', () => {
    const script: AuthoredScript = {
      lang: 'en',
      steps: [
        { at: 0, event: { type: 'state', state: 'connecting' } },
        { at: 10, turn: [{ say: 'Hi.' }, { say: '{#look}Look.' }] },
      ],
    };
    expect(() => compileScript(script, 'demo')).toThrow(
      'script demo: step 1 beat 1 has no action "look"',
    );
  });

  it('an unused action throws', () => {
    const script = oneTurn({ at: 0, turn: [{ say: 'Hi.', actions: { x: FREEZE } }] });
    expect(() => compileScript(script, 'demo')).toThrow(
      'script demo: step 0 beat 0 never uses "x"',
    );
  });

  it('an anchor it can’t read throws instead of reaching a caption', () => {
    const script = oneTurn({ at: 0, turn: [{ say: '{#Look}Look.', actions: {} }] });
    expect(() => compileScript(script, 'demo')).toThrow(
      'script demo: step 0 beat 0 has a bad anchor "{#Look}"',
    );
  });

  it('a line of anchors only has no caption and no words: its beat fires on arrival', () => {
    const compiled = compileScript(
      oneTurn({ at: 0, turn: [{ say: '{#split}', actions: { split: SPLIT } }] }),
      'demo',
    );
    expect(timeline(compiled)).toEqual([
      '0 state speaking',
      '150 beat demo-0-0',
      '450 state listening',
    ]);
    const [doc] = beatsOf(compiled);
    expect(doc).toMatchObject({ text: '', words: [], durationSec: 0 });
    expect(doc.markers).toEqual([{ id: 'demo-0-0.1', word: 0, action: SPLIT }]);
    expect(parseBeatDoc(doc)).toEqual({ doc, problems: [] });
  });

  it('do steps become actions events', () => {
    expect(
      compileScript({ lang: 'en', steps: [{ at: 500, do: [FREEZE, STEP1] }] }, 'demo'),
    ).toEqual({ steps: [{ at: 500, event: { type: 'actions', actions: [FREEZE, STEP1] } }] });
  });

  it('a FakeScript passes through', () => {
    const fake: FakeScript = { steps: [{ at: 0, event: { type: 'state', state: 'connecting' } }] };
    expect(compileScript(fake, 'fake')).toBe(fake);
    const opening = dfaOpening as FakeScript;
    expect(compileScript(opening, 'dfa-opening')).toBe(opening);
  });

  it('word events carry segment and index', () => {
    const words = compileScript(SCRIPT, 'demo')
      .steps.map(({ event }) => event)
      .filter((event) => event.type === 'word');
    expect(words.slice(0, 2)).toEqual([
      { type: 'word', text: "Let's", lang: 'en', segment: 'demo-1-0', index: 0 },
      { type: 'word', text: 'walk', lang: 'en', segment: 'demo-1-0', index: 1 },
    ]);
    expect(words.at(-1)).toEqual({
      type: 'word',
      text: '1010.',
      lang: 'en',
      segment: 'demo-1-1',
      index: 1,
    });
  });

  it('every document has its ids, rest cues and timed words, and parses cleanly', () => {
    const [first, second] = beatsOf(compileScript(SCRIPT, 'demo'));
    expect(first).toMatchObject({
      version: 1,
      id: 'demo-1-0',
      turn: 'demo-1',
      segment: 'demo-1-0',
      lang: 'en',
      durationSec: 4.02,
      shapeSet: 'rhubarb9',
      mouthCues: [{ start: 0, end: 4.02, value: 'X' }],
    });
    expect(first.words).toEqual(synthWords(first.text).words);
    expect(second).toMatchObject({ id: 'demo-1-1', turn: 'demo-1', markers: [] });
    for (const doc of [first, second]) {
      expect(parseBeatDoc(doc)).toEqual({ doc, problems: [] });
    }
  });

  it("compiles the shared fixture's fake-style beat exactly", () => {
    const script: AuthoredScript = {
      lang: 'en',
      steps: [
        { at: 0, event: { type: 'state', state: 'connecting' } },
        {
          at: 2400,
          turn: [
            {
              say: "Let's walk 1010 through your DFA, {#freeze}one symbol at a time.{#split}",
              actions: { freeze: FREEZE, split: SPLIT },
            },
          ],
        },
      ],
    };
    expect(beatsOf(compileScript(script, 'marks-demo'))[0]).toEqual(fixtures.beats[0]);
  });

  it("a turn's then replaces listening", () => {
    const step: Parameters<typeof oneTurn>[0] = {
      at: 0,
      turn: [{ say: 'Over to you.' }],
      // biome-ignore lint/suspicious/noThenProperty: AuthoredStep names the state after a turn `then`.
      then: 'watching',
    };
    const { steps } = compileScript(oneTurn(step), 'demo');
    expect(steps.at(-1)?.event).toEqual({ type: 'state', state: 'watching' });
  });

  it('puts every event in time order, keeping the script’s order for events at one time', () => {
    const { steps } = compileScript(
      {
        lang: 'en',
        steps: [
          { at: 0, turn: [{ say: 'One two three.' }] },
          { at: 300, do: [SPLIT] },
        ],
      },
      'demo',
    );
    const ats = steps.map(({ at }) => at);
    expect(ats).toEqual([...ats].sort((a, b) => a - b));
    expect(timeline({ steps }).slice(0, 5)).toEqual([
      '0 state speaking',
      '150 caption tutor One two three.',
      '150 beat demo-0-0',
      '150 word One',
      '300 actions stage',
    ]);
  });
});
