// Tests for the eval launcher (scripts/eval-live.mjs), run by the root `pnpm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evalCommand } from './eval-live.mjs';

test('runs the Python eval module in the server project with every argument', () => {
  const { command, args } = evalCommand(['--dry-run', 'views'], {});
  assert.equal(command, 'uv');
  assert.deepEqual(args.slice(0, 2), ['run', '--directory']);
  assert.match(args[2], /services[/\\]server$/);
  assert.deepEqual(args.slice(3), ['python', '-m', 'tassel.evals.live', '--dry-run', 'views']);
});

test('quiets the pipeline logs unless asked, and passes the environment on untouched', () => {
  const env = { TASSEL_VOICE_ENV_FILE: '/somewhere/voice.env' };
  assert.deepEqual(evalCommand([], env).env, { LOGURU_LEVEL: 'ERROR', ...env });
  assert.equal(evalCommand([], { ...env, LOGURU_LEVEL: 'DEBUG' }).env.LOGURU_LEVEL, 'DEBUG');
  assert.equal(evalCommand(['--verbose'], env).env, env);
});
