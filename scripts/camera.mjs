// Owner-only LaunchServices camera workflow. Importing this file does not launch anything.
// No environment values are logged; only desktop settings reach open/Electron.
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withCameraLifetime } from './camera-lifecycle.mjs';
import { cameraLaunch } from './paper-env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const desktopDir = join(root, 'apps', 'desktop');
const serverDir = join(root, 'services', 'server');
const electronApp = join(desktopDir, 'node_modules', 'electron', 'dist', 'Electron.app');
const mainEntry = join(desktopDir, 'out', 'main', 'index.js');
const logDir = join(root, '.cache', 'camera');
const SERVER_STARTUP_MS = 30_000;

export async function main() {
  if (process.platform !== 'darwin') {
    console.log('camera: skipped (Desk View is macOS-only)');
    return 0;
  }
  const tag = randomUUID();
  const serverUrl = (process.env.TASSEL_SERVER_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
  return withCameraLifetime(
    async (run) => {
      async function step(task, command, args, cwd = root) {
        console.log(`[camera] ${task}…`);
        const { done } = run.start(command, args, { cwd, stdio: 'inherit', detached: true });
        const { code } = await done;
        run.check();
        if (code !== 0) throw new Error(`Could not ${task}`);
      }
      async function isHealthy() {
        run.check();
        try {
          const response = await fetch(`${serverUrl}/v1/health`, {
            signal: AbortSignal.any([run.signal, AbortSignal.timeout(1_000)]),
          });
          return response.ok;
        } catch {
          return false;
        }
      }
      await step('build the desktop app', 'pnpm', ['--filter', '@tassel/desktop', 'build']);
      await step('build the Desk View helper', process.execPath, [
        join(root, 'scripts', 'native.mjs'),
        'build',
      ]);
      if (!(await isHealthy())) {
        const port = new URL(serverUrl).port || '8787';
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
        // Register the child and its error handler before the first readiness wait. A reused
        // server is never registered, so this invocation cannot stop someone else's server.
        const { child: server } = run.start('uv', ['run', 'tassel-server'], {
          cwd: serverDir,
          env: { ...process.env, TASSEL_PORT: port },
          stdio: 'ignore',
          detached: true,
        });
        const deadline = Date.now() + SERVER_STARTUP_MS;
        while (!(await isHealthy())) {
          run.check();
          if (server.exitCode !== null || server.signalCode !== null)
            throw new Error('The server exited');
          if (Date.now() > deadline) throw new Error('The server did not become ready');
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        console.log('[camera] The local server is ready.');
      } else {
        console.log('[camera] Using the running server.');
      }
      run.check();
      mkdirSync(logDir, { recursive: true });
      const launch = cameraLaunch(process.env, {
        electronApp,
        mainEntry,
        serverUrl,
        tag,
        log: join(logDir, 'app.log'),
      });
      console.log(launch.message);
      console.log(
        '[camera] App output: .cache/camera/app.log. Quit Tassel or press Ctrl+C to finish.',
      );
      const { done } = run.start(launch.command, launch.args, launch.options);
      const { code } = await done;
      // Even if open exits first, finally waits for the tagged app AND helper, with escalation.
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
    .catch(() => {
      // Child errors can contain argv/environment values. Never render them here.
      console.error('[camera] Run failed; shutdown was attempted for all owned processes.');
      process.exitCode = 1;
    });
}
