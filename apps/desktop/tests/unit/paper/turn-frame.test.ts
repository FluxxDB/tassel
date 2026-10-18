// The frame the server asks for at the start of each student turn (paper-frame): the current
// camera image, uploaded as a page with trigger "turn", so Ada sees her paper as it is now.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTurnFrameSender,
  registerTurnFrameSender,
  requestTurnFrame,
} from '../../../src/renderer/src/paper/turn-frame';

const NOW = new Date('2026-10-17T20:52:01.250Z');
const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });

afterEach(() => vi.restoreAllMocks());

describe('the turn frame', () => {
  it('uploads the current frame as a page, trigger turn, with no detector geometry', async () => {
    const grab = vi.fn(async () => jpeg);
    const upload = vi.fn(async () => ({}));
    const off = registerTurnFrameSender(
      createTurnFrameSender({ kind: 'deskview-helper', grab, upload, now: () => NOW }),
    );
    await requestTurnFrame();
    off();
    expect(grab).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith({
      full: jpeg,
      crop: null,
      meta: {
        reason: 'page',
        source: 'deskview-helper',
        captured_at: NOW.toISOString(),
        page_found: false,
        page_quad: null,
        crop_rect: null,
        mask: null,
        detector: { changed_cells: 0, ink_pixels: 0, erase_pixels: 0, version: expect.any(String) },
        trigger: 'turn',
      },
    });
  });

  it('does nothing without a live paper feed, and never throws', async () => {
    await expect(requestTurnFrame()).resolves.toBeUndefined();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const off = registerTurnFrameSender(async () => {
      throw new Error('track ended');
    });
    await expect(requestTurnFrame()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    off();
  });

  it('a stopped feed unregisters only its own sender', async () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    const offFirst = registerTurnFrameSender(first);
    const offSecond = registerTurnFrameSender(second);
    offFirst();
    await requestTurnFrame();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    offSecond();
  });
});
