import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHelperSupervisor, helperToken } from '../../../../src/main/paper/helper-supervisor';

const HELPER = '/repo/native/deskview-helper/.build/release/deskview-helper';
const TOKEN = 'ab'.repeat(32);

/** A child process the test drives: its ready line, stderr, errors and exit. */
class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  signals: string[] = [];
  kill(signal: string = 'SIGTERM'): boolean {
    this.signals.push(signal);
    return true;
  }
  ready(port = 54_321): void {
    this.stdout.write(`{"event":"ready","port":${port},"protocol":1}\n`);
  }
  exit(code: number | null = 0, signal: string | null = null): void {
    this.emit('exit', code, signal);
    this.emit('close', code, signal);
  }
  fail(code: string): void {
    this.emit('error', Object.assign(new Error(`spawn ${HELPER} ${code}`), { code }));
  }
}

type SpawnArgs = [string, string[], { env: Record<string, string>; stdio: unknown }];

function setup(overrides: Partial<Parameters<typeof createHelperSupervisor>[0]> = {}) {
  const children: FakeChild[] = [];
  const spawn = vi.fn((..._args: SpawnArgs) => {
    const child = new FakeChild();
    children.push(child);
    return child;
  });
  const log = vi.fn<(line: string) => void>();
  const helper = createHelperSupervisor({
    path: HELPER,
    platform: 'darwin',
    clip: null,
    tag: null,
    requireFake: false,
    spawn: spawn as unknown as Parameters<typeof createHelperSupervisor>[0]['spawn'],
    randomToken: () => TOKEN,
    log,
    ...overrides,
  });
  const spawned = (index = 0) => {
    const call = spawn.mock.calls[index];
    if (!call) throw new Error(`no spawn #${index}`);
    return { path: call[0], args: call[1], options: call[2] };
  };
  return { helper, spawn, children, log, spawned };
}

