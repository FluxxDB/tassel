// `pnpm dev`: the whole local stack in one terminal.
//   1. Postgres and local S3 (frames): `docker compose up -d --wait db s3`.
//   2. The dev database's migrations: `uv run alembic upgrade head` in services/server.
//   3. On macOS, the Desk View helper: `node scripts/native.mjs build` (a warning, not a
//      failure, without Swift).
//   4. The server (`uv run tassel-server`, port 8787), then, once it answers, the desktop app
//      (`electron-vite dev` in apps/desktop), side by side with [server] and [app] logs.
//   5. Ctrl+C, or either one exiting, stops both.
// Paper uses the real source (R39): the Desk View camera on macOS. TASSEL_PAPER_SOURCE=fake-clip
// plays the generated demo clip instead, with real capture refused (scripts/paper-env.mjs).
// Every TASSEL_* setting in the shell reaches the app.
// cross-spawn runs docker, uv and node without a shell, so this runs on macOS and Windows.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import spawn from 'cross-spawn';
import { devPaperEnv } from './paper-env.mjs';

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

/** The demo clip (paper-synth's dfa-demo), generated into .cache/paper-clips if it's missing. */
function demoClip() {
  console.log('[dev] Getting the demo paper clip…');
  const genClip = join(root, 'packages', 'paper-synth', 'scripts', 'gen-clip.ts');
  const clips = join(root, '.cache', 'paper-clips');
  const result = spawn.sync(process.execPath, [genClip, '--variant', 'dfa-demo', '--out', clips], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Couldn't make the demo clip: ${result.error?.message ?? result.stderr}`);
  }
  const { mjpeg } = JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}');
  if (!mjpeg) throw new Error('gen-clip named no demo clip.');
  return mjpeg;
}

/** Builds the Desk View helper on macOS. Without Swift, paper says the camera is unavailable. */
function buildHelper() {
  if (process.platform !== 'darwin') return;
  console.log('[dev] Building the Desk View helper…');
  const result = spawn.sync(process.execPath, [join(root, 'scripts', 'native.mjs'), 'build'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    console.warn(
      "[dev] Warning: the Desk View helper didn't build (is Swift installed? xcode-select --install). Paper will say Desk View is unavailable.",
    );
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
  step('start Postgres and local S3', 'docker', ['compose', 'up', '-d', '--wait', 'db', 's3']);
  step('migrate the dev database', 'uv', ['run', 'alembic', 'upgrade', 'head'], serverDir);
  buildHelper();
  const paper = devPaperEnv(process.env, demoClip);
  console.log(
    paper.real
      ? '[dev] Paper: the real source (on macOS, the Desk View camera). For the demo clip instead: TASSEL_PAPER_SOURCE=fake-clip pnpm dev'
      : `[dev] Paper: ${process.env.TASSEL_PAPER_SOURCE}${paper.add.TASSEL_FAKE_CLIP ? ` on ${paper.add.TASSEL_FAKE_CLIP}` : ''}, no real camera.`,
  );

  // uv passes SIGTERM on to the server, which shuts down cleanly.
  const server = start('server', 'uv', ['run', 'tassel-server'], {
    cwd: serverDir,
    env: { ...process.env, TASSEL_TRANSCRIPT_DIR: join(root, '.cache/live/transcripts') },
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
      ...paper.add,
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
