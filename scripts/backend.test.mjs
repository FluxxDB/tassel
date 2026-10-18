// Tests for the shared backend start (scripts/backend.mjs), which pnpm dev, pnpm live and
// pnpm start use, and for the Compose file and Dockerfile staying consistent with it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  BACKEND_SERVICES,
  backendPlan,
  CANONICAL,
  containerDatabaseUrl,
  launcherOptions,
  providerEnvFile,
} from './backend.mjs';

const root = join(import.meta.dirname, '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const ownerKeys = join(root, 'services', 'server', '.env');
const none = () => false;

test('everyone gets the same backend by default: Docker, port 8787, tassel, tassel-frames', () => {
  const plan = backendPlan({ root, env: {}, exists: none });
  assert.equal(plan.mode, 'docker');
  assert.equal(plan.serverUrl, 'http://127.0.0.1:8787');
  assert.deepEqual(
    plan.steps.map((step) => [step.command, ...step.args]),
    [
      [
        'docker',
        'compose',
        'up',
        '-d',
        '--wait',
        '--wait-timeout',
        '180',
        '--build',
        'db',
        's3',
        'server',
      ],
    ],
  );
  const { env } = plan.steps[0];
  assert.equal(env.TASSEL_PORT, '8787');
  assert.equal(env.TASSEL_SERVER_DATABASE_URL, 'postgresql+psycopg://tassel:tassel@db:5432/tassel');
  assert.equal(env.TASSEL_S3_BUCKET, 'tassel-frames');
  assert.deepEqual(CANONICAL, { port: 8787, database: 'tassel', bucket: 'tassel-frames' });
});

test("the server's log follows the container from this run on, and the run stops only it", () => {
  const plan = backendPlan({ root, env: {}, exists: none, now: () => '2026-10-18T10:00:00.000Z' });
  assert.equal(plan.server.command, 'docker');
  assert.deepEqual(plan.server.args, [
    'compose',
    'logs',
    '--follow',
    '--no-log-prefix',
    '--since',
    '2026-10-18T10:00:00.000Z',
    'server',
  ]);
  // db and s3 keep running for the tests and the next run, as before.
  assert.deepEqual(plan.stop.args, ['compose', 'stop', 'server']);
});

test("saved overrides (Perry's .local/start.json) reach his existing data inside Docker", () => {
  const plan = backendPlan({
    root,
    env: {
      TASSEL_PORT: '8864',
      TASSEL_DATABASE_URL:
        'postgresql+psycopg://tassel:tassel@127.0.0.1:54329/tassel_t2_avatar_dev',
      TASSEL_S3_BUCKET: 'tassel-t2-avatar-dev',
    },
    exists: none,
  });
  const { env } = plan.steps[0];
  assert.equal(plan.serverUrl, 'http://127.0.0.1:8864');
  assert.equal(env.TASSEL_PORT, '8864');
  assert.equal(
    env.TASSEL_SERVER_DATABASE_URL,
    'postgresql+psycopg://tassel:tassel@db:5432/tassel_t2_avatar_dev',
  );
  assert.equal(env.TASSEL_S3_BUCKET, 'tassel-t2-avatar-dev');
});

test('database URLs: the Compose Postgres becomes the service db; other loopback ports the host', () => {
  assert.equal(
    containerDatabaseUrl('postgresql+psycopg://owner:p%40ss@localhost:54329/tassel_x'),
    'postgresql+psycopg://owner:p%40ss@db:5432/tassel_x',
  );
  assert.equal(
    containerDatabaseUrl('postgresql+psycopg://tassel:tassel@127.0.0.1:5432/tassel'),
    'postgresql+psycopg://tassel:tassel@host.docker.internal:5432/tassel',
  );
  assert.equal(
    containerDatabaseUrl('postgresql+psycopg://u:p@db.example.com:5432/tassel'),
    'postgresql+psycopg://u:p@db.example.com:5432/tassel',
  );
});

test('provider keys: the named file, else services/server/.env, else none; never read here', () => {
  assert.equal(
    providerEnvFile({ TASSEL_VOICE_ENV_FILE: '/keys/voice.env' }, { root }),
    '/keys/voice.env',
  );
  assert.equal(providerEnvFile({ TASSEL_VOICE_ENV_FILE: '' }, { root, exists: () => true }), '');
  assert.equal(providerEnvFile({}, { root, exists: (path) => path === ownerKeys }), ownerKeys);
  assert.equal(providerEnvFile({}, { root, exists: none }), '');

  const withKeys = backendPlan({ root, env: {}, exists: (path) => path === ownerKeys });
  assert.equal(withKeys.steps[0].env.TASSEL_VOICE_ENV_FILE, ownerKeys);
  // No file: Compose mounts services/server/no-provider-keys.env instead.
  const without = backendPlan({ root, env: { TASSEL_VOICE_ENV_FILE: '' }, exists: none });
  assert.equal('TASSEL_VOICE_ENV_FILE' in without.steps[0].env, false);
});

test('--host-server (or TASSEL_HOST_SERVER=1) runs the server with uv on the host, as before', () => {
  assert.deepEqual(launcherOptions([], {}), { hostServer: false });
  assert.deepEqual(launcherOptions(['--host-server'], {}), { hostServer: true });
  assert.deepEqual(launcherOptions([], { TASSEL_HOST_SERVER: '1' }), { hostServer: true });
  assert.throws(() => launcherOptions(['--watch'], {}), /--host-server/);

  const plan = backendPlan({ root, env: { TASSEL_PORT: '8864' }, hostServer: true, exists: none });
  const serverDir = join(root, 'services', 'server');
  assert.equal(plan.mode, 'host');
  assert.deepEqual(
    plan.steps.map((step) => [step.command, ...step.args, step.cwd]),
    [
      ['docker', 'compose', 'up', '-d', '--wait', 'db', 's3', root],
      ['uv', 'run', 'python', '-m', 'tassel.scripts.ensure_database', serverDir],
      ['uv', 'run', 'alembic', 'upgrade', 'head', serverDir],
    ],
  );
  assert.deepEqual([plan.server.command, ...plan.server.args], ['uv', 'run', 'tassel-server']);
  assert.equal(plan.server.env.TASSEL_PORT, '8864');
  assert.equal(plan.server.env.TASSEL_TRANSCRIPT_DIR, join(root, '.cache', 'live', 'transcripts'));
  assert.equal(plan.stop, null);
});

test('docker-compose.yml defines every backend service, on loopback, with the canonical names', () => {
  const compose = read('docker-compose.yml');
  for (const service of BACKEND_SERVICES) {
    assert.match(compose, new RegExp(`^  ${service}:$`, 'm'), `${service} is a Compose service`);
  }
  const ports = [...compose.matchAll(/^ {6}- "([^"]*:[^"]*)"$/gm)].map((match) => match[1]);
  assert.ok(ports.length >= 3);
  for (const port of ports) assert.match(port, /^127\.0\.0\.1:/, `${port} binds loopback only`);
  assert.ok(compose.includes(`"127.0.0.1:\${TASSEL_PORT:-${CANONICAL.port}}:8787"`));
  assert.ok(compose.includes(`@db:5432/${CANONICAL.database}}`));
  assert.ok(compose.includes(`\${TASSEL_S3_BUCKET:-${CANONICAL.bucket}}`));
  assert.match(compose, /context: services\/server$/m);
  assert.match(compose, /condition: service_healthy/);
  assert.match(compose, /\/v1\/health/);
  assert.match(
    compose,
    /source: \$\{TASSEL_VOICE_ENV_FILE:-\.\/services\/server\/no-provider-keys\.env\}/,
  );
  assert.doesNotMatch(
    compose,
    /^\s+env_file:/m,
    'keys are mounted, never in the container environment',
  );
});

test("the Dockerfile builds the server's Python from its lockfile, without keys", () => {
  const dockerfile = read('services/server/Dockerfile');
  const python = read('services/server/pyproject.toml').match(/requires-python = ">=(\d+\.\d+)/)[1];
  assert.match(dockerfile, new RegExp(`^FROM python:${python.replace('.', '\\.')}-slim`, 'm'));
  assert.match(dockerfile, /uv sync --frozen --no-dev/);
  assert.match(dockerfile, /tassel\.scripts\.container/);
  const ignored = read('services/server/.dockerignore').split('\n');
  for (const entry of ['.env*', '.local', '.cache', '.venv', 'node_modules']) {
    assert.ok(ignored.includes(entry), `.dockerignore excludes ${entry}`);
  }
  const placeholder = read('services/server/no-provider-keys.env');
  assert.ok(
    placeholder.split('\n').every((line) => !line.trim() || line.startsWith('#')),
    'the no-keys placeholder stays empty',
  );
});
