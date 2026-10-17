import { describe, expect, it } from 'vitest';
import { findContentTop } from '../../../../src/renderer/src/paper/sources/content-crop';

/** A grey image: `pixel(x, y)` gives each value, 0–255. */
function image(width: number, height: number, pixel: (x: number, y: number) => number): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) gray[y * width + x] = pixel(x, y);
  }
  return gray;
}

/** Deterministic noise, 0–255, as a desk or a page full of ink would give. */
function noise(x: number, y: number): number {
  let seed = (x * 73_856_093) ^ (y * 19_349_663);
  seed = (seed ^ (seed >>> 13)) * 1_274_126_177;
  return (seed >>> 0) % 256;
}

/** A flat title bar `band` rows tall over noise; `extra` may draw on the bar. */
function windowCapture(
  width: number,
  height: number,
  band: number,
  extra?: (x: number, y: number) => number | null,
) {
  return image(width, height, (x, y) => {
    if (y >= band) return noise(x, y);
    return extra?.(x, y) ?? 236;
  });
}

describe('findContentTop', () => {
  it('a 40-row band over noise gives 40', () => {
    expect(findContentTop(windowCapture(640, 480, 40), 640, 480)).toBe(40);
  });

  it('noise from row 0 gives 0', () => {
    expect(findContentTop(image(640, 480, noise), 640, 480)).toBe(0);
  });

  it('a 40-row band with traffic-light circles at the left gives 40', () => {
    const lights = [
      { cx: 20, color: 80 },
      { cx: 40, color: 170 },
      { cx: 60, color: 120 },
    ];
    const gray = windowCapture(640, 480, 40, (x, y) => {
      const light = lights.find(({ cx }) => (x - cx) ** 2 + (y - 20) ** 2 <= 36);
      return light ? light.color : null;
    });
    expect(findContentTop(gray, 640, 480)).toBe(40);
  });

  it('a 10-row band at 720 high gives 0', () => {
    expect(findContentTop(windowCapture(1280, 720, 10), 1280, 720)).toBe(0);
  });

  it('stops where the shade changes, and at 15% of the height', () => {
    // A bar that turns into a different flat grey: the bar ends there.
    const twoTone = image(640, 480, (x, y) => (y < 30 ? 236 : y < 60 ? 200 : noise(x, y)));
    expect(findContentTop(twoTone, 640, 480)).toBe(30);
    // A blank capture: never more than the top 15%.
    expect(
      findContentTop(
        image(640, 480, () => 236),
        640,
        480,
      ),
    ).toBeLessThanOrEqual(Math.floor(0.15 * 480) + 1);
  });
});
