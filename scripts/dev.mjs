// `pnpm dev`: the whole local stack in one terminal.
//   1. Postgres: `docker compose up -d --wait db`.
//   2. The dev database's migrations: `uv run alembic upgrade head` in services/server.
//   3. The server (`uv run tassel-server`, port 8787), then, once it answers, the desktop app
//      (`electron-vite dev` in apps/desktop), side by side with [server] and [app] logs.
//   4. Ctrl+C, or either one exiting, stops both.
// cross-spawn runs docker, uv and node without a shell, so this runs on macOS and Windows.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import spawn from 'cross-spawn';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = join(root, 'services', 'server');
const desktopDir = join(root, 'apps', 'desktop');
const port = process.env.TASSEL_PORT || '8787';
const healthUrl = `http://127.0.0.1:${port}/v1/health`;
const SERVER_STARTUP_MS = 30_000;

// The desktop package's `dev` script, `electron-vite dev`, run directly rather than through
// `pnpm --filter`: pnpm signals a script's whole process group, so Electron would get each
// signal twice, from pnpm and from electron-vite, die of the second, and pnpm would report a
// failure on every Ctrl+C. Instead, outside Windows the app runs in its own process group, out
// of Ctrl+C's reach, and stop() sends electron-vite a single SIGINT, which it passes to Electron.
const electronVite = join(
  dirname(createRequire(join(desktopDir, 'package.json')).resolve('electron-vite/package.json')),
  'bin',
  'electron-vite.js',
);

/** Runs a setup step to completion, or throws with what failed. */
function step(task, command, args, cwd = root) {
  console.log(`[dev] ${task}…`);
  const result = spawn.sync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw new Error(`Couldn't ${task}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Couldn't ${task} (exit ${result.status}).`);
}

async function isHealthy() {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

const children = new Map();
let stopping = false;
let exitCode = 0;

/** Starts a long-running process whose output lines carry a [name] prefix. */
function start(name, command, args, { stopSignal, ...options }) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  children.set(name, { child, stopSignal });
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => console.log(`[${name}] ${line}`));
  }
  child.on('error', (error) => {
    console.error(`[dev] Couldn't start ${name}: ${error.message}`);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    children.delete(name);
    if (!stopping) {
      console.log(`[dev] ${name} stopped (${signal ?? `exit ${code}`}), so the rest stops too.`);
      stop(code ?? 1);
    }
    if (children.size === 0) process.exit(exitCode);
  });
  return child;
}

/**
 * Stops every child with the signal it quits on. Windows has no signals to forward, so there it
 * ends each process tree.
 */
function stop(code) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  if (children.size === 0) process.exit(exitCode);
  for (const { child, stopSignal } of children.values()) {
    if (process.platform === 'win32') {
      spawn.sync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill(stopSignal);
    }
  }
}

// SIGHUP: the terminal closed, and the app's process group doesn't get that either.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => stop(0));

async function main() {
  if (await isHealthy()) {
    throw new Error(`Something already answers ${healthUrl}. Stop it, then rerun pnpm dev.`);
  }
  step('start Postgres', 'docker', ['compose', 'up', '-d', '--wait', 'db']);
  step('migrate the dev database', 'uv', ['run', 'alembic', 'upgrade', 'head'], serverDir);

  // uv passes SIGTERM on to the server, which shuts down cleanly.
  const server = start('server', 'uv', ['run', 'tassel-server'], {
    cwd: serverDir,
    stopSignal: 'SIGTERM',
  });
  const deadline = Date.now() + SERVER_STARTUP_MS;
  while (!(await isHealthy())) {
    if (stopping || server.exitCode !== null) return;
    if (Date.now() > deadline) {
      console.error(`[dev] ${healthUrl} didn't answer within ${SERVER_STARTUP_MS / 1_000} s.`);
      stop(1);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.log(`[dev] The server is up at http://127.0.0.1:${port}. Starting the app…`);

  start('app', process.execPath, [electronVite, 'dev'], {
    cwd: desktopDir,
    // A new console window on Windows, so only elsewhere.
    detached: process.platform !== 'win32',
    stopSignal: 'SIGINT',
    env: {
      ...process.env,
      // The plaintext token store keeps dev runs free of keychain prompts.
      TASSEL_TOKEN_STORE: process.env.TASSEL_TOKEN_STORE || 'file',
      TASSEL_SERVER_URL: process.env.TASSEL_SERVER_URL || `http://127.0.0.1:${port}`,
    },
  });
}

main().catch((error) => {
  console.error(`[dev] ${error.message}`);
  stop(1);
});
