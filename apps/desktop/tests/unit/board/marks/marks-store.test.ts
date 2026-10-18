import type { FrameRef, PaperAction, PaperMark, PaperTarget } from '@tassel/shared/beats';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAutomaton } from '../../../../src/renderer/src/board/automata/run';
import { FIXTURE_DFA_WRONG } from '../../../../src/renderer/src/board/marks/fixture-paper';
import {
  applyPaperAction,
  useMarksStore,
} from '../../../../src/renderer/src/board/marks/marks-store';
import { rectProjector } from '../../../../src/renderer/src/board/marks/project';
import {
  type LoadedFrame,
  registerSnapshotSource,
  type SnapshotSource,
} from '../../../../src/renderer/src/board/marks/snapshot-sources';

const store = () => useMarksStore.getState();

const FIXTURE: FrameRef = { kind: 'fixture', name: 'dfa-wrong' };
const FREEZE_FIXTURE: PaperAction = { kind: 'paper.freeze', frame: FIXTURE };

/** Freezes on a stored frame, with the fixture's elements so `el` targets resolve. */
const freezeFrame = (id: string): Extract<PaperAction, { kind: 'paper.freeze' }> => ({
  kind: 'paper.freeze',
  frame: { kind: 'frame', id },
  elements: FIXTURE_DFA_WRONG.elements,
});
const mark = (m: PaperMark): PaperAction => ({ kind: 'paper.mark', mark: m });
const step = (id: string, n: number, el: string): PaperAction =>
  mark({ type: 'step', id, n, target: { el } as PaperTarget });
const circle = (id: string, el: string): PaperAction =>
  mark({ type: 'circle', id, target: { el } as PaperTarget });

/** A frame as P3's source would load it: an image URL that must be revoked once unused. */
function urlFrame(capturedAt = '2026-10-17T14:32:00.000Z') {
  const revoke = vi.fn();
  const frame: LoadedFrame = {
    image: { kind: 'url', url: 'blob:app://tassel/frame-1', w: 960, h: 720, revoke },
    project: rectProjector(960, 720),
    capturedAt,
  };
  return { frame, revoke };
}

/** A source whose loads wait until the test settles them. */
function deferredSource() {
  const loads: Array<{
    ref: FrameRef;
    signal: AbortSignal;
    resolve(frame: LoadedFrame): void;
    reject(error: unknown): void;
  }> = [];
  const source: SnapshotSource = {
    load: (ref, { signal }) =>
      new Promise<LoadedFrame>((resolve, reject) => loads.push({ ref, signal, resolve, reject })),
  };
  return { source, loads };
}

