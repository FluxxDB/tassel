// Sends the detector's frames to the server one at a time, in order, and reports how it goes.
//
// - At most `maxQueue` frames wait behind the one in flight. A full queue drops its oldest ink
//   frame, since a page event outlives ink.
// - A network error or a 5xx retries after 1, 2 and 4 s, then drops the frame (offline/server).
// - A 429 waits for its Retry-After (1 s without one) and spends no attempt, up to 5 times.
// - 413, 415, 422 or another 4xx drops the frame at once (rejected); so does a failed token
//   refresh (auth), and the uploader goes on with the next frame.
// - A 404 means the session was deleted: the uploader stops for good (gone).
// - Any success clears `lastError`.
// - A frame from the `screen` source is never sent, whoever enqueues it.
import { ApiError, UnauthorizedError } from '@tassel/shared/api';
import { systemClock } from '../../tutor/clock';
import type { Clock } from '../../tutor/types';
import type { UploadStats } from '../contracts';
import { type FrameParts, FramesApiError } from './frames-api';

type LastError = NonNullable<UploadStats['lastError']>;

/** What to do after a failed attempt. */
type Verdict =
  | { kind: 'retry'; lastError: 'offline' | 'server' }
  | { kind: 'wait'; ms: number }
  | { kind: 'drop'; lastError: LastError }
  | { kind: 'gone' };

const THROTTLE_LIMIT = 5;

function verdictFor(error: unknown): Verdict {
  if (error instanceof UnauthorizedError) return { kind: 'drop', lastError: 'auth' };
  if (!(error instanceof ApiError)) return { kind: 'retry', lastError: 'offline' }; // fetch failed
  if (error.status === 404) return { kind: 'gone' };
  if (error.status === 429) {
    const seconds = error instanceof FramesApiError ? error.retryAfterS : null;
    return { kind: 'wait', ms: (seconds ?? 1) * 1000 };
  }
  if (error.status >= 500) return { kind: 'retry', lastError: 'server' };
  return { kind: 'drop', lastError: 'rejected' };
}

export function createFrameUploader(opts: {
  upload(parts: FrameParts): Promise<unknown>;
  onStats(s: UploadStats): void;
  clock?: Clock;
  maxQueue?: number;
  retryDelaysMs?: number[];
}): { enqueue(parts: FrameParts): void; stop(): void } {
  const clock = opts.clock ?? systemClock;
  const maxQueue = opts.maxQueue ?? 3;
  const retryDelaysMs = opts.retryDelaysMs ?? [1000, 2000, 4000];
  const queue: FrameParts[] = [];
  let current: FrameParts | null = null;
  let timer: unknown = null;
  let stopped = false;
  let sent = 0;
  let failed = 0;
  let lastError: UploadStats['lastError'] = null;

  const report = () => {
    if (stopped) return;
    opts.onStats({ sent, pending: queue.length + (current ? 1 : 0), failed, lastError });
  };

  /** Makes room for `incoming` in a full queue. Returns false when `incoming` itself is dropped. */
  const makeRoom = (incoming: FrameParts): boolean => {
    let victim = queue.findIndex((parts) => parts.meta.reason === 'ink');
    if (victim === -1) {
      // Only pages are waiting. New ink is dropped; a new page replaces the oldest page.
      if (incoming.meta.reason === 'ink') return false;
      victim = 0;
    }
    queue.splice(victim, 1);
    return true;
  };

  const later = (ms: number, fn: () => void) => {
    timer = clock.setTimeout(() => {
      timer = null;
      fn();
    }, ms);
  };

  const next = () => {
    current = null;
    report();
    pump();
  };

  const attempt = async (parts: FrameParts, failures: number, waits: number): Promise<void> => {
    try {
      await opts.upload(parts);
    } catch (error) {
      if (stopped) return;
      const verdict = verdictFor(error);
      if (verdict.kind === 'retry' && failures < retryDelaysMs.length) {
        later(retryDelaysMs[failures], () => void attempt(parts, failures + 1, waits));
      } else if (verdict.kind === 'wait' && waits < THROTTLE_LIMIT) {
        later(verdict.ms, () => void attempt(parts, failures, waits + 1));
      } else if (verdict.kind === 'gone') {
        // The session was deleted, so nothing queued for it can ever be sent.
        failed += 1 + queue.length;
        queue.length = 0;
        lastError = 'gone';
        current = null;
        report();
        stopped = true;
      } else {
        // Refused, or out of retries, or a sixth 429 in a row, which is the server's trouble.
        failed += 1;
        lastError = verdict.kind === 'wait' ? 'server' : verdict.lastError;
        next();
      }
      return;
    }
    if (stopped) return;
    sent += 1;
    lastError = null;
    next();
  };

  function pump() {
    if (stopped || current || queue.length === 0) return;
    const parts = queue.shift() as FrameParts;
    current = parts;
    void attempt(parts, 0, 0);
  }

  return {
    enqueue(parts) {
      // A screen frame leaves the device only when she asks (spec §4.1), never on its own.
      if (stopped || parts.meta.source === 'screen') return;
      if (queue.length >= maxQueue) {
        failed += 1;
        if (!makeRoom(parts)) {
          report();
          return;
        }
      }
      queue.push(parts);
      report();
      pump();
    },
    stop() {
      stopped = true;
      if (timer !== null) clock.clearTimeout(timer);
      timer = null;
      queue.length = 0;
      current = null;
    },
  };
}
