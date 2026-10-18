// Resource ownership for LaunchServices camera runs. Importing this module launches nothing.
import spawn from 'cross-spawn';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withDeadline(work, ms, label) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function taggedProcesses(tag) {
  const result = spawn.sync('pgrep', ['-f', '--', tag], { encoding: 'utf8', timeout: 1_000 });
  if (result.error || (result.status !== 0 && result.status !== 1)) {
    throw new Error('Could not inspect camera processes');
  }
  return (result.stdout || '').trim().split('\n').filter(Boolean).map(Number);
}

function kill(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function processGroupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

export async function stopTaggedProcesses(
  tag,
  {
    list = () => taggedProcesses(tag),
    kill: send = kill,
    now = Date.now,
    delay = sleep,
    graceMs = 1_000,
  } = {},
) {
  // The waiter may die before Electron. Keep inspecting the tag shared by app AND helper.
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    const sent = new Set();
    const deadline = now() + graceMs;
    do {
      const pids = list();
      if (pids.length === 0) return;
      for (const pid of pids) {
        if (!sent.has(pid)) {
          send(pid, signal);
          sent.add(pid);
        }
      }
      await delay(50);
    } while (now() < deadline);
  }
  if (list().length) throw new Error('Camera processes remained after SIGKILL');
}

/** Install handlers before work starts; every exit uses the same idempotent shutdown. */
export async function withCameraLifetime(
  work,
  {
    tag,
    events = process,
    spawn: launch = spawn,
    stopTagged = () => stopTaggedProcesses(tag),
    childGraceMs = 2_000,
    groupAlive = processGroupAlive,
    killGroup = (pid, signal) => kill(-pid, signal),
  } = {},
) {
  const children = new Set();
  const controller = new AbortController();
  let shutdownPromise;
  let childError;
  const check = () => {
    if (childError) throw childError;
    if (controller.signal.aborted) throw new Error('Camera run is stopping');
  };
  const stopChild = (owned) => {
    if (owned.stopping) return owned.stopping;
    owned.stopping = Promise.resolve()
      .then(async () => {
        const { child, exited, detached } = owned;
        // Build/server wrappers can exit before their descendants. Only detached children
        // created by this invocation own a process group; never signal the caller's group.
        if (detached && child.pid) {
          for (const signal of ['SIGTERM', 'SIGKILL']) {
            if (!groupAlive(child.pid)) return;
            killGroup(child.pid, signal);
            const deadline = Date.now() + childGraceMs;
            while (groupAlive(child.pid) && Date.now() < deadline) await sleep(25);
          }
          if (groupAlive(child.pid)) throw new Error('Owned process group remained after SIGKILL');
          return;
        }
        if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
        child.kill('SIGTERM');
        try {
          await withDeadline(() => exited, childGraceMs, 'Child shutdown');
        } catch {
          child.kill('SIGKILL');
          await withDeadline(() => exited, childGraceMs, 'Child forced shutdown');
        }
      })
      .then(() => {
        // Retire completed resources immediately, not hours later when the camera quits:
        // the OS can reuse their process/group IDs once they are gone.
        children.delete(owned);
      });
    return owned.stopping;
  };
  const shutdown = () => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = Promise.resolve().then(async () => {
      const results = await Promise.allSettled([
        Promise.resolve().then(stopTagged),
        ...[...children].map(stopChild),
      ]);
      const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason);
      if (errors.length) throw new AggregateError(errors, 'Camera shutdown failed');
    });
    controller.abort();
    return shutdownPromise;
  };
  const onSignal = () => {
    void shutdown().catch(() => {});
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const signal of signals) events.on(signal, onSignal);
  const run = {
    check,
    shutdown,
    signal: controller.signal,
    start(command, args, options) {
      check();
      const child = launch(command, args, options);
      const exited = new Promise((resolve) => child.once('exit', resolve));
      const owned = { child, exited, detached: options.detached === true };
      children.add(owned);
      const done = new Promise((resolve) => {
        child.once('exit', (code, signal) => {
          void stopChild(owned)
            .then(() => resolve({ code: code ?? 1, signal }))
            .catch(() => {
              childError = new Error('Camera child shutdown failed');
              resolve({ code: 1, signal });
              onSignal();
            });
        });
        child.on('error', () => {
          childError = new Error('Camera child process failed');
          resolve({ code: 1, signal: null });
          onSignal();
        });
      });
      return { child, done };
    },
  };
  let result;
  const errors = [];
  try {
    result = await work(run);
    if (childError) throw childError;
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      await shutdown();
    } catch (error) {
      errors.push(error);
    }
    for (const signal of signals) events.removeListener(signal, onSignal);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, 'Camera run and shutdown failed');
  return result;
}
