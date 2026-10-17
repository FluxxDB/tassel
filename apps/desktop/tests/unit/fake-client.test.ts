import { describe, expect, it, vi } from 'vitest';
import { createTutorClient } from '../../src/renderer/src/tutor/create-client';
import { FakeTutorClient } from '../../src/renderer/src/tutor/fake-client';
import dfaOpening from '../../src/renderer/src/tutor/scripts/dfa-opening.json';
import type { Clock, FakeScript, TutorEvent } from '../../src/renderer/src/tutor/types';
import type { AppConfig } from '../../src/shared/bridge';

/** A clock that only moves when the test says so. Timers due at the same time fire in order. */
class ManualClock implements Clock {
  private time = 0;
  private nextId = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.time;
  }
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + Math.max(0, ms), fn });
    return id;
  }
  clearTimeout(id: unknown): void {
    this.timers.delete(id as number);
  }
  /** Moves time forward, firing every timer that comes due, in time order. */
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort(([a, x], [b, y]) => x.at - y.at || a - b)[0];
      if (!due) break;
      const [id, timer] = due;
      this.timers.delete(id);
      this.time = timer.at;
      timer.fn();
    }
    this.time = end;
  }
}

const SCRIPT: FakeScript = {
  steps: [
    { at: 0, event: { type: 'state', state: 'connecting' } },
    { at: 800, event: { type: 'state', state: 'listening' } },
    {
      at: 1500,
      event: { type: 'caption', speaker: 'student', text: 'Hi Ada', lang: 'en', final: true },
    },
    { at: 1500, event: { type: 'title', title: 'Strings', subject: 'Automata' } },
    { at: 2000, event: { type: 'stage', mode: 'split' } },
  ],
};

function connected(script = SCRIPT, speed?: number) {
  const clock = new ManualClock();
  const client = new FakeTutorClient(script, { clock, speed });
  const seen: Array<{ at: number; event: TutorEvent }> = [];
  client.on((event) => seen.push({ at: clock.now(), event }));
  return { clock, client, seen };
}

describe('FakeTutorClient', () => {
  it('emits events in script order at their times', async () => {
    const { clock, client, seen } = connected();
    await client.connect('s-1');
    clock.advance(0);
    expect(seen.map((s) => s.event.type)).toEqual(['state']);
    clock.advance(2_000);
    expect(seen).toEqual(SCRIPT.steps.map(({ at, event }) => ({ at, event })));
  });

  it('speed 20 compresses time', async () => {
    const { clock, client, seen } = connected(SCRIPT, 20);
    await client.connect('s-1');
    clock.advance(99);
    expect(seen.map((s) => s.at)).toEqual([0, 40, 75, 75]);
    clock.advance(1);
    expect(seen.at(-1)).toEqual({ at: 100, event: { type: 'stage', mode: 'split' } });
  });

  it('disconnect stops further events', async () => {
    const { clock, client, seen } = connected();
    await client.connect('s-1');
    clock.advance(1_000);
    await client.disconnect();
    clock.advance(10_000);
    expect(seen.map((s) => s.event)).toEqual([
      { type: 'state', state: 'connecting' },
      { type: 'state', state: 'listening' },
    ]);
  });

  it('sendText emits a final student caption immediately', async () => {
    const { client, seen } = connected();
    await client.connect('s-1');
    client.sendText('I think that is it.');
    expect(seen.map((s) => s.event)).toEqual([
      { type: 'caption', speaker: 'student', text: 'I think that is it.', lang: 'en', final: true },
    ]);
  });

  it('starts the script over on a new connect, and stops listening when asked', async () => {
    const { clock, client, seen } = connected();
    await client.connect('s-1');
    clock.advance(900);
    await client.connect('s-1');
    clock.advance(0);
    expect(seen.map((s) => s.event)).toEqual([
      { type: 'state', state: 'connecting' },
      { type: 'state', state: 'listening' },
      { type: 'state', state: 'connecting' },
    ]);
    const other = vi.fn();
    const off = client.on(other);
    off();
    clock.advance(1_000);
    expect(other).not.toHaveBeenCalled();
  });

  it('says nothing before it connects', () => {
    const { client, seen } = connected();
    client.sendText('hello?');
    expect(seen).toEqual([]);
  });
});

describe('the dfa-opening script', () => {
  it('runs the brief’s opening, in order, ending with the 1010 question while Ada listens', () => {
    const steps = (dfaOpening as FakeScript).steps;
    expect(steps.map((s) => s.at)).toEqual([
      0, 800, 1500, 4500, 5000, 5200, 8500, 14000, 14200, 17000, 24000, 26000, 27500, 27600, 27700,
      33000,
    ]);
    expect(steps[3].event).toEqual({
      type: 'title',
      title: 'Strings that start with 010',
      subject: 'Automata · DFA',
    });
    expect(steps[13].event).toEqual({ type: 'stage', mode: 'split' });
    expect(steps[14].event).toEqual({
      type: 'caption',
      speaker: 'tutor',
      text: 'Before you move on, try running 1010 through your DFA. Where does it end up?',
      lang: 'en',
      final: true,
    });
    expect(steps.at(-1)?.event).toEqual({ type: 'state', state: 'listening' });
  });
});

describe('createTutorClient', () => {
  const config: AppConfig = {
    serverUrl: 'http://127.0.0.1:8799',
    uiLanguage: 'en',
    tutorMode: 'fake',
    fakeScript: 'dfa-opening',
    fakeSpeed: 20,
    tokenReset: false,
  };

  it('makes the scripted fake tutor', () => {
    expect(createTutorClient(config)).toBeInstanceOf(FakeTutorClient);
  });

  it('refuses the live tutor, which arrives in P2', () => {
    expect(() => createTutorClient({ ...config, tutorMode: 'live' })).toThrow(
      'live tutor arrives in P2',
    );
  });

  it('refuses a fake script it does not know', () => {
    expect(() => createTutorClient({ ...config, fakeScript: 'missing' })).toThrow(
      'Unknown fake tutor script "missing"',
    );
  });
});
