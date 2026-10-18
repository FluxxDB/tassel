import assert from 'node:assert/strict';
import { test } from 'node:test';
import { devVoiceEnv } from './dev-voice-env.mjs';

test('having a provider key or global live mode does not opt development into paid TTS', () => {
  const source = { TASSEL_PROVIDERS: 'live', ELEVENLABS_API_KEY: 'made-up-test-value' };
  assert.equal(devVoiceEnv(source).TASSEL_TTS_PROVIDER, 'fake');
  assert.equal(source.TASSEL_TTS_PROVIDER, undefined);
  assert.equal(devVoiceEnv({ TASSEL_TTS_PROVIDER: '' }).TASSEL_TTS_PROVIDER, 'fake');
});
test('an explicit TTS override remains an owner-controlled choice', () => {
  assert.equal(devVoiceEnv({ TASSEL_TTS_PROVIDER: 'fake' }).TASSEL_TTS_PROVIDER, 'fake');
  assert.equal(devVoiceEnv({ TASSEL_TTS_PROVIDER: 'live' }).TASSEL_TTS_PROVIDER, 'live');
});
