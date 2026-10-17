import { ApiError, createApiClient, UnauthorizedError } from '@tassel/shared/api';
import { describe, expect, it } from 'vitest';
import type { UploadStats } from '../../../../src/renderer/src/paper/contracts';
import type { FrameMetaJson } from '../../../../src/renderer/src/paper/upload/frame-meta';
import { createFrameUploader } from '../../../../src/renderer/src/paper/upload/frame-uploader';
import {
  type FrameParts,
  FramesApiError,
  uploadFrame,
} from '../../../../src/renderer/src/paper/upload/frames-api';
import type { Clock } from '../../../../src/renderer/src/tutor/types';

/** A clock that only moves when the test says so. Timers due at the same time fire in order. */
class ManualClock implements Clock {
  private time = 0;
  private nextId = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.time;
  }
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + Math.max(0, ms), fn });
    return id;
  }
  clearTimeout(id: unknown): void {
    this.timers.delete(id as number);
  }
  get pendingTimers(): number {
    return this.timers.size;
  }
  /** Moves time forward, firing every timer that comes due, in time order. */
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort(([a, x], [b, y]) => x.at - y.at || a - b)[0];
      if (!due) break;
      const [id, timer] = due;
      this.timers.delete(id);
      this.time = timer.at;
      timer.fn();
    }
    this.time = end;
  }
}

/** Lets every settled promise run its callbacks. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

const META: FrameMetaJson = {
  reason: 'ink',
  source: 'fake-clip',
  captured_at: '2026-10-17T14:32:05.120Z',
  page_found: true,
  page_quad: null,
  crop_rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.25 },
  mask: { cols: 50, rows: 38, cells: [[5, 12]] },
  detector: { changed_cells: 1, ink_pixels: 31, erase_pixels: 0, version: 'p3.1' },
};

/** `'ok'`, or what the upload throws. */
type Outcome = unknown;

/**
 * An uploader on a manual clock whose uploads the test settles: each call waits until the test
 * calls `settle(outcome)`, or answers at once from `script` when the test gave one.
 */
function harness(options: { script?: Outcome[]; maxQueue?: number } = {}) {
  const clock = new ManualClock();
  const names = new Map<FrameParts, string>();
  const calls: Array<{ name: string; at: number }> = [];
  const waiting: Array<(outcome: Outcome) => void> = [];
  const stats: UploadStats[] = [];
  const script = options.script ? [...options.script] : undefined;

  const uploader = createFrameUploader({
    upload: (parts) => {
      calls.push({ name: names.get(parts) ?? '?', at: clock.now() });
      return new Promise((resolve, reject) => {
        const answer = (outcome: Outcome) =>
          outcome === 'ok' ? resolve({ id: 'frame' }) : reject(outcome);
        if (script) answer(script.length > 1 ? script.shift() : script[0]);
        else waiting.push(answer);
      });
    },
    onStats: (s) => stats.push(s),
    clock,
    maxQueue: options.maxQueue,
  });

  const frame = (name: string, reason: 'ink' | 'page' = 'ink'): FrameParts => {
    const parts: FrameParts = {
      full: new Blob([name]),
      crop: reason === 'ink' ? new Blob([name]) : null,
      meta: { ...META, reason, ...(reason === 'page' && { crop_rect: null, mask: null }) },
    };
    names.set(parts, name);
    return parts;
  };
  const enqueue = (...frames: FrameParts[]) => {
    for (const parts of frames) uploader.enqueue(parts);
  };
  /** Settles the oldest upload still waiting. */
  const settle = async (outcome: Outcome = 'ok') => {
    const answer = waiting.shift();
    if (!answer) throw new Error('no upload is waiting');
    answer(outcome);
    await flush();
  };
  const tick = async (ms: number) => {
    clock.advance(ms);
    await flush();
  };
  return {
    clock,
    uploader,
    frame,
    enqueue,
    settle,
    tick,
    names: () => calls.map((call) => call.name),
    times: () => calls.map((call) => call.at),
    last: (): UploadStats | undefined => stats.at(-1),
    stats,
  };
}

const serverError = () => new ApiError(503, { detail: 'busy' });
const tooSoon = (retryAfter?: string) =>
  new FramesApiError(
    new Response(null, { status: 429, headers: retryAfter ? { 'Retry-After': retryAfter } : {} }),
    { detail: 'too recent' },
  );

