import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOTION, prefersReducedMotion } from '../../../src/renderer/src/board/motion';

afterEach(() => vi.unstubAllGlobals());

describe('MOTION', () => {
  it('has the board and marks durations and easings, fixed', () => {
    expect(MOTION).toEqual({
      revealMs: 180,
      drawMs: 320,
      fadeMs: 150,
      glideMs: 450,
      pulseMs: 600,
      cameraMs: 240,
      ease: 'cubic-bezier(0.16, 1, 0.3, 1)',
      glideEase: 'cubic-bezier(0.65, 0, 0.35, 1)',
    });
    expect(Object.isFrozen(MOTION)).toBe(true);
  });
});

describe('prefersReducedMotion', () => {
  it('is false where there is no window, as in Node', () => {
    expect(prefersReducedMotion()).toBe(false);
  });

  it('is false where matchMedia is missing, as in jsdom', () => {
    vi.stubGlobal('window', {});
    expect(prefersReducedMotion()).toBe(false);
  });

  it('follows prefers-reduced-motion: reduce', () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
    }));
    vi.stubGlobal('window', { matchMedia });
    expect(prefersReducedMotion()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    expect(prefersReducedMotion()).toBe(false);
  });
});
