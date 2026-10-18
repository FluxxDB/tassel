// Run the actual browser page finder under controlled synthetic webcam-like backgrounds.
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type Cv,
  findPageQuad,
  loadOpenCv,
} from '../../../src/renderer/src/paper/detector/opencv-page';

const require = createRequire(import.meta.url);
let cv: Cv;
beforeAll(async () => {
  cv = await loadOpenCv(async () => require('@techstark/opencv-js'));
}, 30_000);
const W = 640,
  H = 480;
function scene(background = 45, paper = 240, box = [160, 70, 480, 410]) {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const value =
        x >= (box[0] as number) &&
        x <= (box[2] as number) &&
        y >= (box[1] as number) &&
        y <= (box[3] as number)
          ? paper
          : background;
      rgba.set([value, value, value, 255], (y * W + x) * 4);
    }
  return rgba;
}
function rect(rgba: Uint8ClampedArray, box: number[], value: number) {
  for (let y = box[1] as number; y < (box[3] as number); y++)
    for (let x = box[0] as number; x < (box[2] as number); x++)
      rgba.set([value, value, value, 255], (y * W + x) * 4);
}
const find = (rgba: Uint8ClampedArray) => findPageQuad(cv, rgba, W, H);

describe('browser page finder audit: original limitations', () => {
  it('control: detects a high-contrast page with handwriting', () => {
    const rgba = scene();
    rect(rgba, [200, 130, 350, 133], 20);
    expect(find(rgba)).not.toBeNull();
  });
  it('misses the same page and writing against a bright background', () => {
    const rgba = scene(230, 245);
    rect(rgba, [200, 130, 350, 133], 20);
    expect(find(rgba)).toBeNull();
  });
  it('also accepts an empty bright rectangular panel, without document content', () => {
    expect(find(scene())).not.toBeNull();
  });
  it('misses a sheet smaller than 20% of the image', () => {
    expect(find(scene(45, 240, [250, 160, 390, 320]))).toBeNull();
  });
  it('rejects a page that reaches the camera frame edge', () => {
    expect(find(scene(45, 240, [0, 70, 480, 410]))).toBeNull();
  });
  it('rejects a good page when connected to bright surroundings', () => {
    const rgba = scene();
    rect(rgba, [0, 150, 170, 175], 240);
    expect(find(rgba)).toBeNull();
  });
  it('does not try the valid page when a larger oval is present', () => {
    const rgba = scene(45, 240, [360, 60, 620, 420]);
    expect(find(rgba)).not.toBeNull();
    for (let y = 20; y <= 460; y++)
      for (let x = 15; x <= 325; x++) {
        if (((x - 170) / 155) ** 2 + ((y - 240) / 220) ** 2 <= 1)
          rgba.set([240, 240, 240, 255], (y * W + x) * 4);
      }
    expect(find(rgba)).toBeNull();
  });
});
