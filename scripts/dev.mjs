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
const STOP_TIMEOUT_MS = 10_000;
const isWindows = process.platform === 'win32';

// The desktop package's `dev` script, run directly rather than through `pnpm --filter`: pnpm
// signals a script's whole process group, so Electron would get each signal twice, from pnpm and
// from electron-vite, die of the second, and pnpm would report a failure on every Ctrl+C.
const DESKTOP_DEV_SCRIPT = 'electron-vite dev';
const requireFromDesktop = createRequire(join(desktopDir, 'package.json'));
const electronVite = join(
  dirname(requireFromDesktop.resolve('electron-vite/package.json')),
  'bin',
  'electron-vite.js',
);

/** Runs a setup step to completion, or throws with what failed. */
function step(task, command, args, cwd = root) {
  console.log(`[dev] ${task}…`);
  const result = spawn.sync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw new Error(`Couldn't ${task}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`Couldn't ${task} (${result.signal ?? `exit ${result.status}`}).`);
  }
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

/**
 * Starts a long-running process whose output lines carry a [name] prefix. Outside Windows, where
 * it would open a console window, each one runs in its own process group: Ctrl+C reaches only
 * dev.mjs, each child gets one signal, from stop(), and a stuck child's whole group can be killed.
 */
function start(name, command, args, { stopSignal, ...options }) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: !isWindows,
    ...options,
  });
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

/** Kills a child and everything it started: its process tree on Windows, its group elsewhere. */
function kill(child) {
  if (isWindows) {
    spawn.sync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // The group has already gone.
  }
}

/**
 * Sends every child the signal it quits on, then kills whatever still runs 10 s later. Windows has
 * no signals to forward, so there it ends each process tree at once.
 */
function stop(code) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  if (children.size === 0) process.exit(exitCode);
  for (const { child, stopSignal } of children.values()) {
    if (isWindows) kill(child);
    else child.kill(stopSignal);
  }
  setTimeout(() => {
    for (const [name, { child }] of children) {
      console.error(
        `[dev] ${name} didn't stop within ${STOP_TIMEOUT_MS / 1_000} s, so it's killed.`,
      );
      kill(child);
    }
  }, STOP_TIMEOUT_MS);
}

// SIGHUP: the terminal closed. The children's process groups don't get it.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => stop(0));

async function main() {
  const desktopDev = requireFromDesktop('./package.json').scripts?.dev;
  if (desktopDev !== DESKTOP_DEV_SCRIPT) {
    throw new Error(
      `apps/desktop's dev script is "${desktopDev}", but scripts/dev.mjs runs "${DESKTOP_DEV_SCRIPT}". Update scripts/dev.mjs to match.`,
    );
  }
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

  // electron-vite passes SIGINT on to Electron, which quits.
  start('app', process.execPath, [electronVite, 'dev'], {
    cwd: desktopDir,
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
