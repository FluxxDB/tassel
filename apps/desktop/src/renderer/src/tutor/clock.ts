// The real clock, for the fake tutor's timeline. Tests drive a manual one instead.
import type { Clock } from './types';

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};
