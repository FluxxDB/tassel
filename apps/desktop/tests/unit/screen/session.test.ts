import { describe, expect, it, vi } from 'vitest';
import { projectPoint, viewportChanged } from '../../../src/renderer/src/screen/geometry';
import { ScreenSession } from '../../../src/renderer/src/screen/session';

describe('screen reset boundary', () => {
  it('clears immediately, interrupts even with no marks, and rejects old results', async () => {
    const interrupt = vi.fn(async () => {});
    const session = new ScreenSession(interrupt);
    session.start('source');
    const before = session.identity();
    session.add(
      {
        id: 'a',
        kind: 'circle',
        points: [
          { x: 0.2, y: 0.3 },
          { x: 0.4, y: 0.5 },
        ],
        author: 'tutor',
      },
      before,
    );
    const pending = session.reset();
    expect(session.marks).toEqual([]);
    expect(session.accepts(before)).toBe(false);
    expect(interrupt).toHaveBeenCalledOnce();
    await pending;
    await session.reset();
    expect(interrupt).toHaveBeenCalledTimes(2);
  });
  it('does not restore old state when reset acknowledgments race', async () => {
    const session = new ScreenSession(async () => {});
    session.start('first');
    const old = session.identity();
    await session.reset();
    session.start('second');
    session.add({ id: 'late', kind: 'pointer', points: [{ x: 0, y: 0 }], author: 'tutor' }, old);
    expect(session.marks).toEqual([]);
  });
});

describe('display geometry', () => {
  it('maps normalized captures across negative origins and mixed DPI', () => {
    expect(projectPoint({ x: 0.5, y: 0.25 }, { x: -1280, y: 0, width: 1280, height: 720 })).toEqual(
      { x: -640, y: 180 },
    );
  });
  it('invalidates a viewport on motion, but tolerates tiny compression changes', () => {
    expect(viewportChanged(new Uint8Array(100).fill(100), new Uint8Array(100).fill(102))).toBe(
      false,
    );
    expect(viewportChanged(new Uint8Array(100), new Uint8Array(100).fill(200))).toBe(true);
  });
});

it('keeps preview marks inside the actual contained video', async () => {
  const { containRect } = await import('../../../src/renderer/src/screen/geometry');
  expect(containRect(1920, 1080, 1000, 1000)).toEqual({
    x: 0,
    y: 218.75,
    width: 1000,
    height: 562.5,
  });
});

it('keeps visible ink when the viewport changes but rejects pending old geometry', () => {
  const session = new ScreenSession(async () => {});
  session.start('display');
  const identity = session.identity();
  session.add(
    { id: 'student', kind: 'freehand', author: 'student', points: [{ x: 0.2, y: 0.3 }] },
    identity,
  );
  session.invalidate();
  expect(session.marks).toHaveLength(1);
  expect(session.accepts(identity)).toBe(false);
});

it('composites student strokes into the captured frame and excludes tutor marks', async () => {
  const { paintStudentInk } = await import('../../../src/renderer/src/screen/geometry');
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  };
  paintStudentInk(
    context as unknown as CanvasRenderingContext2D,
    [
      {
        id: 'student',
        author: 'student',
        kind: 'freehand',
        points: [
          { x: 0.2, y: 0.3 },
          { x: 0.4, y: 0.5 },
        ],
      },
      {
        id: 'tutor',
        author: 'tutor',
        kind: 'underline',
        points: [
          { x: 0.6, y: 0.7 },
          { x: 0.8, y: 0.9 },
        ],
      },
    ],
    1000,
    500,
  );
  expect(context.moveTo).toHaveBeenCalledExactlyOnceWith(200, 150);
  expect(context.lineTo).toHaveBeenCalledExactlyOnceWith(400, 250);
  expect(context.stroke).toHaveBeenCalledOnce();
});
