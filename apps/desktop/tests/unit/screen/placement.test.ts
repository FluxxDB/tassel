import { describe, expect, it } from 'vitest';
import {
  clampToArea,
  hudHome,
  hudPlacement,
  maskFor,
  positionKey,
} from '../../../src/main/overlay/placement';
import { screenDesired } from '../../../src/renderer/src/board/tldraw/screen';
import { nudgeDelta, validNudge } from '../../../src/shared/screen-bridge';

const primary = { x: 0, y: 0, width: 1440, height: 900 };
const primaryArea = { x: 0, y: 25, width: 1440, height: 875 };
/** A second display left of and above the primary: negative origin, its own work area. */
const offset = { x: -1920, y: -180, width: 1920, height: 1080 };
const offsetArea = { x: -1920, y: -155, width: 1920, height: 1040 };

describe('the overlay bar on a display', () => {
  it('starts at the bottom center of the work area, on an offset display too', () => {
    const home = hudHome(offsetArea);
    expect(home.width).toBe(720);
    expect(home.x).toBe(-1920 + (1920 - 720) / 2);
    expect(home.y).toBe(-155 + 1040 - 166 - 24);
    expect(hudPlacement(offsetArea, null)).toEqual(home);
  });

  it('comes back where it was left, clamped into the work area', () => {
    expect(hudPlacement(primaryArea, { x: 40, y: 60 })).toMatchObject({ x: 40, y: 60 });
    // Dragged half off the right edge last time: back inside.
    expect(hudPlacement(primaryArea, { x: 1400, y: 60 })).toMatchObject({ x: 1440 - 720, y: 60 });
    // Above the menu bar: down to the work area's top.
    expect(hudPlacement(primaryArea, { x: 40, y: 0 })).toMatchObject({ x: 40, y: 25 });
    // A position from another display, or nonsense, means home.
    expect(hudPlacement(primaryArea, { x: -1500, y: 60 })).toEqual(hudHome(primaryArea));
    expect(hudPlacement(primaryArea, { x: Number.NaN, y: 60 })).toEqual(hudHome(primaryArea));
  });

  it('keeps a dragged window inside an offset work area', () => {
    const bar = { x: -3000, y: 2000, width: 720, height: 166 };
    expect(clampToArea(bar, offsetArea)).toEqual({
      ...bar,
      x: -1920,
      y: -155 + 1040 - 166,
    });
  });

  it('remembers positions per display and work-area size', () => {
    expect(positionKey({ id: 7, workArea: primaryArea })).toBe('7:1440x875');
    expect(positionKey({ id: 7, workArea: offsetArea })).not.toBe(
      positionKey({ id: 7, workArea: primaryArea }),
    );
  });

  it('nudges with the arrow keys, a stride with Shift, and nothing else', () => {
    expect(nudgeDelta('ArrowLeft', false)).toEqual({ dx: -24, dy: 0 });
    expect(nudgeDelta('ArrowDown', true)).toEqual({ dx: 0, dy: 96 });
    expect(nudgeDelta('Enter', false)).toBeNull();
    expect(validNudge({ dx: 24, dy: 0 })).toBe(true);
    expect(validNudge({ dx: 1e9, dy: 0 })).toBe(false);
    expect(validNudge({ dx: 1.5, dy: 0 })).toBe(false);
    expect(validNudge(null)).toBe(false);
  });
});

describe('the frame and the marks share the display, whatever its scale or origin', () => {
  it('masks the bar at the same fractions on a 1x and a 2x display, and off-origin', () => {
    const bar = { x: 360, y: 710, width: 720, height: 166 };
    const mask = maskFor(bar, primary);
    expect(mask).toEqual({ x: 0.25, y: 710 / 900, width: 0.5, height: 166 / 900 });
    // Retina: bounds are device-independent, so the fractions do not change with the scale.
    expect(maskFor(bar, { ...primary })).toEqual(mask);
    const away = { x: -1920 + 600, y: -180 + 900, width: 720, height: 166 };
    expect(maskFor(away, offset)).toEqual({
      x: 600 / 1920,
      y: 900 / 1080,
      width: 720 / 1920,
      height: 166 / 1080,
    });
    // A bar at the display's origin never maps to the frame's far corner.
    expect(maskFor({ x: -1920, y: -180, width: 720, height: 166 }, offset)).toMatchObject({
      x: 0,
      y: 0,
    });
  });

  it('projects marks in display points: a 2x capture of the same display lands in the same place', () => {
    const marks = [
      {
        id: 'u',
        kind: 'underline' as const,
        author: 'tutor' as const,
        points: [
          { x: 0.6, y: 0.72 },
          { x: 0.9, y: 0.72 },
        ],
      },
      {
        id: 'c',
        kind: 'circle' as const,
        author: 'tutor' as const,
        points: [
          { x: 0.6, y: 0.5 },
          { x: 0.9, y: 0.7 },
        ],
      },
    ];
    // The overlay window is the display in points; the captured frame may be 2x as many pixels,
    // but the marks are fractions of the whole frame, so only the viewport's points matter.
    const one = screenDesired(marks, 1440, 900);
    const circle = one.shapes.get('shape:screen.c');
    expect(circle).toMatchObject({ x: 864, y: 450 });
    expect(Number(circle?.props.w)).toBeCloseTo(432);
    expect(Number(circle?.props.h)).toBeCloseTo(180);
    const line = one.shapes.get('shape:screen.u');
    expect(line).toMatchObject({ x: 864, y: 648 });
    const twice = screenDesired(marks, 2880, 1800).shapes.get('shape:screen.c');
    expect(twice).toMatchObject({ x: 1728, y: 900 });
    expect(Number(twice?.props.w)).toBeCloseTo(864);
    expect(Number(twice?.props.h)).toBeCloseTo(360);
  });
});
