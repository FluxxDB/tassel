// `node scripts/camera.mjs`: Tassel on the real Desk View camera, for the owner at the Mac.
//   1. Builds the desktop app and the Desk View helper.
//   2. Uses the server at TASSEL_SERVER_URL (default http://127.0.0.1:8787) if it answers;
//      otherwise starts the local stack (Postgres, S3, migrations, the server) and stops it after.
//   3. Launches Electron through LaunchServices (`open -n -W -a Electron.app --env …`), so macOS
//      treats it as its own responsible process and uses Electron's camera grant, not the
//      terminal's (Task 1's checks H and E). It passes the shell's TASSEL_* settings, with
//      TASSEL_PAPER_SOURCE=auto by default, and never TASSEL_REQUIRE_FAKE_CAPTURE.
//   4. Exits when the app quits. Ctrl+C quits the app first.
// The app's own output goes to .cache/camera/app.log (no frames). On any OS but macOS it prints
// a skip line and exits 0: Desk View is macOS-only.
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import spawn from 'cross-spawn';
import { cameraEnv, openArgs } from './paper-env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const desktopDir = join(root, 'apps', 'desktop');
const serverDir = join(root, 'services', 'server');
const electronApp = join(desktopDir, 'node_modules', 'electron', 'dist', 'Electron.app');
const mainEntry = join(desktopDir, 'out', 'main', 'index.js');
const logDir = join(root, '.cache', 'camera');
const serverUrl = (process.env.TASSEL_SERVER_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const SERVER_STARTUP_MS = 30_000;

if (process.platform !== 'darwin') {
  console.log('camera: skipped (Desk View is macOS-only)');
  process.exit(0);
}

function step(task, command, args, cwd = root) {
  console.log(`[camera] ${task}…`);
  const result = spawn.sync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw new Error(`Couldn't ${task}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Couldn't ${task} (exit ${result.status}).`);
}

async function isHealthy() {
  try {
    const response = await fetch(`${serverUrl}/v1/health`, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Starts the local server, if nothing answers, and returns a function that stops it. */
async function ensureServer() {
  if (await isHealthy()) {
    console.log(`[camera] Using the server at ${serverUrl}.`);
    return async () => {};
  }
  const port = new URL(serverUrl).port || '8787';
  step('start Postgres and local S3', 'docker', ['compose', 'up', '-d', '--wait', 'db', 's3']);
  step('migrate the dev database', 'uv', ['run', 'alembic', 'upgrade', 'head'], serverDir);
  const server = spawn('uv', ['run', 'tassel-server'], {
    cwd: serverDir,
    env: { ...process.env, TASSEL_PORT: port },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [server.stdout, server.stderr]) {
    createInterface({ input: stream }).on('line', (line) => console.log(`[server] ${line}`));
  }
  const deadline = Date.now() + SERVER_STARTUP_MS;
  while (!(await isHealthy())) {
    if (server.exitCode !== null) throw new Error(`The server exited (${server.exitCode}).`);
    if (Date.now() > deadline) {
      server.kill();
      throw new Error(`${serverUrl} didn't answer within ${SERVER_STARTUP_MS / 1_000} s.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.log(`[camera] The server is up at ${serverUrl}.`);
  return async () => {
    if (server.exitCode !== null) return;
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    const force = setTimeout(() => server.kill('SIGKILL'), 10_000);
    await exited;
    clearTimeout(force);
  };
}

async function main() {
  step('build the desktop app', 'pnpm', ['--filter', '@tassel/desktop', 'build']);
  step('build the Desk View helper', process.execPath, [
    join(root, 'scripts', 'native.mjs'),
    'build',
  ]);
  const stopServer = await ensureServer();

  // A marker on Electron's command line, so Ctrl+C quits exactly this app.
  const run = `--tassel-camera-run=${randomUUID()}`;
  mkdirSync(logDir, { recursive: true });
  const log = join(logDir, 'app.log');
  const env = cameraEnv(process.env, { serverUrl });
  console.log(`[camera] Launching Tassel through LaunchServices with ${env.join(' ')}`);
  console.log(`[camera] Its output goes to ${log}. Quit Tassel (or press Ctrl+C) to finish.`);
  const app = spawn('open', openArgs({ electronApp, env, log, args: [mainEntry, run] }), {
    stdio: 'inherit',
  });
  // `--` ends pkill's options: the marker itself starts with dashes.
  const quit = () => spawn.sync('pkill', ['-f', '--', run], { stdio: 'ignore' });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, quit);
  const code = await new Promise((resolve) => app.once('exit', (exit) => resolve(exit ?? 1)));
  console.log('[camera] Tassel quit.');
  await stopServer();
  process.exit(code);
}

main().catch((error) => {
  console.error(`[camera] ${error.message}`);
  process.exit(1);
});
