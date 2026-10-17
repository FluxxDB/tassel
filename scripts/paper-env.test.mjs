// Tests for scripts/paper-env.mjs, run by the root `pnpm test` through node:test.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cameraEnv, devPaperEnv, openArgs } from './paper-env.mjs';

const DEMO = '/repo/.cache/paper-clips/dfa-demo-960x720-0000.mjpeg';
const demoClip = () => DEMO;

test('plain pnpm dev uses the real paper source (R39): nothing fake is added', () => {
  for (const env of [
    {},
    { TASSEL_PAPER_SOURCE: 'auto' },
    { TASSEL_PAPER_SOURCE: 'deskview-helper' },
  ]) {
    const { add, real } = devPaperEnv(env, demoClip);
    assert.deepEqual(add, {});
    assert.equal(real, true);
  }
});

test('TASSEL_PAPER_SOURCE=fake-clip plays the demo clip with real capture refused', () => {
  let generated = 0;
  const { add, real } = devPaperEnv({ TASSEL_PAPER_SOURCE: 'fake-clip' }, () => {
    generated += 1;
    return DEMO;
  });
  assert.deepEqual(add, { TASSEL_FAKE_CLIP: DEMO, TASSEL_REQUIRE_FAKE_CAPTURE: '1' });
  assert.equal(real, false);
  assert.equal(generated, 1);
});

test("a fake clip of one's own is kept, and so is an explicit TASSEL_REQUIRE_FAKE_CAPTURE", () => {
  const own = devPaperEnv(
    { TASSEL_PAPER_SOURCE: 'fake-clip', TASSEL_FAKE_CLIP: '/clips/mine.mjpeg' },
    () => assert.fail('no demo clip is needed'),
  );
  assert.deepEqual(own.add, { TASSEL_REQUIRE_FAKE_CAPTURE: '1' });
  const explicit = devPaperEnv(
    { TASSEL_PAPER_SOURCE: 'fake-clip', TASSEL_REQUIRE_FAKE_CAPTURE: '0' },
    demoClip,
  );
  assert.deepEqual(explicit.add, { TASSEL_FAKE_CLIP: DEMO });
});

test('a helper clip or a fake display is not the real camera', () => {
  assert.equal(
    devPaperEnv(
      { TASSEL_PAPER_SOURCE: 'deskview-helper', TASSEL_HELPER_CLIP: '/c.mjpeg' },
      demoClip,
    ).real,
    false,
  );
  assert.equal(
    devPaperEnv({ TASSEL_PAPER_SOURCE: 'window-capture', TASSEL_FAKE_DISPLAY: 'self' }, demoClip)
      .real,
    false,
  );
});

test("the camera run passes the shell's TASSEL_* with real defaults, never requireFake", () => {
  const pairs = cameraEnv(
    {
      HOME: '/Users/her',
      PATH: '/bin',
      TASSEL_PAPER_DEBUG: '1',
      TASSEL_REQUIRE_FAKE_CAPTURE: '1',
      TASSEL_UI_LANG: 'ko',
    },
    { serverUrl: 'http://127.0.0.1:8787' },
  );
  assert.deepEqual(pairs.sort(), [
    'TASSEL_PAPER_DEBUG=1',
    'TASSEL_PAPER_SOURCE=auto',
    'TASSEL_SERVER_URL=http://127.0.0.1:8787',
    'TASSEL_TOKEN_STORE=file',
    'TASSEL_UI_LANG=ko',
  ]);
});

test("the shell's own source, server and token store win over the defaults", () => {
  const pairs = cameraEnv(
    {
      TASSEL_PAPER_SOURCE: 'window-capture',
      TASSEL_SERVER_URL: 'http://127.0.0.1:9000',
      TASSEL_TOKEN_STORE: 'safe',
    },
    { serverUrl: 'http://127.0.0.1:8787' },
  );
  assert.deepEqual(pairs.sort(), [
    'TASSEL_PAPER_SOURCE=window-capture',
    'TASSEL_SERVER_URL=http://127.0.0.1:9000',
    'TASSEL_TOKEN_STORE=safe',
  ]);
});

test('open launches a new Electron through LaunchServices and waits for it', () => {
  assert.deepEqual(
    openArgs({
      electronApp: '/repo/Electron.app',
      env: ['A=1', 'B=2'],
      log: '/repo/.cache/camera/app.log',
      args: ['/repo/out/main/index.js', '--tassel-run=abc'],
    }),
    [
      '-n',
      '-W',
      '-a',
      '/repo/Electron.app',
      '--env',
      'A=1',
      '--env',
      'B=2',
      '--stdout',
      '/repo/.cache/camera/app.log',
      '--stderr',
      '/repo/.cache/camera/app.log',
      '--args',
      '/repo/out/main/index.js',
      '--tassel-run=abc',
    ],
  );
});
