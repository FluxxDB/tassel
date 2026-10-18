import { afterEach, expect, it, vi } from 'vitest';
import {
  registerImageStage,
  showImageOnStage,
} from '../../../src/renderer/src/features/chat/image-stage';

const ATTACHMENT = '0f6a1d2e-7b3c-4d5e-8f90-1a2b3c4d5e6f';

let off: Array<() => void> = [];
afterEach(() => {
  for (const unregister of off) unregister();
  off = [];
});

it('is false until a stage registers, so the sidebar opens the image in its own viewer', () => {
  expect(showImageOnStage(ATTACHMENT)).toBe(false);
});

it('shows the image through the registered stage, and true says it did', () => {
  const show = vi.fn();
  off.push(registerImageStage(show));
  expect(showImageOnStage(ATTACHMENT)).toBe(true);
  expect(show).toHaveBeenCalledWith(ATTACHMENT);
});

it('unregistering brings back the stage it replaced, and the last one leaves none', () => {
  const first = vi.fn();
  const second = vi.fn();
  const offFirst = registerImageStage(first);
  const offSecond = registerImageStage(second);
  offSecond();
  expect(showImageOnStage(ATTACHMENT)).toBe(true);
  expect(first).toHaveBeenCalledWith(ATTACHMENT);
  expect(second).not.toHaveBeenCalled();
  // Out of order: a stale unregister never removes the one in place.
  offSecond();
  expect(showImageOnStage(ATTACHMENT)).toBe(true);
  offFirst();
  expect(showImageOnStage(ATTACHMENT)).toBe(false);
});
