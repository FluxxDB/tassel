// Playwright global setup. When services/server exists, it creates and migrates the tassel_e2e
// database and starts the server on the E2E port; the function it returns stops the server.
// tassel_e2e is separate from the server tests' tassel_test, so the two suites can run at once.
// TASSEL_E2E_DATABASE_URL points it at another database, as TASSEL_TEST_DATABASE_URL does for
// the server tests, and TASSEL_E2E_PORT at another port (fixtures.ts reads it), so checkouts
// can run E2E side by side.
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import spawn from 'cross-spawn';
import { E2E_SERVER_URL } from './fixtures';

const serverDir = join(__dirname, '..', '..', '..', '..', 'services', 'server');
const healthUrl = `${E2E_SERVER_URL}/v1/health`;
const databaseUrl =
  process.env.TASSEL_E2E_DATABASE_URL ??
  'postgresql+psycopg://tassel:tassel@127.0.0.1:54329/tassel_e2e';
const STARTUP_TIMEOUT_MS = 30_000;

// Creates the database if it's missing, the same way services/server/tests/conftest.py
// creates tassel_test.
const CREATE_DATABASE_PY = `
import os
from sqlalchemy import create_engine, make_url, text

target = make_url(os.environ["TASSEL_DATABASE_URL"])
admin = create_engine(target.set(database="tassel"), isolation_level="AUTOCOMMIT")
try:
    with admin.connect() as conn:
        exists = conn.scalar(
            text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": target.database}
        )
        if not exists:
            name = conn.dialect.identifier_preparer.quote(target.database)
            conn.execute(text(f"CREATE DATABASE {name}"))
finally:
    admin.dispose()
`;

export default async function globalSetup(): Promise<(() => Promise<void>) | undefined> {
  if (!existsSync(serverDir)) {
    console.log(`[e2e] ${serverDir} doesn't exist, so the E2E server won't start.`);
    return undefined;
  }
  if (await isHealthy()) {
    throw new Error(`[e2e] Something already answers ${healthUrl}. Stop it, then rerun.`);
  }
  const env = {
    ...process.env,
    TASSEL_DATABASE_URL: databaseUrl,
    TASSEL_PORT: new URL(E2E_SERVER_URL).port,
  };
  uvSync('create the E2E database', ['python', '-c', CREATE_DATABASE_PY], env);
  uvSync('migrate the E2E database', ['alembic', 'upgrade', 'head'], env);
  const server = spawn('uv', ['run', '--directory', serverDir, 'tassel-server'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = recentOutput(server);
  try {
    await waitUntilHealthy(server, output);
  } catch (error) {
    await stop(server);
    throw error;
  }
  console.log(
    `[e2e] The server is up at ${E2E_SERVER_URL}, on ${new URL(databaseUrl).pathname.slice(1)}.`,
  );
  return () => stop(server);
}

/** Runs `uv run <args>` in services/server and throws with its output if it fails. */
function uvSync(task: string, args: string[], env: NodeJS.ProcessEnv): void {
  const result = spawn.sync('uv', ['run', '--directory', serverDir, ...args], {
    env,
    encoding: 'utf8',
    timeout: 300_000,
  });
  if (result.error) throw new Error(`[e2e] Couldn't ${task}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`[e2e] Couldn't ${task} (exit ${result.status}):\n${result.stderr}`);
  }
}

async function isHealthy(): Promise<boolean> {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Polls the health route until it answers, the server exits, or the startup timeout passes. */
async function waitUntilHealthy(server: ChildProcess, output: string[]): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`[e2e] The server exited with ${server.exitCode}:\n${output.join('\n')}`);
    }
    if (await isHealthy()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const seconds = STARTUP_TIMEOUT_MS / 1_000;
  throw new Error(`[e2e] ${healthUrl} didn't answer within ${seconds} s:\n${output.join('\n')}`);
}

/** Keeps the last 100 lines the server printed, and keeps its pipes drained. */
function recentOutput(child: ChildProcess): string[] {
  const lines: string[] = [];
  const keep = (chunk: Buffer) => {
    lines.push(...chunk.toString().split(/\r?\n/).filter(Boolean));
    lines.splice(0, Math.max(0, lines.length - 100));
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  return lines;
}

/** Stops the server: uv forwards the termination to it. Forces it after 10 s. */
async function stop(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill();
  const force = setTimeout(() => server.kill('SIGKILL'), 10_000);
  await exited;
  clearTimeout(force);
}
