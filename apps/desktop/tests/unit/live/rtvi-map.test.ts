import { describe, expect, it } from 'vitest';
import {
  initialMapState,
  mapRtvi,
  type RtviInput,
} from '../../../src/renderer/src/tutor/live/rtvi-map';
import type { TutorEvent } from '../../../src/renderer/src/tutor/types';

function run(inputs: RtviInput[]) {
  let state = initialMapState('en');
  const events: TutorEvent[] = [];
  const effects = [];
  for (const input of inputs) {
    const next = mapRtvi(state, input);
    state = next.state;
    events.push(...next.events);
    effects.push(...next.effects);
  }
  return { state, events, effects };
}
const output = (
  segmentId: string,
  status: 'new' | 'in-progress' | 'completed' | null,
  accumulated: string | null,
  text = '',
): RtviInput => ({ kind: 'bot-output', segmentId, status, accumulated, text });
const first: RtviInput[] = [
  { kind: 'bot-started' },
  output('s1', 'new', ''),
  output('s1', 'completed', "Hi, I'm Ada."),
  output('s2', 'new', ''),
  output('s2', 'in-progress', 'What are'),
];
const whole: RtviInput[] = [
  ...first,
  output('s2', 'completed', 'What are we working on today?'),
  { kind: 'bot-stopped' },
];
describe('mapRtvi', () => {
  it('a turn runs listening → thinking → speaking → listening', () => {
    const { events } = run([
      { kind: 'bot-ready' },
      { kind: 'user-started' },
      { kind: 'user-stopped' },
      { kind: 'bot-started' },
      { kind: 'bot-stopped' },
    ]);
    expect(events.filter((e) => e.type === 'state').map((e) => e.state)).toEqual([
      'listening',
      'listening',
      'thinking',
      'speaking',
      'listening',
    ]);
    expect(events[0]).toEqual({ type: 'connection', status: 'connected' });
    expect(run([{ kind: 'transport', state: 'connecting' }]).events).toEqual([
      { type: 'connection', status: 'connecting' },
      { type: 'state', state: 'connecting' },
    ]);
  });
  it('two sentences caption as one line without a blank between them', () => {
    const { events, state } = run(whole);
    const captions = events.filter((e) => e.type === 'caption');
    expect(captions.map((e) => e.text)).toEqual([
      "Hi, I'm Ada.",
      "Hi, I'm Ada. What are",
      "Hi, I'm Ada. What are we working on today?",
      "Hi, I'm Ada. What are we working on today?",
    ]);
    expect(captions.at(-1)).toMatchObject({ speaker: 'tutor', final: true, lang: 'en' });
    expect(state.done).toEqual([]);
    expect(state.segment).toBeNull();
  });
  it('an interruption mid-sentence keeps only what was said', () => {
    const { events, effects } = run([...first, { kind: 'bot-stopped' }]);
    expect(events.filter((e) => e.type === 'caption').at(-1)).toMatchObject({
      text: "Hi, I'm Ada. What are",
      final: true,
    });
    expect(effects.at(-1)).toEqual({ type: 'duck', on: false });
  });
  it('emits one word per spoken word across sentences and repeated progress', () => {
    const { events } = run([
      ...first,
      output('s2', 'in-progress', 'What are'),
      output('s2', 'completed', 'What are we working on today?'),
    ]);
    expect(events.filter((e) => e.type === 'word').map((e) => e.text)).toEqual([
      'Hi,',
      "I'm",
      'Ada.',
      'What',
      'are',
      'we',
      'working',
      'on',
      'today?',
    ]);
  });
  it('a new segment retains an unfinished previous segment and completion can use text', () => {
    const { events } = run([
      output('s1', 'in-progress', 'Hello'),
      output('s2', 'new', ''),
      output('s2', 'completed', null, 'there'),
      { kind: 'bot-stopped' },
    ]);
    expect(events.filter((e) => e.type === 'caption').at(-1)).toMatchObject({
      text: 'Hello there',
      final: true,
    });
  });
  it('ignores unspoken output and does not mutate the old state', () => {
    const state = initialMapState('en');
    const next = mapRtvi(state, output('s1', null, null, 'unspoken'));
    expect(next.events).toEqual([]);
    expect(state).toEqual(initialMapState('en'));
    mapRtvi(state, output('s1', 'completed', 'said'));
    expect(state.done).toEqual([]);
  });
  it.each([false, true])('user text maps to student captions, final=%s', (final) => {
    expect(run([{ kind: 'user-text', text: 'Hi', final }]).events).toEqual([
      { type: 'caption', speaker: 'student', text: 'Hi', lang: 'en', final },
    ]);
  });
  it('maps title, stage, route, metrics and backchannel envelopes', () => {
    const metrics = {
      kind: 'turn-metrics',
      metrics: {
        turn: 1,
        lang: 'en',
        input: 'voice',
        stt_ms: null,
        llm_ttfb_ms: 20,
        tts_ttfb_ms: 40,
        server_ttfa_ms: 80,
        interrupted: false,
        budget_ms: 1200,
      },
    };
    const route = { kind: 'route', lang: 'en', stt: 'flux', llm: 'openrouter', tts: 'elevenlabs' };
    const backchannel = { kind: 'backchannel', text: 'uh-huh' };
    const { events, effects } = run(
      [
        { kind: 'title', title: 'Learning', subject: null },
        { kind: 'stage', view: 'split' },
        route,
        metrics,
        backchannel,
      ].map((tassel) => ({ kind: 'server', data: { tassel } })),
    );
    expect(events).toEqual([
      { type: 'title', title: 'Learning', subject: null },
      { type: 'stage', mode: 'split' },
      { type: 'voice-debug', event: route },
      { type: 'voice-debug', event: metrics },
      { type: 'voice-debug', event: backchannel },
    ]);
    expect(effects).toEqual([{ type: 'duck', on: false }]);
  });
  it('vad ducks only while Ada speaks and always unducks when speech ends', () => {
    const vad = (speaking: boolean): RtviInput => ({
      kind: 'server',
      data: { tassel: { kind: 'vad', speaking } },
    });
    expect(run([vad(true)]).effects).toEqual([]);
    expect(run([{ kind: 'bot-started' }, vad(true), vad(false)]).effects).toEqual([
      { type: 'duck', on: true },
      { type: 'duck', on: false },
    ]);
  });
  it.each([false, true])('language changes reconnect now or after speech (%s)', (speaking) => {
    const { events, effects, state } = run([
      ...(speaking ? [{ kind: 'bot-started' } as const] : []),
      { kind: 'server', data: { tassel: { kind: 'language', lang: 'ko' } } },
    ]);
    expect(events.at(-1)).toEqual({ type: 'language', lang: 'ko' });
    expect(state.lang).toBe('ko');
    expect(effects).toEqual([{ type: 'reconnect', when: speaking ? 'after-bot-stops' : 'now' }]);
  });
  it.each([
    null,
    {},
    { tassel: { kind: 'language', lang: 'xx' } },
    { tassel: { kind: 'constructor' } },
  ])('garbage server data maps to nothing (%j)', (data) => {
    expect(run([{ kind: 'server', data }]).events).toEqual([]);
  });
});
