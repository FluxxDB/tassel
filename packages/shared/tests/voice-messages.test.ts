import { describe, expect, it } from 'vitest';
import fixtures from '../src/voice/fixtures.json';
import {
  ICE_SERVERS_PATH,
  parseServerEvent,
  silenceBudget,
  VOICE_BUDGETS,
  voiceOfferPath,
} from '../src/voice/messages';

const METRICS = {
  turn: 2,
  lang: 'en',
  input: 'typed',
  stt_ms: null,
  llm_ttfb_ms: 240,
  tts_ttfb_ms: 150,
  server_ttfa_ms: 600,
  interrupted: false,
  budget_ms: 1200,
};

describe('parseServerEvent', () => {
  it.each(fixtures.server)('parses the $kind server event', (event) => {
    expect(parseServerEvent({ tassel: event })).toEqual(event);
  });

  it.each([
    null,
    'x',
    {},
    { tassel: { kind: 'nope' } },
    { tassel: { kind: 'beat', beat: null } },
    { tassel: { kind: 'beat', beat: { version: 1 } } },
    { tassel: { kind: 'title' } },
    { tassel: { kind: 'vad', speaking: 'yes' } },
    // Beyond the brief's six: every declared field is present, with its own type.
    { tassel: [] },
    { tassel: { kind: 'title', title: 'Strings that start with 010' } },
    { tassel: { kind: 'title', title: 7, subject: null } },
    { tassel: { kind: 'stage', view: 'desk' } },
    { tassel: { kind: 'language', lang: 'fr' } },
    { tassel: { kind: 'route', lang: 'en', stt: 'whisper', llm: 'fake', tts: 'fake' } },
    { tassel: { kind: 'backchannel', text: null } },
    { tassel: { kind: 'turn-metrics' } },
    { tassel: { kind: 'turn-metrics', metrics: { ...METRICS, stt_ms: '250' } } },
    { tassel: { kind: 'turn-metrics', metrics: { ...METRICS, interrupted: undefined } } },
    { tassel: { kind: 'turn-metrics', metrics: { ...METRICS, input: 'mumbled' } } },
    // A kind is looked up only among the contract's own, never on the prototype chain.
    { tassel: { kind: 'constructor' } },
    { tassel: { kind: 'toString' } },
    { tassel: { kind: '__proto__' } },
  ])('rejects %j', (data) => expect(parseServerEvent(data)).toBeNull());

  it('accepts the null timings of a typed turn', () => {
    const event = { kind: 'turn-metrics', metrics: METRICS };
    expect(parseServerEvent({ tassel: event })).toEqual(event);
  });

  it('reads only the declared fields, so a newer server can add one', () => {
    expect(parseServerEvent({ tassel: { kind: 'vad', speaking: true, energy: 0.4 } })).toEqual({
      kind: 'vad',
      speaking: true,
    });
    const parsed = parseServerEvent({
      tassel: { kind: 'turn-metrics', metrics: { ...METRICS, llm: 'cerebras' } },
    });
    expect(parsed).toEqual({ kind: 'turn-metrics', metrics: METRICS });
  });
});

describe('the contract constants', () => {
  it('keeps the spec §2 budgets, as R5 splits them', () => {
    expect(VOICE_BUDGETS).toEqual({
      ttfa_ms: { en: 1200, es: 1200, ko: 1400 },
      yield_ms: 300,
      silence_ms: 600,
      silence_instant_ms: 300,
    });
    expect(fixtures.budgets).toEqual(VOICE_BUDGETS);
    expect([silenceBudget('low'), silenceBudget('normal'), silenceBudget('high')]).toEqual([
      600, 600, 300,
    ]);
  });

  it('builds endpoint paths', () => {
    expect(voiceOfferPath('abc')).toBe('/v1/sessions/abc/voice/offer');
    expect(fixtures.endpoints).toEqual({
      offer: '/v1/sessions/{session_id}/voice/offer',
      ice_servers: ICE_SERVERS_PATH,
    });
  });

  it('keeps a session id inside its path segment', () => {
    expect(voiceOfferPath('a/b?c')).toBe('/v1/sessions/a%2Fb%3Fc/voice/offer');
  });
});
