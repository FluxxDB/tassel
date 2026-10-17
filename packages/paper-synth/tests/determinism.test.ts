import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { makeClip, renderFrame, writeMjpeg } from '../src/index.ts';

// Recorded on the first green run, on macOS. The windows-latest unit job must match it
// unchanged: that is the parity check that the bytes don't depend on the platform.
const GOLDEN_DFA_SHORT_160x120_NOISE =
  '28d9e35e860bffd346b2bebd6fa1aa545105dd2fd87e0b10ea6af8d0fc8f43b5';

const dir = mkdtempSync(join(tmpdir(), 'paper-synth-determinism-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const sha256 = (bytes: Uint8Array | Uint8ClampedArray) =>
  createHash('sha256').update(bytes).digest('hex');

describe('determinism', () => {
  it('renderFrame is pure', () => {
    const opts = { width: 320, height: 240, noise: true, frameIndex: 105 };
    const first = renderFrame(makeClip('dfa-demo'), 7000, opts);
    // Render other times in between, out of order, so every cache is exercised.
    const clip = makeClip('dfa-demo');
    renderFrame(clip, 30000, opts);
    renderFrame(clip, 1000, opts);
    renderFrame(clip, 7100, { ...opts, width: 160, height: 120 });
    expect(sha256(renderFrame(clip, 7000, opts))).toBe(sha256(first));
    expect(first).toHaveLength(320 * 240 * 4);

    // A page that moves, and a fresh sheet sliding in, go through the same caches.
    for (const [name, t] of [
      ['page-shift', 3200],
      ['slide-and-hold', 2200],
      ['page-flip', 12300],
      ['erase', 2700],
    ] as const) {
      const a = renderFrame(makeClip(name), t, opts);
      const other = makeClip(name);
      renderFrame(other, t + 2000, opts);
      renderFrame(other, t - 1000, opts);
      expect(sha256(renderFrame(other, t, opts)), name).toBe(sha256(a));
    }
  });

  it('seeds its noise with the frame index, and only there', () => {
    const clip = makeClip('dfa-short');
    const at = (frameIndex: number, noise: boolean) =>
      sha256(renderFrame(clip, 3000, { width: 160, height: 120, noise, frameIndex }));
    expect(at(1, true)).not.toBe(at(2, true));
    expect(at(1, true)).toBe(at(1, true));
    expect(at(1, false)).toBe(at(2, false));
  });

  it('writeMjpeg run twice gives the same SHA-256', async () => {
    const clip = makeClip('page-shift');
    const opts = { width: 160, height: 120, noise: true };
    const a = await writeMjpeg(clip, join(dir, 'a.mjpeg'), opts);
    const b = await writeMjpeg(makeClip('page-shift'), join(dir, 'b.mjpeg'), opts);
    expect(b).toEqual(a);
    expect(a.frames).toBe(360);
  });

  it('golden dfa-short at 160×120 with noise', async () => {
    const result = await writeMjpeg(makeClip('dfa-short'), join(dir, 'golden.mjpeg'), {
      width: 160,
      height: 120,
      noise: true,
    });
    expect(result.frames).toBe(600);
    expect(result.sha256).toBe(GOLDEN_DFA_SHORT_160x120_NOISE);
  });
});
