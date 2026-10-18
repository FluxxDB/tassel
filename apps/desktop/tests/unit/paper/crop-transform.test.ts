// How the paper panel fits the feed: the crop region (a window capture's content, or the whole
// frame) contain-fit and centred in the panel, in CSS pixels.
import { describe, expect, it } from 'vitest';
import { cropTransform } from '../../../src/renderer/src/paper/crop-transform';

const VIDEO = { w: 1920, h: 1440 };
const BOX = { w: 1000, h: 500 };

describe('cropTransform', () => {
  it('cropTransform: no crop is contain-fit; a 10% top crop scales up and shifts by the crop', () => {
    // 1920×1440 into 1000×500: the height limits, pillarboxed.
    const whole = cropTransform(VIDEO, null, BOX);
    expect(whole.scale).toBeCloseTo(500 / 1440, 6);
    expect(whole.x).toBeCloseTo((1000 - 1920 * whole.scale) / 2, 6);
    expect(whole.y).toBeCloseTo(0, 6);

    // Without its top 10%, the region is 1920×1296: larger on screen, and moved up by the crop.
    const cropped = cropTransform(VIDEO, { x: 0, y: 0.1, w: 1, h: 0.9 }, BOX);
    expect(cropped.scale).toBeCloseTo(500 / 1296, 6);
    expect(cropped.scale).toBeGreaterThan(whole.scale);
    expect(cropped.x).toBeCloseTo((1000 - 1920 * cropped.scale) / 2, 6);
    expect(cropped.y).toBeCloseTo(-0.1 * 1440 * cropped.scale, 6);
  });

  it('letterboxes a wide region, centring it vertically', () => {
    const t = cropTransform({ w: 1600, h: 400 }, null, { w: 800, h: 800 });
    expect(t).toEqual({ scale: 0.5, x: 0, y: 300 });
  });

  it('shows nothing until the video has a size', () => {
    expect(cropTransform({ w: 0, h: 0 }, null, BOX)).toEqual({ scale: 0, x: 0, y: 0 });
    expect(cropTransform(VIDEO, null, { w: 0, h: 0 })).toEqual({ scale: 0, x: 0, y: 0 });
  });
});
