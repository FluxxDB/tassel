import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildStartup, safeSummary, startArgs } from './start.mjs';

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
test('the default backend is the canonical one everyone shares: 8787, tassel, tassel-frames', () => {
  const result = buildStartup({ root, sharedRoot: shared, platform: 'win32', env: {}, exists });
  assert.equal(result.env.TASSEL_PORT, '8787');
  assert.equal(result.env.TASSEL_SERVER_URL, 'http://127.0.0.1:8787');
  assert.equal(
    result.env.TASSEL_DATABASE_URL,
    'postgresql+psycopg://tassel:tassel@127.0.0.1:54329/tassel',
  );
  assert.equal(result.env.TASSEL_S3_BUCKET, 'tassel-frames');
  assert.equal(safeSummary(result).backend, 'docker');
});
test('saved settings keep reaching existing data: 8864, tassel_t2_avatar_dev', () => {
  const result = buildStartup({
    root,
    sharedRoot: shared,
    platform: 'win32',
    env: {},
    exists,
    local: {
      port: 8864,
      databaseUrl: 'postgresql+psycopg://tassel:tassel@127.0.0.1:54329/tassel_t2_avatar_dev',
      s3Bucket: 'tassel-t2-avatar-dev',
    },
  });
  assert.equal(result.env.TASSEL_PORT, '8864');
  assert.equal(safeSummary(result).database, 'tassel_t2_avatar_dev');
  assert.equal(result.env.TASSEL_S3_BUCKET, 'tassel-t2-avatar-dev');
});
test('pnpm start takes --check and --host-server, and passes --host-server on to pnpm dev', () => {
  assert.deepEqual(startArgs([]), { check: false, hostServer: false, devArgs: [] });
  assert.deepEqual(startArgs(['--check']), { check: true, hostServer: false, devArgs: [] });
  assert.deepEqual(startArgs(['--host-server']), {
    check: false,
    hostServer: true,
    devArgs: ['--host-server'],
  });
  assert.throws(() => startArgs(['voice']), /Usage/);
  const host = buildStartup({ root, sharedRoot: shared, env: {}, exists, hostServer: true });
  assert.equal(safeSummary(host).backend, 'host');
  const fromEnv = buildStartup({
    root,
    sharedRoot: shared,
    env: { TASSEL_HOST_SERVER: '1' },
    exists,
  });
  assert.equal(safeSummary(fromEnv).backend, 'host');
});

test('live voice does not force optional vision services to require additional keys', () => {
  const { env } = buildStartup({ root, sharedRoot: shared, platform: 'win32', env: {}, exists });
  assert.equal(env.TASSEL_PROVIDERS, 'auto');
  for (const name of ['STT', 'TTS', 'TITLES']) assert.equal(env[`TASSEL_${name}_PROVIDER`], 'live');
  assert.equal(env.TASSEL_LLM_PROVIDER, undefined);
  assert.equal(env.TASSEL_GATE_PROVIDER, undefined);
  assert.equal(env.TASSEL_DEEPCHECK_PROVIDER, undefined);
});
