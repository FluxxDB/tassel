import { isAbsolute } from 'node:path';
import { expect, it } from 'vitest';
import { e2eServerEnv } from '../../e2e/global-setup';

const base = {
  PATH: '/bin',
  TASSEL_E2E_PORT: '8824',
  DEEPGRAM_API_KEY: 'x',
  ELEVENLABS_API_KEY: 'x',
  OPENROUTER_API_KEY: 'x',
  OPENAI_API_KEY: 'x',
  ANTHROPIC_API_KEY: 'x',
  TASSEL_PROVIDERS: 'live',
  TASSEL_LLM_PROVIDER: 'live',
  TASSEL_FUTURE_PROVIDER_MODE: 'live',
  TASSEL_VOICE_EN: 'v',
  TASSEL_VOICE_ENV_FILE: '/do-not-read',
  TASSEL_VOICE_METRICS_LOG: '/wrong',
  TASSEL_FAKE_SCENARIO: 'stale',
  TASSEL_FAKE_TTS: 'say',
};
it('fake mode strips keys and pins every provider to fake without mutating base', () => {
  const env = e2eServerEnv(base, 'fake');
  for (const key of Object.keys(base).filter((key) => key.endsWith('_API_KEY')))
    expect(env[key]).toBeUndefined();
  for (const key of [
    'TASSEL_PROVIDERS',
    'TASSEL_STT_PROVIDER',
    'TASSEL_LLM_PROVIDER',
    'TASSEL_TTS_PROVIDER',
    'TASSEL_TITLES_PROVIDER',
  ])
    expect(env[key]).toBe('fake');
  expect(env.TASSEL_FUTURE_PROVIDER_MODE).toBeUndefined();
  expect(env.TASSEL_VOICE_EN).toBeUndefined();
  expect(env.TASSEL_VOICE_ENV_FILE).toBe('');
  expect(env.TASSEL_FAKE_SCENARIO).toBe('dfa-opening');
  expect(env.TASSEL_FAKE_TTS).toBe('tone');
  expect(isAbsolute(env.TASSEL_VOICE_METRICS_LOG ?? '')).toBe(true);
  expect(env.TASSEL_VOICE_METRICS_LOG?.replaceAll('\\', '/')).toMatch(
    /apps\/desktop\/test-results\/voice-metrics.jsonl$/,
  );
  expect(env.PATH).toBe('/bin');
  expect(env.TASSEL_E2E_PORT).toBe('8824');
  expect(base.TASSEL_LLM_PROVIDER).toBe('live');
});
it('live mode reads the env file and discards inherited fake settings', () => {
  const env = e2eServerEnv(base, 'live');
  expect(env.TASSEL_PROVIDERS).toBe('auto');
  for (const key of [
    'OPENAI_API_KEY',
    'OPENROUTER_API_KEY',
    'TASSEL_LLM_PROVIDER',
    'TASSEL_VOICE_ENV_FILE',
    'TASSEL_VOICE_EN',
    'TASSEL_FAKE_SCENARIO',
    'TASSEL_FAKE_TTS',
  ])
    expect(env[key]).toBeUndefined();
});
