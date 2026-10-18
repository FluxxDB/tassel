import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildStartup, safeSummary } from './start.mjs';

const root = process.cwd(),
  shared = join(root, 'shared-repository');
const exists = (path) => path === join(shared, '.local', 'live-test', 'services', 'server', '.env');
test('one launcher starts this checkout and shares the existing profile across worktrees', () => {
  const first = buildStartup({ root, sharedRoot: shared, platform: 'win32', env: {}, exists });
  const second = buildStartup({
    root: join(root, 'another-worktree'),
    sharedRoot: shared,
    platform: 'win32',
    env: {},
    exists,
  });
  assert.equal(first.root, root);
  assert.equal(first.env.TASSEL_USER_DATA, second.env.TASSEL_USER_DATA);
  assert.equal(first.env.TASSEL_DATABASE_URL, second.env.TASSEL_DATABASE_URL);
  assert.equal(first.env.TASSEL_USER_DATA, join(shared, '.local', 'avatar-app-data'));
  assert.equal(first.env.TASSEL_PAPER_SOURCE, 'webcam');
  assert.equal(first.env.TASSEL_TUTOR, 'live');
  assert.equal(first.env.TASSEL_TTS_PROVIDER, 'live');
  assert.equal(first.env.TASSEL_REQUIRE_FAKE_CAPTURE, '0');
});
test('inherited feature-demo settings cannot silently hide real app features', () => {
  const result = buildStartup({
    root,
    sharedRoot: shared,
    platform: 'win32',
    env: {
      TASSEL_FAKE_MIC: 'fake.wav',
      TASSEL_REQUIRE_FAKE_CAPTURE: '1',
      TASSEL_TUTOR: 'fake',
      TASSEL_PAPER_SOURCE: 'fake-clip',
      TASSEL_TTS_PROVIDER: 'fake',
    },
    exists,
  });
  assert.equal(result.env.TASSEL_FAKE_MIC, undefined);
  assert.equal(result.env.TASSEL_TUTOR, 'live');
  assert.equal(result.env.TASSEL_PAPER_SOURCE, 'webcam');
  assert.equal(result.env.TASSEL_TTS_PROVIDER, 'live');
});
test('Mac and Windows expose their actual capture sources through the same entry point', () => {
  const mac = buildStartup({ root, sharedRoot: shared, platform: 'darwin', env: {}, exists });
  assert.equal(mac.env.TASSEL_PAPER_SOURCE, 'auto');
  assert.equal(
    mac.env.TASSEL_DATABASE_URL,
    buildStartup({ root, sharedRoot: shared, platform: 'win32', env: {}, exists }).env
      .TASSEL_DATABASE_URL,
  );
});
test('explicit local configuration wins without putting secrets in the report', () => {
  const result = buildStartup({
    root,
    sharedRoot: shared,
    platform: 'win32',
    env: { OPENAI_API_KEY: 'never-print-this' },
    exists: () => true,
    local: {
      userData: 'saved-profile',
      port: 8866,
      databaseUrl: 'postgresql+psycopg://owner:password@localhost:54329/existing_db',
      voiceEnvFile: 'settings.env',
      s3Bucket: 'existing-bucket',
    },
  });
  assert.equal(result.env.TASSEL_USER_DATA, join(shared, 'saved-profile'));
  assert.equal(result.env.TASSEL_PORT, '8866');
  assert.equal(result.env.TASSEL_VOICE_ENV_FILE, join(shared, 'settings.env'));
  const summary = JSON.stringify(safeSummary(result));
  assert.ok(!summary.includes('password'));
  assert.ok(!summary.includes('never-print-this'));
  assert.throws(() =>
    buildStartup({
      root,
      sharedRoot: shared,
      platform: 'win32',
      env: {},
      exists,
      local: { port: 0 },
    }),
  );
});

test('live voice does not force optional vision services to require additional keys', () => {
  const { env } = buildStartup({ root, platform: 'win32', env: {}, exists });
  assert.equal(env.TASSEL_PROVIDERS, 'auto');
  for (const name of ['STT', 'LLM', 'TTS', 'TITLES'])
    assert.equal(env[`TASSEL_${name}_PROVIDER`], 'live');
  assert.equal(env.TASSEL_GATE_PROVIDER, undefined);
  assert.equal(env.TASSEL_DEEPCHECK_PROVIDER, undefined);
});
