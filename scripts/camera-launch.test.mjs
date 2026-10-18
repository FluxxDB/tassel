import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as paper from './paper-env.mjs';

const inherited = {
  PATH: '/bin',
  HOME: '/Users/owner',
  LANG: 'en_US.UTF-8',
  TASSEL_S3_SECRET_ACCESS_KEY: 'dummy-s3-secret',
  TASSEL_S3_ACCESS_KEY_ID: 'dummy-s3-id',
  TASSEL_DATABASE_URL: 'postgres://dummy-db-secret@localhost/db',
  ANTHROPIC_API_KEY: 'dummy-provider-secret',
  TASSEL_REQUIRE_FAKE_CAPTURE: '1',
  TASSEL_HELPER_CLIP: '/dummy/clip',
  TASSEL_DESKVIEW_HELPER: '/dummy/helper',
  TASSEL_FAKE_CAMERA_ACCESS: 'granted',
  TASSEL_PAPER_DEBUG: '1',
  TASSEL_UI_LANG: 'ko',
  ELECTRON_RUN_AS_NODE: '1',
  ELECTRON_RENDERER_URL: 'http://wrong-renderer',
  NODE_OPTIONS: '--require /dummy/injection',
};
const options = {
  electronApp: '/repo/Electron.app',
  mainEntry: '/repo/out/main/index.js',
  serverUrl: 'http://127.0.0.1:8787',
  tag: 'run-123',
};

test('camera pairs cannot put server credentials on the open command line', () => {
  const pairs = paper.cameraEnv(inherited, options);
  for (const value of ['dummy-s3-secret', 'dummy-s3-id', 'dummy-db-secret']) {
    assert.ok(!pairs.join(' ').includes(value));
  }
});

test('owner launch keeps desktop settings, strips inherited credentials and guard, tags helper', () => {
  assert.equal(typeof paper.cameraLaunch, 'function');
  const launch = paper.cameraLaunch(inherited, options);
  assert.equal(launch.command, 'open');
  assert.equal(launch.options.env.PATH, '/bin');
  assert.ok(launch.args.includes('TASSEL_UI_LANG=ko'));
  assert.ok(launch.args.includes('TASSEL_HELPER_TAG=run-123'));
  assert.ok(launch.args.includes('--tassel-camera-run=run-123'));
  for (const key of Object.keys(inherited).filter((key) =>
    /^(TASSEL_|ELECTRON_|NODE_OPTIONS|ANTHROPIC_)/.test(key),
  )) {
    assert.equal(launch.options.env[key], undefined);
  }
  for (const secret of [
    'dummy-s3-secret',
    'dummy-s3-id',
    'dummy-db-secret',
    'dummy-provider-secret',
  ]) {
    assert.ok(!JSON.stringify(launch).includes(secret));
  }
  for (const value of Object.values(inherited)) assert.ok(!launch.message.includes(value));
});

test('camera spec launch ignores all inherited capture and Electron overrides', () => {
  assert.equal(typeof paper.cameraLaunch, 'function');
  const launch = paper.cameraLaunch(inherited, {
    ...options,
    userData: '/tmp/fresh',
    cdpPort: 49152,
  });
  assert.deepEqual(launch.options.env, { PATH: '/bin', HOME: '/Users/owner', LANG: 'en_US.UTF-8' });
  const pairs = launch.args.filter((_, i) => launch.args[i - 1] === '--env');
  assert.deepEqual(pairs.sort(), [
    'TASSEL_HELPER_TAG=run-123',
    'TASSEL_PAPER_SOURCE=auto',
    'TASSEL_SERVER_URL=http://127.0.0.1:8787',
    'TASSEL_TOKEN_STORE=file',
    'TASSEL_USER_DATA=/tmp/fresh',
  ]);
  assert.ok(launch.args.includes('--remote-debugging-port=49152'));
});
