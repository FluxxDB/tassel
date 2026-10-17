// The session timer: how long the session screen has been open (R7), as mm:ss, or h:mm:ss past
// an hour.
import { useEffect, useState } from 'react';

/** 872_000 ms → "14:32"; 3_723_000 ms → "1:02:03". Negative durations read "00:00". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1_000));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`;
  return `${String(minutes).padStart(2, '0')}:${seconds}`;
}

/**
 * The time since `start`, re-rendering on each whole second after it, so the seconds change
 * together with the clock that `now` reads.
 */
export function useElapsed(start: Date, now: () => number = Date.now): string {
  const [, tick] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const intoSecond = (now() - start.getTime()) % 1_000;
      timer = setTimeout(() => {
        tick((n) => n + 1);
        schedule();
      }, 1_000 - Math.max(0, intoSecond));
    };
    schedule();
    return () => clearTimeout(timer);
  }, [start, now]);
  return formatElapsed(now() - start.getTime());
}
