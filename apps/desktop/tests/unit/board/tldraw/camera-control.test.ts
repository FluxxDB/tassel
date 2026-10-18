import { describe, expect, it } from 'vitest';
import { createCameraControl } from '../../../../src/renderer/src/board/tldraw/camera-control';

function camera() {
  let fits = 0;
  let stops = 0;
  const control = createCameraControl(
    () => {
      fits += 1;
    },
    () => {
      stops += 1;
    },
  );
  return { control, fits: () => fits, stops: () => stops };
}

describe('student camera ownership', () => {
  it('keeps an explicit student Fit through passive refits until Ada acts', () => {
    const c = camera();
    c.control.fit();
    expect(c.fits()).toBe(1);
    c.control.refit();
    expect(c.fits()).toBe(1);
    c.control.adaAction();
    expect(c.fits()).toBe(2);
  });

  it('holds student movement through resize and layout until the next Ada action', () => {
    const c = camera();
    c.control.studentMove();
    c.control.refit();
    expect(c.fits()).toBe(0);
    c.control.adaAction();
    expect(c.fits()).toBe(1);
    c.control.refit();
    expect(c.fits()).toBe(2);
  });

  it('coalesces Ada actions during a drag and fits only after release', () => {
    const c = camera();
    c.control.begin('pointer');
    c.control.adaAction();
    c.control.adaAction();
    c.control.studentMove();
    c.control.refit();
    expect(c.fits()).toBe(0);
    c.control.end('pointer');
    expect(c.fits()).toBe(1);
    expect(c.stops()).toBeGreaterThan(0);
  });

  it('waits for all overlapping pointer, pinch and wheel gestures', () => {
    const c = camera();
    c.control.begin('pointer');
    c.control.begin('pinch');
    c.control.begin('wheel');
    c.control.adaAction();
    c.control.end('pointer');
    c.control.end('pinch');
    expect(c.fits()).toBe(0);
    c.control.end('wheel');
    expect(c.fits()).toBe(1);
    c.control.end('wheel');
    expect(c.fits()).toBe(1);
  });

  it('keeps a completed student drag without Ada actions in place', () => {
    const c = camera();
    c.control.begin('pointer');
    c.control.end('pointer');
    c.control.refit();
    expect(c.fits()).toBe(0);
  });

  it('explicit Fit works while held and cancellation releases a pending fit', () => {
    const c = camera();
    c.control.studentMove();
    c.control.fit();
    expect(c.fits()).toBe(1);
    c.control.begin('pointer');
    c.control.adaAction();
    c.control.cancel();
    expect(c.fits()).toBe(2);
  });
});
