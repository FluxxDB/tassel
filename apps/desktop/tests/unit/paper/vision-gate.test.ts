import { expect, it, vi } from 'vitest';
import {
  captureBurst,
  inkUploadAllowed,
  laplacianVariance,
} from '../../../src/renderer/src/paper/vision-gate';

it('chooses the sharpest of three frames over 300ms', async () => {
  const frames = [10, 100, 30];
  const sleep = vi.fn(async (_ms: number) => {});
  const frame = await captureBurst(
    async () => frames.shift() ?? 0,
    (n) => n,
    sleep,
  );
  expect(frame).toBe(100);
  expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([150, 150]);
});
it('rejects blurry bursts and retries once after 300ms', async () => {
  const grab = vi.fn(async () => 1);
  const sleep = vi.fn(async (_ms: number) => {});
  await expect(captureBurst(grab, (n) => n, sleep)).rejects.toThrow('No sharp frame');
  expect(grab).toHaveBeenCalledTimes(6);
  expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([150, 150, 300, 150, 150]);
});
it('measures Laplacian variance, not overall brightness', () => {
  expect(laplacianVariance(new Uint8ClampedArray(25).fill(240), 5, 5)).toBe(0);
  const sharp = new Uint8ClampedArray(25);
  sharp[12] = 255;
  expect(laplacianVariance(sharp, 5, 5)).toBeGreaterThan(100);
});
it('limits ink to ten seconds except for large changes', () => {
  expect(inkUploadAllowed(9999, 0, 2, 100)).toBe(false);
  expect(inkUploadAllowed(10000, 0, 2, 100)).toBe(true);
  expect(inkUploadAllowed(100, 0, 25, 100)).toBe(true);
});
