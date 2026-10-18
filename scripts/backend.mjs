// The backend every launcher starts (pnpm dev, pnpm live, pnpm start), the same way on macOS and
// Windows: Postgres, local S3 and the server in Docker (docker-compose.yml), with the desktop app
// on the host talking to http://127.0.0.1:<port>. `--host-server` (or TASSEL_HOST_SERVER=1) runs
// the server with uv on the host instead, as before, for debugging; Postgres and S3 stay in Docker.
// Importing this module starts nothing. It never opens the provider settings file: it only
// resolves its path, and the server reads the file itself (in the container, mounted read-only).
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The one default for everyone. Saved settings (.local/start.json) or TASSEL_* override it. */
export const CANONICAL = { port: 8787, database: 'tassel', bucket: 'tassel-frames' };
export const BACKEND_SERVICES = ['db', 's3', 'server'];
const COMPOSE_DB = { hosts: new Set(['127.0.0.1', 'localhost']), port: '54329' };

/** The launchers' shared flags. Anything else is a mistake, so it fails rather than being lost. */
export function launcherOptions(argv, env) {
  const unknown = argv.filter((arg) => arg !== '--host-server');
  if (unknown.length > 0) {
    throw new Error(
      `Could not start: unknown option ${unknown[0]}. The only option is --host-server.`,
    );
  }
  return { hostServer: argv.includes('--host-server') || env.TASSEL_HOST_SERVER === '1' };
}

/**
 * A host database URL as the container must write it: the Compose Postgres (loopback, 54329) is
 * the service `db` on 5432, another loopback Postgres is the host (host.docker.internal), and a
 * remote one is unchanged.
 */
export function containerDatabaseUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  if (!COMPOSE_DB.hosts.has(url.hostname)) return databaseUrl;
  if (url.port === COMPOSE_DB.port) {
    url.hostname = 'db';
    url.port = '5432';
  } else url.hostname = 'host.docker.internal';
  return url.href;
}

/**
 * The provider settings file the server reads: TASSEL_VOICE_ENV_FILE when it's set (empty means
 * none), else services/server/.env when it exists, as the server itself would pick. '' is none.
 */
export function providerEnvFile(env, { root, exists = existsSync }) {
  if (env.TASSEL_VOICE_ENV_FILE !== undefined) return env.TASSEL_VOICE_ENV_FILE;
  const serverKeys = join(root, 'services', 'server', '.env');
  return exists(serverKeys) ? serverKeys : '';
}

/**
 * What a launcher runs: `steps` to completion, then `server`, whose output is the server's log
 * (it ends when the server does), then, when the run ends, `stop` (null when there's nothing to
 * stop beyond `server` itself). Postgres and S3 keep running between runs, for the tests.
 */
export function backendPlan({
  root,
  env,
  hostServer = false,
  exists = existsSync,
  now = () => new Date().toISOString(),
}) {
  const serverDir = join(root, 'services', 'server');
  const port = env.TASSEL_PORT || String(CANONICAL.port);
  const serverUrl = `http://127.0.0.1:${port}`;
  const databaseUrl =
    env.TASSEL_DATABASE_URL ||
    `postgresql+psycopg://tassel:tassel@127.0.0.1:${COMPOSE_DB.port}/${CANONICAL.database}`;
  const bucket = env.TASSEL_S3_BUCKET || CANONICAL.bucket;
  const base = {
    ...env,
    TASSEL_PORT: port,
    TASSEL_DATABASE_URL: databaseUrl,
    TASSEL_S3_BUCKET: bucket,
  };

  if (hostServer) {
    return {
      mode: 'host',
      port,
      serverUrl,
      steps: [
        step(
          'start Postgres and local S3',
          ['compose', 'up', '-d', '--wait', 'db', 's3'],
          root,
          base,
          'docker',
        ),
        step(
          'ensure the dev database exists',
          ['run', 'python', '-m', 'tassel.scripts.ensure_database'],
          serverDir,
          base,
          'uv',
        ),
        step(
          'migrate the dev database',
          ['run', 'alembic', 'upgrade', 'head'],
          serverDir,
          base,
          'uv',
        ),
      ],
      server: {
        command: 'uv',
        args: ['run', 'tassel-server'],
        cwd: serverDir,
        env: { ...base, TASSEL_TRANSCRIPT_DIR: join(root, '.cache', 'live', 'transcripts') },
      },
      stop: null,
    };
  }

  const compose = { ...base, TASSEL_SERVER_DATABASE_URL: containerDatabaseUrl(databaseUrl) };
  const keys = providerEnvFile(env, { root, exists });
  // Unset, Compose mounts services/server/no-provider-keys.env: the fake providers, no keys.
  if (keys) compose.TASSEL_VOICE_ENV_FILE = keys;
  else delete compose.TASSEL_VOICE_ENV_FILE;
  const since = now();
  return {
    mode: 'docker',
    port,
    serverUrl,
    steps: [
      step(
        'start Postgres, local S3 and the server in Docker',
        ['compose', 'up', '-d', '--wait', '--wait-timeout', '180', '--build', ...BACKEND_SERVICES],
        root,
        compose,
        'docker',
      ),
    ],
    server: {
      command: 'docker',
      args: ['compose', 'logs', '--follow', '--no-log-prefix', '--since', since, 'server'],
      cwd: root,
      env: compose,
    },
    stop: { command: 'docker', args: ['compose', 'stop', 'server'], cwd: root, env: compose },
  };
}

function step(task, args, cwd, env, command) {
  return { task, command, args, cwd, env };
}
