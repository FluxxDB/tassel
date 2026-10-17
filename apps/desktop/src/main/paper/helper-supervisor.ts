// Runs the Desk View helper for the renderer: one process at a time, started and stopped
// through window.tassel.paper. The per-launch token goes to the helper in its env alone, and
// back to the renderer with the helper's URL.
import type { ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { HelperStart } from '../../shared/paper-bridge';

export interface HelperSupervisor {
  start(): Promise<HelperStart>;
  stop(): Promise<void>;
}

export interface HelperSupervisorDeps {
  /** The helper binary (helperPath), or null when there is none. */
  path: string | null;
  platform: NodeJS.Platform;
  /** TASSEL_HELPER_CLIP: the helper plays this instead of opening the camera. */
  clip: string | null;
  tag: string | null;
  requireFake: boolean;
  spawn: typeof nodeSpawn;
  randomToken(): string;
  readyTimeoutMs?: number;
  log(line: string): void;
}

/** A per-launch token: 32 random bytes in hex. */
export function helperToken(): string {
  return randomBytes(32).toString('hex');
}

const READY_TIMEOUT_MS = 5_000;
const KILL_AFTER_MS = 2_000;
/** The only parent variables the helper gets, besides its token and clip. */
const PASSED_ENV = ['PATH', 'HOME', 'TMPDIR'] as const;

interface Helper {
  child: ChildProcess;
  ready: Promise<HelperStart>;
  exited: Promise<void>;
}

export function createHelperSupervisor(deps: HelperSupervisorDeps): HelperSupervisor {
  // Off macOS there is no Desk View; with requireFake, only a clip may run.
  const unsupported = deps.platform !== 'darwin' || (deps.requireFake && deps.clip === null);
  let current: Helper | null = null;
  let stopping: Promise<void> | null = null;

  function launch(path: string): Helper {
    const token = deps.randomToken();
    const env: Record<string, string> = {};
    for (const name of PASSED_ENV) {
      const value = process.env[name];
      if (value !== undefined) env[name] = value;
    }
    env.TASSEL_HELPER_TOKEN = token;
    if (deps.clip !== null) env.TASSEL_HELPER_CLIP = deps.clip;
    // stdin stays open: when Electron dies, the helper sees EOF and exits.
    const child = deps.spawn(path, deps.tag ? ['--tag', deps.tag] : [], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let settled = false;
    let resolveReady: (result: HelperStart) => void = () => {};
    const ready = new Promise<HelperStart>((resolve) => {
      resolveReady = resolve;
    });
    let resolveExited: () => void = () => {};
    const exited = new Promise<void>((resolve) => {
      resolveExited = resolve;
    });
    const helper: Helper = { child, ready, exited };
    const settle = (result: HelperStart) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // A helper that failed to start is no use to a later start(), which spawns a fresh one.
      if (!result.ok && current === helper) current = null;
      resolveReady(result);
    };
    const gone = () => {
      if (current === helper) current = null;
      resolveExited();
    };

    const timeoutMs = deps.readyTimeoutMs ?? READY_TIMEOUT_MS;
    const timer = setTimeout(() => {
      deps.log(`[tassel] the Desk View helper sent no ready line within ${timeoutMs} ms`);
      child.kill('SIGKILL');
      settle({ ok: false, reason: 'timeout' });
    }, timeoutMs);

    let stdout = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (settled) return;
      stdout += chunk;
      const newline = stdout.indexOf('\n');
      if (newline === -1) return;
      const port = readyPort(stdout.slice(0, newline));
      if (port === null) {
        deps.log("[tassel] the Desk View helper's first line wasn't its ready line");
        child.kill('SIGKILL');
        settle({ ok: false, reason: 'spawn-failed' });
      } else {
        settle({ ok: true, url: `ws://127.0.0.1:${port}`, token });
      }
    });
    logLines(child.stderr, deps.log);

    child.on('error', (error: NodeJS.ErrnoException) => {
      deps.log(`[tassel] the Desk View helper: ${error.message}`);
      // No pid: it never started. Otherwise a signal failed, and the process runs on.
      if (child.pid !== undefined) return;
      settle({ ok: false, reason: error.code === 'ENOENT' ? 'missing-binary' : 'spawn-failed' });
      gone();
    });
    child.on('exit', (code, signal) => {
      deps.log(`[tassel] the Desk View helper exited (${signal ?? code})`);
      settle({ ok: false, reason: 'spawn-failed' });
      gone();
    });
    return helper;
  }

  return {
    async start() {
      if (unsupported) return { ok: false, reason: 'unsupported' };
      if (deps.path === null) return { ok: false, reason: 'missing-binary' };
      // A start during a stop (React StrictMode's remount) waits for the old helper to exit.
      while (stopping) await stopping;
      current ??= launch(deps.path);
      return current.ready;
    },

    stop() {
      const helper = current;
      if (!helper) return stopping ?? Promise.resolve();
      current = null;
      // SIGTERM at once, so a will-quit stop goes out before the app does; SIGKILL after 2 s.
      helper.child.kill('SIGTERM');
      const timer = setTimeout(() => helper.child.kill('SIGKILL'), KILL_AFTER_MS);
      const done: Promise<void> = helper.exited.finally(() => {
        clearTimeout(timer);
        if (stopping === done) stopping = null;
      });
      stopping = done;
      return done;
    },
  };
}

/** The port from the helper's ready line, {"event":"ready","port":<port>,"protocol":1}. */
function readyPort(line: string): number | null {
  let ready: unknown;
  try {
    ready = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof ready !== 'object' || ready === null) return null;
  const { event, port, protocol } = ready as Record<string, unknown>;
  const valid = event === 'ready' && protocol === 1 && Number.isInteger(port);
  return valid && (port as number) > 0 && (port as number) < 65_536 ? (port as number) : null;
}

/** Passes each whole line of a stream to log. */
function logLines(stream: NodeJS.ReadableStream | null, log: (line: string) => void): void {
  if (!stream) return;
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) if (line) log(line);
  });
  stream.on('end', () => {
    if (pending) log(pending);
  });
}
