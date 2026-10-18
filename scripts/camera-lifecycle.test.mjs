import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import * as lifecycle from './camera-lifecycle.mjs';

function child() {
  const proc = new EventEmitter();
  Object.assign(proc, { pid: 42, exitCode: null, signalCode: null, kills: [] });
  proc.kill = (signal) => {
    proc.kills.push(signal);
    proc.signalCode = signal;
    proc.emit('exit', null, signal);
  };
  return proc;
}
function setup(proc = child()) {
  const events = new EventEmitter();
  let taggedStops = 0;
  return {
    proc,
    events,
    get taggedStops() {
      return taggedStops;
    },
    options: {
      tag: 'owned-run',
      events,
      spawn: () => proc,
      stopTagged: async () => {
        taggedStops += 1;
      },
      childGraceMs: 5,
    },
  };
}

test('startup failure still stops the server owned before the failure', async () => {
  assert.equal(typeof lifecycle.withCameraLifetime, 'function');
  const state = setup();
  await assert.rejects(
    lifecycle.withCameraLifetime(async (run) => {
      run.start('server', [], {});
      throw new Error('log directory failed');
    }, state.options),
    /log directory failed/,
  );
  assert.deepEqual(state.proc.kills, ['SIGTERM']);
  assert.equal(state.taggedStops, 1);
  assert.equal(state.events.listenerCount('SIGTERM'), 0);
});

test('signals during startup share one shutdown and prevent subsequent launches', async () => {
  assert.equal(typeof lifecycle.withCameraLifetime, 'function');
  const state = setup();
  await assert.rejects(
    lifecycle.withCameraLifetime(async (run) => {
      assert.equal(state.events.listenerCount('SIGTERM'), 1);
      run.start('server', [], {});
      state.events.emit('SIGTERM');
      state.events.emit('SIGINT');
      await run.shutdown();
      run.start('open', [], {});
    }, state.options),
    /stopping/,
  );
  assert.equal(state.taggedStops, 1);
  assert.deepEqual(state.proc.kills, ['SIGTERM']);
});

test('child spawn errors are handled and initiate shutdown', async () => {
  assert.equal(typeof lifecycle.withCameraLifetime, 'function');
  const state = setup();
  state.proc.pid = undefined;
  await assert.rejects(
    lifecycle.withCameraLifetime(async (run) => {
      const { done } = run.start('missing', [], {});
      state.proc.emit('error', new Error('ENOENT'));
      const result = await done;
      assert.equal(result.code, 1);
    }, state.options),
    /child process failed/,
  );
  assert.equal(state.taggedStops, 1);
});

test('a child already exited by signal is not killed or waited for again', async () => {
  assert.equal(typeof lifecycle.withCameraLifetime, 'function');
  const state = setup();
  await lifecycle.withCameraLifetime(async (run) => {
    run.start('server', [], {});
    state.proc.signalCode = 'SIGTERM';
    state.proc.emit('exit', null, 'SIGTERM');
  }, state.options);
  assert.deepEqual(state.proc.kills, []);
});

test('tagged cleanup waits for app/helper after waiter exit and escalates only remaining pids', async () => {
  assert.equal(typeof lifecycle.stopTaggedProcesses, 'function');
  const live = new Set([11, 12, 13]); // open, app, helper
  const kills = [];
  let now = 0;
  await lifecycle.stopTaggedProcesses('owned-run', {
    list: () => [...live],
    now: () => now,
    delay: async () => {
      now += 100;
    },
    kill: (pid, signal) => {
      kills.push([pid, signal]);
      if (pid === 11 || signal === 'SIGKILL') live.delete(pid);
    },
    graceMs: 200,
  });
  assert.equal(live.size, 0);
  assert.deepEqual(kills, [
    [11, 'SIGTERM'],
    [12, 'SIGTERM'],
    [13, 'SIGTERM'],
    [12, 'SIGKILL'],
    [13, 'SIGKILL'],
  ]);
});

test('a hung child receives bounded SIGKILL escalation', async () => {
  assert.equal(typeof lifecycle.withCameraLifetime, 'function');
  const state = setup();
  state.proc.kill = (signal) => {
    state.proc.kills.push(signal);
    if (signal === 'SIGKILL') {
      state.proc.signalCode = signal;
      state.proc.emit('exit', null, signal);
    }
  };
  await lifecycle.withCameraLifetime(async (run) => {
    run.start('server', [], {});
  }, state.options);
  assert.deepEqual(state.proc.kills, ['SIGTERM', 'SIGKILL']);
});

test('a signal raised while terminating a child cannot reenter shutdown', async () => {
  const state = setup();
  const kill = state.proc.kill;
  let interrupted = false;
  state.proc.kill = (signal) => {
    if (!interrupted) {
      interrupted = true;
      state.events.emit('SIGINT');
    }
    kill(signal);
  };
  await lifecycle.withCameraLifetime(async (run) => {
    run.start('server', [], {});
  }, state.options);
  assert.deepEqual(state.proc.kills, ['SIGTERM']);
  assert.equal(state.taggedStops, 1);
});

test('a child error does not count as process exit during shutdown', async () => {
  const state = setup();
  state.proc.kill = (signal) => {
    state.proc.kills.push(signal);
    if (signal === 'SIGKILL') {
      state.proc.signalCode = signal;
      state.proc.emit('exit', null, signal);
    }
  };
  await assert.rejects(
    lifecycle.withCameraLifetime(async (run) => {
      const { done } = run.start('server', [], {});
      state.proc.emit('error', new Error('child I/O failed'));
      await done;
    }, state.options),
    /child process failed/,
  );
  assert.deepEqual(state.proc.kills, ['SIGTERM', 'SIGKILL']);
});

test('owned startup groups are stopped even after the wrapper exited, with scoped escalation', async () => {
  const state = setup();
  let descendantsAlive = true;
  const groupSignals = [];
  state.options.groupAlive = (pid) => {
    assert.equal(pid, 42);
    return descendantsAlive;
  };
  state.options.killGroup = (pid, signal) => {
    groupSignals.push([pid, signal]);
    if (signal === 'SIGKILL') descendantsAlive = false;
  };
  await lifecycle.withCameraLifetime(async (run) => {
    run.start('build-wrapper', [], { detached: true });
    state.proc.exitCode = 0;
    state.proc.emit('exit', 0, null);
  }, state.options);
  assert.equal(descendantsAlive, false);
  assert.deepEqual(groupSignals, [
    [42, 'SIGTERM'],
    [42, 'SIGKILL'],
  ]);
  assert.deepEqual(state.proc.kills, []);
});

test('completed startup groups are retired before their numeric IDs can be reused', async () => {
  const state = setup();
  let groupExists = false;
  const signals = [];
  state.options.groupAlive = () => groupExists;
  state.options.killGroup = (pid, signal) => {
    signals.push([pid, signal]);
    groupExists = false;
  };
  await lifecycle.withCameraLifetime(async (run) => {
    const { done } = run.start('build-wrapper', [], { detached: true });
    state.proc.exitCode = 0;
    state.proc.emit('exit', 0, null);
    await done;
    // A long interactive camera session later, the OS reuses the completed group's ID.
    groupExists = true;
  }, state.options);
  assert.deepEqual(signals, []);
  assert.equal(groupExists, true);
});
