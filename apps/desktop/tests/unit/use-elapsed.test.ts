// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatElapsed, useElapsed } from '../../src/renderer/src/features/session/use-elapsed';

afterEach(() => vi.useRealTimers());

describe('formatElapsed', () => {
  it.each([
    [0, '00:00'],
    [999, '00:00'],
    [9_000, '00:09'],
    [872_000, '14:32'],
    [3_599_999, '59:59'],
    [3_600_000, '1:00:00'],
    [3_723_000, '1:02:03'],
    [36_000_000, '10:00:00'],
  ])('%i ms reads %s', (ms, text) => {
    expect(formatElapsed(ms)).toBe(text);
  });

  it('never goes below zero', () => {
    expect(formatElapsed(-5_000)).toBe('00:00');
  });
});

describe('useElapsed', () => {
  it('counts up from its start every second, from the clock it is given', () => {
    let now = 1_000_000;
    vi.useFakeTimers();
    const start = new Date(now);
    const { result } = renderHook(() => useElapsed(start, () => now));
    expect(result.current).toBe('00:00');
    act(() => {
      now += 61_000;
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current).toBe('01:01');
  });
});
