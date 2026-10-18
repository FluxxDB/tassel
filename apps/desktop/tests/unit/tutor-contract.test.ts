// @vitest-environment jsdom
// The voice contract's additions route through the session; word events remain for P6.
// The app reaches the shared contract through @tassel/shared's own exports.
import type { ApiClient } from '@tassel/shared/api';
import { ENVELOPE, parseServerEvent } from '@tassel/shared/voice';
import fixtures from '@tassel/shared/voice/fixtures.json';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStageStore } from '../../src/renderer/src/features/session/stage-store';
import { ApiProvider } from '../../src/renderer/src/lib/api';
import { FakeTutorClient } from '../../src/renderer/src/tutor/fake-client';
import type { Clock, TutorEvent } from '../../src/renderer/src/tutor/types';
import { useTutorSession } from '../../src/renderer/src/tutor/use-tutor-session';

/** A clock that stands still: its timers run only when the test calls `run`. */
function heldClock() {
  const timers = new Map<number, () => void>();
  let lastId = 0;
  const clock: Clock = {
    now: () => 0,
    setTimeout: (fn) => {
      lastId += 1;
      timers.set(lastId, fn);
      return lastId;
    },
    clearTimeout: (id) => {
      timers.delete(id as number);
    },
  };
  /** Runs every pending timer, and the ones they set, in the order they were set. */
  const run = () => {
    for (const [id, fn] of timers) {
      timers.delete(id);
      fn();
    }
  };
  return { clock, run };
}

/** Mounts useTutorSession on a FakeTutorClient that will play `events`, all at once. */
function sessionPlaying(events: TutorEvent[]) {
  const { clock, run } = heldClock();
  const client = new FakeTutorClient(
    { steps: events.map((event) => ({ at: 0, event })) },
    { clock },
  );
  const heard = vi.fn();
  client.on(heard);
  const PATCH = vi.fn();
  const api = { GET: vi.fn(), PATCH } as unknown as ApiClient;
  renderHook(() => useTutorSession('7c2a5f1e-0b3d-4e8a-9f6c-1d2e3f4a5b6c', client, true), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(ApiProvider, { client: api, children }),
  });
  const stageChanges = vi.fn();
  const unsubscribe = useStageStore.subscribe(stageChanges);
  const play = () => {
    try {
      act(run);
    } finally {
      unsubscribe();
    }
  };
  return { play, heard, stageChanges, PATCH };
}

const stage = () => useStageStore.getState();

beforeEach(() => stage().reset());

describe('useTutorSession and the voice contract', () => {
  it('useTutorSession ignores a word event', () => {
    const word: TutorEvent = { type: 'word', text: 'hi', lang: 'en' };
    const { play, heard, stageChanges } = sessionPlaying([word]);
    const before = stage();

    expect(play).not.toThrow();
    expect(heard).toHaveBeenCalledWith(word);
    expect(stageChanges).not.toHaveBeenCalled();
    expect(stage()).toBe(before);
  });

  it('routes live events and still follows the ones after them', () => {
    const { play, heard, stageChanges, PATCH } = sessionPlaying([
      { type: 'connection', status: 'reconnecting', attempt: 2 },
      { type: 'mic', status: 'denied' },
      { type: 'language', lang: 'ko' },
      { type: 'word', text: '네', lang: 'ko' },
      {
        type: 'voice-debug',
        event: { kind: 'route', lang: 'ko', stt: 'nova-3', llm: 'fake', tts: 'fake' },
      },
      { type: 'state', state: 'listening' },
    ]);
    const before = stage();

    expect(play).not.toThrow();
    expect(heard).toHaveBeenCalledTimes(6);
    // Connection, microphone and tutor state reach the stage.
    expect(stageChanges).toHaveBeenCalledTimes(3);
    expect(stage()).toEqual({
      ...before,
      tutorState: 'listening',
      connection: 'reconnecting',
      mic: 'denied',
    });
    expect(PATCH).not.toHaveBeenCalled();
  });
});

describe('the shared voice contract, as the app imports it', () => {
  // Vitest's resolver is lenient about package exports; the typecheck of this file (pnpm check)
  // is what fails when @tassel/shared stops exporting either subpath, as Node would.
  it('resolves @tassel/shared/voice and its fixtures', () => {
    expect(fixtures.server.length).toBeGreaterThan(0);
    for (const event of fixtures.server) {
      expect(parseServerEvent({ [ENVELOPE]: event })).toEqual(event);
    }
  });
});