/** Lets pending promise callbacks run. */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
  vi.stubEnv('PATH', '/usr/bin:/bin');
  vi.stubEnv('HOME', '/Users/student');
  vi.stubEnv('TMPDIR', '/tmp/student');
  vi.stubEnv('TASSEL_SERVER_URL', 'http://127.0.0.1:8787');
  vi.stubEnv('SECRET_FROM_THE_SHELL', 'do-not-pass');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('createHelperSupervisor', () => {
  it('resolves url and token from the ready line', async () => {
    const { helper, children } = setup();
    const started = helper.start();
    await tick();
    children[0]?.ready(54_321);
    expect(await started).toEqual({ ok: true, url: 'ws://127.0.0.1:54321', token: TOKEN });
  });

  it('the token is 64 hex characters and reaches the child only through its env', async () => {
    expect(helperToken()).toMatch(/^[0-9a-f]{64}$/);
    expect(helperToken()).not.toBe(helperToken());

    const token = helperToken();
    const { helper, children, spawned } = setup({ randomToken: () => token });
    const started = helper.start();
    await tick();
    children[0]?.ready();
    await started;
    const { path, args, options } = spawned();
    expect(path).toBe(HELPER);
    expect(args.join(' ')).not.toContain(token);
    // Its env is exactly these: none of the parent's other variables.
    expect(options.env).toEqual({
      PATH: '/usr/bin:/bin',
      HOME: '/Users/student',
      TMPDIR: '/tmp/student',
      TASSEL_HELPER_TOKEN: token,
    });
    // stdin stays open, so the helper exits once Electron dies.
    expect(options.stdio).toEqual(['pipe', 'pipe', 'pipe']);
    expect(children[0]?.stdin.writableEnded).toBe(false);
  });

  it('passes the clip in the env when there is one', async () => {
    const { helper, children, spawned } = setup({ clip: '/clips/helper.mjpeg' });
    const started = helper.start();
    await tick();
    children[0]?.ready();
    await started;
    expect(spawned().options.env.TASSEL_HELPER_CLIP).toBe('/clips/helper.mjpeg');
  });

  it('passes --tag when a tag is set', async () => {
    const tagged = setup({ tag: 'spec-7' });
    void tagged.helper.start();
    await tick();
    expect(tagged.spawned().args).toEqual(['--tag', 'spec-7']);

    const plain = setup();
    void plain.helper.start();
    await tick();
    expect(plain.spawned().args).toEqual([]);
  });

  it('times out after 5 s and kills the child', async () => {
    vi.useFakeTimers();
    const { helper, children } = setup();
    const started = helper.start();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(children[0]?.signals).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await started).toEqual({ ok: false, reason: 'timeout' });
    expect(children[0]?.signals).toEqual(['SIGKILL']);
  });

  it('ENOENT is missing-binary; an exit before ready is spawn-failed', async () => {
    const missing = setup();
    const notThere = missing.helper.start();
    await tick();
    missing.children[0]?.fail('ENOENT');
    expect(await notThere).toEqual({ ok: false, reason: 'missing-binary' });

    const exits = setup();
    const early = exits.helper.start();
    await tick();
    exits.children[0]?.exit(64);
    expect(await early).toEqual({ ok: false, reason: 'spawn-failed' });

    const denied = setup();
    const notAllowed = denied.helper.start();
    await tick();
    denied.children[0]?.fail('EACCES');
    expect(await notAllowed).toEqual({ ok: false, reason: 'spawn-failed' });

    // A first line that isn't the ready line.
    const garbled = setup();
    const odd = garbled.helper.start();
    await tick();
    garbled.children[0]?.stdout.write('hello\n');
    expect(await odd).toEqual({ ok: false, reason: 'spawn-failed' });
    expect(garbled.children[0]?.signals).toEqual(['SIGKILL']);
  });

  it('no helper binary is missing-binary, without spawning', async () => {
    const { helper, spawn } = setup({ path: null });
    expect(await helper.start()).toEqual({ ok: false, reason: 'missing-binary' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('a second start reuses the process', async () => {
    const { helper, spawn, children } = setup();
    const first = helper.start();
    const second = helper.start();
    await tick();
    children[0]?.ready();
    const answers = await Promise.all([first, second, helper.start()]);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(new Set(answers.map((answer) => JSON.stringify(answer))).size).toBe(1);
  });

  it('a start during a stop waits for the exit, then spawns fresh', async () => {
    // React StrictMode mounts, unmounts and mounts again: start, stop, start.
    let tokens = 0;
    const { helper, spawn, children } = setup({ randomToken: () => `${++tokens}`.repeat(64) });
    const first = helper.start();
    await tick();
    children[0]?.ready(50_001);
    await first;

    const stopped = helper.stop();
    const restarted = helper.start();
    await tick();
    expect(children[0]?.signals).toEqual(['SIGTERM']);
    expect(spawn).toHaveBeenCalledTimes(1);

    children[0]?.exit(0);
    await stopped;
    await tick();
    expect(spawn).toHaveBeenCalledTimes(2);
    children[1]?.ready(50_002);
    expect(await restarted).toEqual({
      ok: true,
      url: 'ws://127.0.0.1:50002',
      token: '2'.repeat(64),
    });
  });

  it('stop sends SIGTERM, then SIGKILL after 2 s', async () => {
    vi.useFakeTimers();
    const { helper, children } = setup();
    const started = helper.start();
    await vi.advanceTimersByTimeAsync(0);
    children[0]?.ready();
    await started;

    let done = false;
    const stopped = helper.stop().then(() => {
      done = true;
    });
    // At once, so a will-quit stop goes out before the app does.
    expect(children[0]?.signals).toEqual(['SIGTERM']);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(children[0]?.signals).toEqual(['SIGTERM']);
    await vi.advanceTimersByTimeAsync(1);
    expect(children[0]?.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(done).toBe(false);
    children[0]?.exit(null, 'SIGKILL');
    await stopped;
    expect(done).toBe(true);
  });

  it('stop with nothing running resolves at once', async () => {
    const { helper, spawn } = setup();
    await helper.stop();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('unsupported off darwin, or with requireFake and no clip, without spawning', async () => {
    for (const platform of ['win32', 'linux'] as const) {
      const { helper, spawn } = setup({ platform });
      expect(await helper.start()).toEqual({ ok: false, reason: 'unsupported' });
      expect(spawn).not.toHaveBeenCalled();
    }
    const fakeOnly = setup({ requireFake: true });
    expect(await fakeOnly.helper.start()).toEqual({ ok: false, reason: 'unsupported' });
    expect(fakeOnly.spawn).not.toHaveBeenCalled();

    // With a clip, requireFake lets it run: the helper never touches the camera then.
    const withClip = setup({ requireFake: true, clip: '/clips/helper.mjpeg' });
    void withClip.helper.start();
    await tick();
    expect(withClip.spawn).toHaveBeenCalledTimes(1);
  });

  it('logs stderr lines', async () => {
    const { helper, children, log } = setup();
    void helper.start();
    await tick();
    children[0]?.stderr.write('[deskview-helper] tag spec-7\n[deskview-helper] listening');
    children[0]?.stderr.write(' on 127.0.0.1:54321\n');
    await tick();
    expect(log).toHaveBeenCalledWith('[deskview-helper] tag spec-7');
    expect(log).toHaveBeenCalledWith('[deskview-helper] listening on 127.0.0.1:54321');
  });

  it('an unexpected exit clears the handle', async () => {
    const { helper, spawn, children } = setup();
    const first = helper.start();
    await tick();
    children[0]?.ready();
    await first;
    children[0]?.exit(1);
    const second = helper.start();
    await tick();
    expect(spawn).toHaveBeenCalledTimes(2);
    children[1]?.ready(54_322);
    expect(await second).toMatchObject({ ok: true, url: 'ws://127.0.0.1:54322' });
  });
});
