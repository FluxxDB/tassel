import assert from 'node:assert/strict';
import { test } from 'node:test';
import { team2Env } from './team2.mjs';

const root = process.cwd();
test('isolates servers, test databases, storage and app data', () => {
  const env = team2Env('test', { root, env: {} });
  assert.equal(env.TASSEL_PORT, '8861');
  assert.equal(env.TASSEL_E2E_PORT, '8862');
  for (const key of [
    'TASSEL_DATABASE_URL',
    'TASSEL_TEST_DATABASE_URL',
    'TASSEL_E2E_DATABASE_URL',
  ]) {
    assert.match(env[key], /\/tassel_t2_/);
  }
  assert.notEqual(env.TASSEL_TEST_DATABASE_URL, env.TASSEL_E2E_DATABASE_URL);
  assert.equal(env.TASSEL_E2E_S3_BUCKET, 'tassel-t2-webcam-e2e');
});
test('test configuration cannot inherit real capture or live providers', () => {
  const env = team2Env('test', {
    root,
    env: {
      TASSEL_PROVIDERS: 'live',
      TASSEL_STT_PROVIDER: 'live',
      TASSEL_PAPER_SOURCE: 'webcam',
      TASSEL_VOICE_ENV_FILE: 'private.env',
      OPENAI_API_KEY: 'test-only-not-a-key',
      TASSEL_FAKE_CAMERA_ACCESS: 'granted',
    },
  });
  assert.equal(env.TASSEL_PROVIDERS, 'fake');
  assert.equal(env.TASSEL_STT_PROVIDER, 'fake');
  assert.equal(env.TASSEL_REQUIRE_FAKE_CAPTURE, '1');
  assert.equal(env.TASSEL_PAPER_SOURCE, 'fake-clip');
  assert.equal(env.TASSEL_VOICE_ENV_FILE, '');
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.TASSEL_FAKE_CAMERA_ACCESS, undefined);
});
test('owner webcam mode selects real devices and the existing server key file', () => {
  const env = team2Env('webcam', {
    root,
    env: {
      TASSEL_FAKE_MIC: 'fake.wav',
      TASSEL_STT_PROVIDER: 'fake',
      TASSEL_FAKE_CLIP: 'fake.mjpeg',
    },
  });
  assert.equal(env.TASSEL_PAPER_SOURCE, 'webcam');
  assert.equal(env.TASSEL_REQUIRE_FAKE_CAPTURE, '0');
  assert.equal(env.TASSEL_TUTOR, 'live');
  assert.equal(env.TASSEL_PROVIDERS, 'live');
  assert.equal(env.TASSEL_STT_PROVIDER, undefined);
  assert.equal(env.TASSEL_FAKE_MIC, undefined);
  assert.equal(env.TASSEL_FAKE_CLIP, undefined);
  assert.match(env.TASSEL_VOICE_ENV_FILE, /services[\\/]server[\\/]\.env$/);
});
test('voice mode keeps the normal source; demo mode uses explicit fakes', () => {
  assert.equal(team2Env('voice', { root, env: {} }).TASSEL_PAPER_SOURCE, 'auto');
  const demo = team2Env('demo', { root, env: {} });
  assert.equal(demo.TASSEL_TUTOR, 'fake');
  assert.equal(demo.TASSEL_PAPER_SOURCE, 'fake-clip');
});

test('screenshare launch uses the current checkout and an isolated backend with the saved avatar profile', () => {
  const settings = team2Env('screen', {
    root,
    env: {
      TASSEL_LOCAL_USER_DATA: 'saved-avatar-profile',
      TASSEL_VOICE_ENV_FILE: 'existing-provider-settings',
    },
  });
  assert.equal(settings.TASSEL_USER_DATA, 'saved-avatar-profile');
  assert.equal(settings.TASSEL_PORT, '8865');
  assert.match(settings.TASSEL_DATABASE_URL, /tassel_t2_screen_dev$/);
  assert.equal(settings.TASSEL_VOICE_ENV_FILE, 'existing-provider-settings');
  assert.equal(settings.TASSEL_REQUIRE_FAKE_CAPTURE, '0');
  assert.equal(settings.TASSEL_TUTOR, 'live');
});
