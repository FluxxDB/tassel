// `pnpm live`: the owner's live run on macOS. Real devices and live providers (R39):
//   1. Postgres and local S3, and the dev database's migrations.
//   2. The desktop app's main and preload (electron-vite build) and the Desk View helper.
//   3. The server on 8787, reading provider keys from TASSEL_VOICE_ENV_FILE. The server reads
//      the file itself; this script never opens it, and no key reaches the app.
//   4. The renderer's dev server (electron-vite dev --rendererOnly, http://localhost:5173), so
//      the board runs as in development, where tldraw needs no license key.
//   5. Tassel through LaunchServices, as scripts/camera.mjs does, so macOS asks for (and
//      remembers) camera and microphone access for Electron itself, not for the terminal.
// Quit Tassel or press Ctrl+C to stop everything this run started.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withCameraLifetime } from './camera-lifecycle.mjs';
import { cameraEnv, cameraSubprocessEnv, openArgs } from './paper-env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const desktopDir = join(root, 'apps', 'desktop');
const serverDir = join(root, 'services', 'server');
const electronApp = join(desktopDir, 'node_modules', 'electron', 'dist', 'Electron.app');
const mainEntry = join(desktopDir, 'out', 'main', 'index.js');
const logDir = join(root, '.cache', 'live');
const port = process.env.TASSEL_PORT || '8787';
const serverUrl = `http://127.0.0.1:${port}`;
const rendererUrl = 'http://localhost:5173';
const STARTUP_MS = 60_000;
/** Desktop settings only a smoke check sets; the owner's run leaves them unset. */
const FAKE_SETTINGS = [
  'TASSEL_FAKE_MIC',
  'TASSEL_FAKE_MIC_LOOP',
  'TASSEL_REQUIRE_FAKE_CAPTURE',
  'TASSEL_DEV_CONSOLE',
];

const requireFromDesktop = createRequire(join(desktopDir, 'package.json'));
const electronVite = join(
  dirname(requireFromDesktop.resolve('electron-vite/package.json')),
  'bin',
  'electron-vite.js',
);

async function answers(url, signal) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(1_000)]),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function main() {
  if (process.platform !== 'darwin') {
    console.log('[live] Desk View is macOS-only; use pnpm dev elsewhere.');
    return 1;
  }
  const envFile = process.env.TASSEL_VOICE_ENV_FILE;
  if (!envFile || !existsSync(envFile)) {
    console.error(
      '[live] Set TASSEL_VOICE_ENV_FILE to the server settings file that holds the provider keys.',
    );
    return 1;
  }
  const tag = randomUUID();
  return withCameraLifetime(
    async (run) => {
      async function step(task, command, args, cwd = root) {
        console.log(`[live] ${task}…`);
        const { done } = run.start(command, args, { cwd, stdio: 'inherit', detached: true });
        const { code } = await done;
        run.check();
        if (code !== 0) throw new Error(`Could not ${task}`);
      }
      async function waitFor(url, what, child) {
        const deadline = Date.now() + STARTUP_MS;
        while (!(await answers(url, run.signal))) {
          run.check();
          if (child.exitCode !== null || child.signalCode !== null) {
            throw new Error(`The ${what} exited`);
          }
          if (Date.now() > deadline) throw new Error(`The ${what} did not become ready`);
          await new Promise((done) => setTimeout(done, 250));
        }
        console.log(`[live] The ${what} is ready.`);
      }

      if (await answers(`${serverUrl}/v1/health`, run.signal)) {
        throw new Error(`Something already answers ${serverUrl}; stop it first`);
      }
      await step('start Postgres and local S3', 'docker', [
        'compose',
        'up',
        '-d',
        '--wait',
        'db',
        's3',
      ]);
      await step(
        'migrate the dev database',
        'uv',
        ['run', 'alembic', 'upgrade', 'head'],
        serverDir,
      );
      await step('build the desktop main and preload', 'pnpm', [
        '--filter',
        '@tassel/desktop',
        'build',
      ]);
      await step('build the Desk View helper', process.execPath, [
        join(root, 'scripts', 'native.mjs'),
        'build',
      ]);

      mkdirSync(logDir, { recursive: true });
      // The server's own output, keys never in it, goes to the terminal with a prefix-free pipe.
      const { child: server } = run.start('uv', ['run', 'tassel-server'], {
        cwd: serverDir,
        env: { ...process.env, TASSEL_PORT: port },
        stdio: ['ignore', 'inherit', 'inherit'],
        detached: true,
      });
      await waitFor(`${serverUrl}/v1/health`, 'server', server);

      const { child: renderer } = run.start(
        process.execPath,
        [electronVite, 'dev', '--rendererOnly'],
        {
          cwd: desktopDir,
          env: cameraSubprocessEnv(process.env),
          stdio: ['ignore', 'ignore', 'inherit'],
          detached: true,
        },
      );
      await waitFor(rendererUrl, 'renderer dev server', renderer);

      // Only desktop settings reach Electron (paper-env.mjs), plus the renderer's dev URL.
      const env = cameraEnv(process.env, { serverUrl });
      env.push(`TASSEL_HELPER_TAG=${tag}`, `ELECTRON_RENDERER_URL=${rendererUrl}`);
      // The smoke check's fakes (unset for the owner): a fake mic, no real capture, the console.
      for (const name of FAKE_SETTINGS) {
        if (process.env[name]) env.push(`${name}=${process.env[name]}`);
      }
      const debugPort = process.env.TASSEL_LIVE_CDP_PORT;
      const log = join(logDir, 'app.log');
      console.log('[live] Launching Tassel through LaunchServices.');
      console.log('[live] App output: .cache/live/app.log. Quit Tassel or press Ctrl+C to finish.');
      const { done } = run.start(
        'open',
        openArgs({
          electronApp,
          env,
          log,
          args: [
            mainEntry,
            ...(debugPort ? [`--remote-debugging-port=${debugPort}`] : []),
            `--tassel-camera-run=${tag}`,
          ],
        }),
        { env: cameraSubprocessEnv(process.env), stdio: 'ignore' },
      );
      const { code } = await done;
      return code;
    },
    { tag },
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      // Our own messages only: child errors can carry argv or environment values.
      console.error(
        `[live] Run failed${error instanceof Error && error.message.startsWith('Could not') ? `: ${error.message}` : ''}; everything this run started was stopped.`,
      );
      process.exitCode = 1;
    });
}