describe('createFrameUploader', () => {
  it('never uploads a screen frame, which leaves the device only when she asks', async () => {
    const h = harness();
    const screen: FrameParts = { ...h.frame('s'), meta: { ...META, source: 'screen' } };

    h.uploader.enqueue(screen);
    h.enqueue(h.frame('a'));
    await h.settle();

    expect(h.names()).toStrictEqual(['a']);
    expect(h.last()).toStrictEqual({ sent: 1, pending: 0, failed: 0, lastError: null });
  });

  it('uploads one at a time, in order', async () => {
    const h = harness();
    h.enqueue(h.frame('a'), h.frame('b', 'page'), h.frame('c'));
    await flush();
    expect(h.names()).toStrictEqual(['a']);
    expect(h.last()).toStrictEqual({ sent: 0, pending: 3, failed: 0, lastError: null });

    await h.settle();
    expect(h.names()).toStrictEqual(['a', 'b']);
    await h.settle();
    await h.settle();

    expect(h.names()).toStrictEqual(['a', 'b', 'c']);
    expect(h.last()).toStrictEqual({ sent: 3, pending: 0, failed: 0, lastError: null });
  });

  it('5xx retries at 1, 2 and 4 s, then fails with server', async () => {
    const h = harness({ script: [serverError()] });
    h.enqueue(h.frame('a'));
    await flush();
    await h.tick(999);
    expect(h.times()).toStrictEqual([0]);

    for (const ms of [1, 2000, 4000]) await h.tick(ms);

    expect(h.times()).toStrictEqual([0, 1000, 3000, 7000]);
    expect(h.last()).toStrictEqual({ sent: 0, pending: 0, failed: 1, lastError: 'server' });
    await h.tick(60_000);
    expect(h.times()).toHaveLength(4);
    expect(h.clock.pendingTimers).toBe(0);
  });

  it('a network error retries the same way, then fails with offline', async () => {
    const h = harness({ script: [new TypeError('Failed to fetch')] });
    h.enqueue(h.frame('a'));
    for (const ms of [0, 1000, 2000, 4000]) await h.tick(ms);

    expect(h.times()).toStrictEqual([0, 1000, 3000, 7000]);
    expect(h.last()).toStrictEqual({ sent: 0, pending: 0, failed: 1, lastError: 'offline' });
  });

  it('a retried upload that gets through counts as sent', async () => {
    const h = harness({ script: [serverError(), 'ok'] });
    h.enqueue(h.frame('a'));
    for (const ms of [0, 1000]) await h.tick(ms);
    expect(h.times()).toStrictEqual([0, 1000]);
    expect(h.last()).toStrictEqual({ sent: 1, pending: 0, failed: 0, lastError: null });
  });

  it('429 waits for Retry-After without spending an attempt', async () => {
    // Had the 429 spent an attempt, the third 5xx would have dropped the frame.
    const h = harness({
      script: [serverError(), tooSoon('3'), serverError(), serverError(), 'ok'],
    });
    h.enqueue(h.frame('a'));
    for (const ms of [0, 1000, 2999, 1, 2000, 4000]) await h.tick(ms);

    expect(h.times()).toStrictEqual([0, 1000, 4000, 6000, 10_000]);
    expect(h.last()).toStrictEqual({ sent: 1, pending: 0, failed: 0, lastError: null });
  });

  it('429 without Retry-After waits 1 s, and a sixth in a row fails with server', async () => {
    const h = harness({ script: [tooSoon()] });
    h.enqueue(h.frame('a'));
    for (let n = 0; n < 6; n++) await h.tick(n === 0 ? 0 : 1000);

    expect(h.times()).toStrictEqual([0, 1000, 2000, 3000, 4000, 5000]);
    expect(h.last()).toStrictEqual({ sent: 0, pending: 0, failed: 1, lastError: 'server' });
    expect(h.clock.pendingTimers).toBe(0);
  });

  it.each([413, 415, 422])('%i drops at once with rejected', async (status) => {
    const h = harness();
    h.enqueue(h.frame('a'), h.frame('b'));
    await flush();

    await h.settle(new ApiError(status, { detail: 'no' }));

    expect(h.names()).toStrictEqual(['a', 'b']);
    expect(h.last()).toStrictEqual({ sent: 0, pending: 1, failed: 1, lastError: 'rejected' });
    expect(h.clock.pendingTimers).toBe(0);
    await h.settle();
    expect(h.last()).toStrictEqual({ sent: 1, pending: 0, failed: 1, lastError: null });
  });

  it('UnauthorizedError drops the item with auth and the next upload still runs', async () => {
    const h = harness();
    h.enqueue(h.frame('a'), h.frame('b'));
    await flush();

    await h.settle(new UnauthorizedError());

    expect(h.last()).toStrictEqual({ sent: 0, pending: 1, failed: 1, lastError: 'auth' });
    expect(h.names()).toStrictEqual(['a', 'b']);
    await h.settle();
    expect(h.last()).toStrictEqual({ sent: 1, pending: 0, failed: 1, lastError: null });
  });

  it('404 stops the uploader with gone', async () => {
    const h = harness();
    h.enqueue(h.frame('a'), h.frame('b'));
    await flush();

    await h.settle(new ApiError(404, { detail: 'Session not found' }));

    // The session was deleted: nothing queued for it will ever be sent.
    expect(h.last()).toStrictEqual({ sent: 0, pending: 0, failed: 2, lastError: 'gone' });
    const reported = h.stats.length;
    h.enqueue(h.frame('c'));
    await h.tick(10_000);
    expect(h.names()).toStrictEqual(['a']);
    expect(h.stats).toHaveLength(reported);
  });

  it('a full queue drops the oldest ink item and keeps page items', async () => {
    const h = harness();
    h.enqueue(h.frame('a'), h.frame('b'), h.frame('c'), h.frame('d', 'page'));
    await flush();
    expect(h.last()).toStrictEqual({ sent: 0, pending: 4, failed: 0, lastError: null });

    h.enqueue(h.frame('e', 'page')); // drops b, the oldest queued ink; the page d stays
    expect(h.last()).toStrictEqual({ sent: 0, pending: 4, failed: 1, lastError: null });

    for (let n = 0; n < 4; n++) await h.settle();
    expect(h.names()).toStrictEqual(['a', 'c', 'd', 'e']);
    expect(h.last()).toStrictEqual({ sent: 4, pending: 0, failed: 1, lastError: null });
  });

  it('new ink can push out older ink', async () => {
    const h = harness();
    h.enqueue(h.frame('a'), h.frame('b', 'page'), h.frame('c'), h.frame('d', 'page'));
    await flush();

    h.enqueue(h.frame('e')); // drops c, the only queued ink
    for (let n = 0; n < 4; n++) await h.settle();

    expect(h.names()).toStrictEqual(['a', 'b', 'd', 'e']);
    expect(h.last()).toStrictEqual({ sent: 4, pending: 0, failed: 1, lastError: null });
  });

  it('a queue full of pages refuses new ink, and makes room for a new page', async () => {
    const h = harness();
    h.enqueue(h.frame('a'), h.frame('b', 'page'), h.frame('c', 'page'), h.frame('d', 'page'));
    await flush();

    h.enqueue(h.frame('e')); // ink can't push out a page: e itself is dropped
    h.enqueue(h.frame('f', 'page')); // the newest page wins over the oldest
    for (let n = 0; n < 4; n++) await h.settle();

    expect(h.names()).toStrictEqual(['a', 'c', 'd', 'f']);
    expect(h.last()).toStrictEqual({ sent: 4, pending: 0, failed: 2, lastError: null });
  });

  it('keeps maxQueue items waiting behind the one in flight', async () => {
    const h = harness({ maxQueue: 1 });
    h.enqueue(h.frame('a'), h.frame('b'), h.frame('c'));
    await flush();
    expect(h.last()).toStrictEqual({ sent: 0, pending: 2, failed: 1, lastError: null });
    await h.settle();
    await h.settle();
    expect(h.names()).toStrictEqual(['a', 'c']);
  });

  it('stop cancels a waiting retry, drops the queue and reports nothing more', async () => {
    const h = harness();
    h.enqueue(h.frame('a'), h.frame('b'));
    await flush();
    await h.settle(serverError());
    const reported = h.stats.length;

    h.uploader.stop();
    await h.tick(10_000);
    h.enqueue(h.frame('c'));
    await flush();

    expect(h.names()).toStrictEqual(['a']);
    expect(h.clock.pendingTimers).toBe(0);
    expect(h.stats).toHaveLength(reported);
  });

  it('stop ignores the upload still in flight', async () => {
    const h = harness();
    h.enqueue(h.frame('a'), h.frame('b'));
    await flush();
    const reported = h.stats.length;

    h.uploader.stop();
    await h.settle();

    expect(h.names()).toStrictEqual(['a']);
    expect(h.stats).toHaveLength(reported);
  });

  it.each([
    // The server answers a failed object store with a 503 inside CORS (P3-R22)...
    ['server', async () => Response.json({ detail: 'store down' }, { status: 503 })],
    // ...so only a request that never got an answer counts as offline.
    [
      'offline',
      async (): Promise<Response> => {
        throw new TypeError('Failed to fetch');
      },
    ],
  ] as const)('a real upload that keeps failing ends as %s', async (lastError, answer) => {
    const clock = new ManualClock();
    const api = createApiClient({
      baseUrl: 'http://127.0.0.1:8799',
      getToken: async () => 'token-1',
      refreshToken: async () => 'token-2',
      fetch: answer,
    });
    const stats: UploadStats[] = [];
    const uploader = createFrameUploader({
      upload: (parts) => uploadFrame(api, 'session-1', parts),
      onStats: (s) => stats.push(s),
      clock,
    });

    uploader.enqueue({ full: new Blob(['a']), crop: new Blob(['a']), meta: META });
    for (const ms of [0, 1000, 2000, 4000]) {
      clock.advance(ms);
      await flush();
    }

    expect(stats.at(-1)).toStrictEqual({ sent: 0, pending: 0, failed: 1, lastError });
  });
});