/** Lets settled loads land: a few turns of the microtask queue. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

let unregister: Array<() => void> = [];
const register = (kind: FrameRef['kind'], source: SnapshotSource) => {
  unregister.push(registerSnapshotSource(kind, source));
};

beforeEach(() => store().reset());
afterEach(() => {
  for (const off of unregister) off();
  unregister = [];
  store().reset();
  vi.restoreAllMocks();
});

describe('the marks store', () => {
  it('freeze, then marks', async () => {
    applyPaperAction(FREEZE_FIXTURE);
    expect(store()).toMatchObject({ status: 'loading', snapshot: null, marks: [] });
    await flush();
    expect(store().status).toBe('frozen');
    expect(store().snapshot).toMatchObject({
      ref: FIXTURE,
      image: { kind: 'fixture', name: 'dfa-wrong', w: 1100, h: 850 },
      // The fixture source brings its own spec and elements.
      elements: FIXTURE_DFA_WRONG.elements,
      spec: FIXTURE_DFA_WRONG.spec,
    });
    expect(Number.isNaN(Date.parse(store().snapshot?.capturedAt ?? ''))).toBe(false);

    applyPaperAction(step('s1', 1, 'edge:q0>q0'));
    applyPaperAction(step('s2', 2, 'edge:q0>q1'));
    expect(store().marks.map((m) => m.id)).toEqual(['s1', 's2']);
  });

  it("marks sent while loading appear in order when it's ready", async () => {
    const { source, loads } = deferredSource();
    register('frame', source);
    applyPaperAction(freezeFrame('f1'));
    applyPaperAction(step('s1', 1, 'edge:q0>q0'));
    applyPaperAction(step('s2', 2, 'edge:q0>q1'));
    applyPaperAction({ kind: 'paper.unmark', id: 's1' });
    applyPaperAction(circle('c1', 'edge:q0>q0'));
    expect(store()).toMatchObject({ status: 'loading', marks: [] });
    expect(loads[0].ref).toEqual({ kind: 'frame', id: 'f1' });

    loads[0].resolve(urlFrame().frame);
    await flush();
    expect(store().status).toBe('frozen');
    expect(store().marks.map((m) => m.id)).toEqual(['s2', 'c1']);
  });

  it('a mark with no snapshot is dropped with one warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    applyPaperAction(step('s1', 1, 'edge:q0>q0'));
    expect(store()).toMatchObject({ status: 'live', snapshot: null, marks: [] });
    expect(warn).toHaveBeenCalledTimes(1);
    // Unmark and clear have nothing to remove, and say nothing.
    applyPaperAction({ kind: 'paper.unmark', id: 's1' });
    applyPaperAction({ kind: 'paper.clear' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a mark on ink the paper does not have is dropped with one warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    applyPaperAction(FREEZE_FIXTURE);
    await flush();
    applyPaperAction(circle('c9', 'state:q9'));
    applyPaperAction(circle('c1', 'state:q1'));
    expect(store().marks.map((m) => m.id)).toEqual(['c1']);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a second freeze replaces the snapshot and clears the marks', async () => {
    const { source, loads } = deferredSource();
    register('frame', source);
    applyPaperAction(freezeFrame('f1'));
    const first = urlFrame();
    loads[0].resolve(first.frame);
    await flush();
    applyPaperAction(circle('c1', 'edge:q0>q0'));
    expect(store().marks).toHaveLength(1);

    applyPaperAction(freezeFrame('f2'));
    expect(store()).toMatchObject({ status: 'loading', snapshot: null, marks: [] });
    expect(first.revoke).toHaveBeenCalledTimes(1);
    loads[1].resolve(urlFrame().frame);
    await flush();
    expect(store().status).toBe('frozen');
    expect(store().snapshot?.ref).toEqual({ kind: 'frame', id: 'f2' });
    expect(store().marks).toEqual([]);
  });

  it('a freeze aborts the load before it, and lets go of what that load brings late', async () => {
    const { source, loads } = deferredSource();
    register('frame', source);
    applyPaperAction(freezeFrame('f1'));
    applyPaperAction(freezeFrame('f2'));
    expect(loads[0].signal.aborted).toBe(true);
    expect(loads[1].signal.aborted).toBe(false);
    const late = urlFrame();
    loads[0].resolve(late.frame);
    await flush();
    expect(store().status).toBe('loading');
    expect(late.revoke).toHaveBeenCalledTimes(1);
    loads[1].resolve(urlFrame().frame);
    await flush();
    expect(store().snapshot?.ref).toEqual({ kind: 'frame', id: 'f2' });
  });

  it('elements and a spec in the freeze win over the frame’s own', async () => {
    const elements = { states: { a: { center: { x: 0.5, y: 0.5 }, r: 0.05 } }, edges: {} };
    const spec = { kind: 'dfa' as const, states: [{ id: 'a' }], start: 'a', transitions: [] };
    applyPaperAction({ kind: 'paper.freeze', frame: FIXTURE, elements, spec });
    await flush();
    expect(store().snapshot).toMatchObject({ elements, spec });
    // A frame that brings neither leaves them null.
    const { source, loads } = deferredSource();
    register('frame', source);
    applyPaperAction({ kind: 'paper.freeze', frame: { kind: 'frame', id: 'f1' } });
    loads[0].resolve(urlFrame().frame);
    await flush();
    expect(store().snapshot).toMatchObject({ elements: null, spec: null });
  });

  it('a mark with the same id replaces the old one', async () => {
    applyPaperAction(FREEZE_FIXTURE);
    await flush();
    applyPaperAction(circle('m1', 'state:q1'));
    applyPaperAction(step('s1', 1, 'edge:q0>q0'));
    applyPaperAction(step('m1', 3, 'state:q3'));
    expect(store().marks).toEqual([
      { type: 'step', id: 'm1', n: 3, target: { el: 'state:q3' } },
      { type: 'step', id: 's1', n: 1, target: { el: 'edge:q0>q0' } },
    ]);
  });

  it('unmark removes one mark, and clear removes them all but stays frozen', async () => {
    applyPaperAction(FREEZE_FIXTURE);
    await flush();
    applyPaperAction(step('s1', 1, 'edge:q0>q0'));
    applyPaperAction(step('s2', 2, 'edge:q0>q1'));
    applyPaperAction({ kind: 'paper.unmark', id: 's1' });
    expect(store().marks.map((m) => m.id)).toEqual(['s2']);
    applyPaperAction({ kind: 'paper.clear' });
    expect(store()).toMatchObject({ status: 'frozen', marks: [] });
    expect(store().snapshot?.ref).toEqual(FIXTURE);
  });

  it('a failed load shows failed and keeps the paper live', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    register('frame', {
      load: async () => {
        throw new Error('the frame is gone');
      },
    });
    applyPaperAction(freezeFrame('f1'));
    applyPaperAction(step('s1', 1, 'edge:q0>q0'));
    await flush();
    expect(store()).toMatchObject({ status: 'failed', snapshot: null, marks: [] });
    expect(warn).toHaveBeenCalledTimes(1);

    // No source for its kind (nothing in Task 7 registers `latest`): the same, at once.
    warn.mockClear();
    applyPaperAction({ kind: 'paper.freeze', frame: { kind: 'latest' } });
    expect(store()).toMatchObject({ status: 'failed', snapshot: null });
    expect(warn).toHaveBeenCalledTimes(1);

    // A source that throws instead of rejecting fails the same way.
    warn.mockClear();
    register('live', {
      load: () => {
        throw new Error('no camera');
      },
    });
    applyPaperAction({ kind: 'paper.freeze', frame: { kind: 'live' } });
    expect(store().status).toBe('failed');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('going live revokes the image', async () => {
    const { source, loads } = deferredSource();
    register('frame', source);
    applyPaperAction(freezeFrame('f1'));
    const first = urlFrame();
    loads[0].resolve(first.frame);
    await flush();
    applyPaperAction(circle('c1', 'state:q1'));
    store().goLive();
    expect(first.revoke).toHaveBeenCalledTimes(1);
    expect(store()).toMatchObject({ status: 'live', snapshot: null, marks: [] });

    // Ada's paper.live does the same.
    applyPaperAction(freezeFrame('f2'));
    const second = urlFrame();
    loads[1].resolve(second.frame);
    await flush();
    applyPaperAction({ kind: 'paper.live' });
    expect(second.revoke).toHaveBeenCalledTimes(1);
    expect(store().status).toBe('live');
  });

  it('going live or resetting aborts a load in flight', async () => {
    const { source, loads } = deferredSource();
    register('frame', source);
    applyPaperAction(freezeFrame('f1'));
    store().goLive();
    expect(loads[0].signal.aborted).toBe(true);
    applyPaperAction(freezeFrame('f2'));
    store().reset();
    expect(loads[1].signal.aborted).toBe(true);
    const late = urlFrame();
    loads[1].resolve(late.frame);
    await flush();
    expect(store()).toMatchObject({ status: 'live', snapshot: null, marks: [] });
    expect(late.revoke).toHaveBeenCalledTimes(1);
  });

  it('a trace sent while loading starts once ready', async () => {
    // The demo freezes and traces in one marker, so the trace lands mid-load (plan review C1).
    const { source, loads } = deferredSource();
    register('frame', source);
    applyPaperAction({ ...freezeFrame('f1'), spec: FIXTURE_DFA_WRONG.spec });
    applyPaperAction({ kind: 'paper.trace', input: '1010' });
    applyPaperAction(step('s1', 1, 'edge:q0>q0'));
    applyPaperAction({ kind: 'paper.traceStep' });
    applyPaperAction({ kind: 'paper.traceStep' });
    expect(store()).toMatchObject({ status: 'loading', trace: null, marks: [] });

    loads[0].resolve(urlFrame().frame);
    await flush();
    expect(store()).toMatchObject({
      status: 'frozen',
      trace: { run: runAutomaton(FIXTURE_DFA_WRONG.spec, '1010'), shown: 2 },
    });
    expect(store().marks.map((m) => m.id)).toEqual(['s1']);
  });

  it('clear while loading drops what came before it, and the rest still lands', async () => {
    const { source, loads } = deferredSource();
    register('frame', source);
    applyPaperAction({ ...freezeFrame('f1'), spec: FIXTURE_DFA_WRONG.spec });
    applyPaperAction(step('s1', 1, 'edge:q0>q0'));
    applyPaperAction({ kind: 'paper.trace', input: '1010' });
    applyPaperAction({ kind: 'paper.clear' });
    applyPaperAction(step('s2', 2, 'edge:q0>q1'));
    loads[0].resolve(urlFrame().frame);
    await flush();
    expect(store()).toMatchObject({ status: 'frozen', trace: null });
    expect(store().marks.map((m) => m.id)).toEqual(['s2']);
  });

  it("a trace runs on the snapshot's spec, steps like the board's, and freeze, clear and live end it", async () => {
    applyPaperAction(FREEZE_FIXTURE);
    await flush();
    applyPaperAction({ kind: 'paper.trace', input: '1010' });
    expect(store().trace).toEqual({ run: runAutomaton(FIXTURE_DFA_WRONG.spec, '1010'), shown: 0 });
    applyPaperAction({ kind: 'paper.traceStep' });
    expect(store().trace).toEqual({ run: runAutomaton(FIXTURE_DFA_WRONG.spec, '1010'), shown: 1 });
    applyPaperAction({ kind: 'paper.traceStep', step: 3 });
    expect(store().trace).toEqual({ run: runAutomaton(FIXTURE_DFA_WRONG.spec, '1010'), shown: 3 });

    applyPaperAction({ kind: 'paper.traceStep', step: 99 });
    expect(store().trace?.shown).toBe(4);
    applyPaperAction({ kind: 'paper.traceStep' });
    expect(store().trace?.shown).toBe(4);
    applyPaperAction({ kind: 'paper.traceStep', step: 0 });
    expect(store().trace?.shown).toBe(0);
    applyPaperAction({ kind: 'paper.clear' });
    expect(store()).toMatchObject({ status: 'frozen', trace: null });
    applyPaperAction({ kind: 'paper.trace', input: '11' });
    applyPaperAction(FREEZE_FIXTURE);
    expect(store().trace).toBeNull();
    await flush();
    applyPaperAction({ kind: 'paper.trace', input: '11' });
    store().goLive();
    expect(store().trace).toBeNull();
  });

  it('a trace with no spec to run, or a step with no trace, is skipped with one warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { source, loads } = deferredSource();
    register('frame', source);
    applyPaperAction(freezeFrame('f1'));
    loads[0].resolve(urlFrame().frame);
    await flush();
    applyPaperAction({ kind: 'paper.trace', input: '1010' });
    expect(store().trace).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    applyPaperAction({ kind: 'paper.traceStep' });
    expect(warn).toHaveBeenCalledTimes(2);
    // With no snapshot at all, both are dropped the way a mark is.
    store().goLive();
    applyPaperAction({ kind: 'paper.trace', input: '1010' });
    expect(warn).toHaveBeenCalledTimes(3);
    expect(store().trace).toBeNull();
  });

  it("reset starts a new session's clock for the snapshot's label (M1)", () => {
    store().reset(1_750_000);
    expect(store().sessionStartedAt).toBe(1_750_000);
    store().reset();
    expect(store().sessionStartedAt).toBeNull();
  });
});
