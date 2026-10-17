import type { AutomatonSpec } from '@tassel/shared/beats';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLayoutClient,
  getLayoutClient,
} from '../../../../src/renderer/src/board/layout/client';
import type {
  FromLayoutWorker,
  ToLayoutWorker,
} from '../../../../src/renderer/src/board/layout/messages';
import { layoutWithViz } from '../../../../src/renderer/src/board/layout/viz';
import { CORRECT, WRONG } from '../fixtures';

/** How a fake worker answers a message; null for never. */
type Answer = (message: ToLayoutWorker) => Promise<FromLayoutWorker | null>;

/** Graphviz in-process, answering as worker.ts does. */
const viaViz: Answer = async ({ id, spec }) => {
  try {
    return { id, layout: await layoutWithViz(spec) };
  } catch (error) {
    return { id, error: error instanceof Error ? error.message : String(error) };
  }
};

const never: Answer = () => new Promise(() => {});

/** A Worker stand-in that answers in-process, without a thread. */
class FakeWorker {
  onmessage: ((event: MessageEvent<FromLayoutWorker>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly sent: ToLayoutWorker[] = [];
  readonly terminate = vi.fn();

  constructor(private readonly answer: Answer) {}

  postMessage(message: ToLayoutWorker): void {
    // A message crosses to a worker as a structured clone.
    const copy = structuredClone(message);
    this.sent.push(copy);
    void this.answer(copy).then((reply) => {
      if (reply) this.onmessage?.({ data: reply } as MessageEvent<FromLayoutWorker>);
    });
  }

  /** What the worker does when its script fails to load or throws outside a layout. */
  fail(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

function clientWith(answer: Answer, timeoutMs?: number) {
  const workers: FakeWorker[] = [];
  const client = createLayoutClient({
    createWorker: () => {
      const worker = new FakeWorker(answer);
      workers.push(worker);
      return worker as unknown as Worker;
    },
    timeoutMs,
  });
  return { client, workers };
}

/** Whether a promise has settled yet. */
function watch(promise: Promise<unknown>) {
  const state = { settled: false };
  promise.then(
    () => {
      state.settled = true;
    },
    () => {
      state.settled = true;
    },
  );
  return state;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the default worker', () => {
  it("is worker.ts as a module worker, so Vite's unbundled dev can run its imports", () => {
    const made: Array<[URL | string, WorkerOptions | undefined]> = [];
    vi.stubGlobal(
      'Worker',
      class extends FakeWorker {
        constructor(url: URL | string, options?: WorkerOptions) {
          super(never);
          made.push([url, options]);
        }
      },
    );
    const client = createLayoutClient();

    void client.layout(WRONG).catch(() => {});
    client.dispose();

    expect(made).toHaveLength(1);
    expect(String(made[0][0])).toMatch(/\/board\/layout\/worker\.ts(\?|$)/);
    expect(made[0][1]).toEqual({ type: 'module' });
  });
});

describe('createLayoutClient', { timeout: 30_000 }, () => {
  it('resolves a layout through the worker', async () => {
    const { client, workers } = clientWith(viaViz);

    expect(await client.layout(WRONG)).toEqual(await layoutWithViz(WRONG));
    expect(workers).toHaveLength(1);
    expect(workers[0].sent).toEqual([{ id: expect.any(Number), spec: WRONG }]);
  });

  it('starts its worker on first use', () => {
    const { workers } = clientWith(viaViz);

    expect(workers).toHaveLength(0);
  });

  it('serves the same spec from its cache', async () => {
    const { client, workers } = clientWith(viaViz);

    const first = client.layout(WRONG);
    const second = client.layout(structuredClone(WRONG));
    expect(await second).toEqual(await first);
    expect(workers[0].sent).toHaveLength(1);

    // The same automaton written another way: fields in another order, accept: false spelled out.
    const rewritten: AutomatonSpec = {
      transitions: WRONG.transitions,
      start: WRONG.start,
      states: WRONG.states.map(({ id, accept }) => ({ accept: accept ?? false, id })),
      kind: WRONG.kind,
    };
    await client.layout(rewritten);
    expect(workers[0].sent).toHaveLength(1);

    await client.layout(CORRECT);
    expect(workers[0].sent).toHaveLength(2);
  });

  it("rejects with the worker's error", async () => {
    const { client, workers } = clientWith(async ({ id }) => ({ id, error: 'Graphviz failed' }));

    await expect(client.layout(WRONG)).rejects.toThrow('Graphviz failed');
    // A failure isn't cached: the next call asks again.
    await expect(client.layout(WRONG)).rejects.toThrow('Graphviz failed');
    expect(workers[0].sent).toHaveLength(2);
  });

  it('rejects after 4000 ms without an answer', async () => {
    vi.useFakeTimers();
    const { client, workers } = clientWith(never);

    const result = client.layout(WRONG);
    const outcome = watch(result);
    const rejected = expect(result).rejects.toThrow('4000 ms');
    await vi.advanceTimersByTimeAsync(3999);
    expect(outcome.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;

    // Timed out isn't cached either, and the same worker takes the next call.
    void client.layout(WRONG).catch(() => {});
    expect(workers).toHaveLength(1);
    expect(workers[0].sent).toHaveLength(2);
    client.dispose();
  });

  it('takes its timeout from the options', async () => {
    vi.useFakeTimers();
    const { client } = clientWith(never, 50);

    const rejected = expect(client.layout(WRONG)).rejects.toThrow('50 ms');
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
  });

  it('ignores an answer that comes after its call timed out', async () => {
    vi.useFakeTimers();
    let answerLate = () => {};
    const { client, workers } = clientWith(
      (message) =>
        new Promise((resolve) => {
          answerLate = () => resolve({ id: message.id, error: 'too late' });
        }),
    );

    const rejected = expect(client.layout(WRONG)).rejects.toThrow('4000 ms');
    await vi.advanceTimersByTimeAsync(4000);
    await rejected;
    answerLate();
    await vi.advanceTimersByTimeAsync(0);
    expect(workers[0].terminate).not.toHaveBeenCalled();
  });

  it('dispose terminates the worker and rejects pending calls', async () => {
    const { client, workers } = clientWith(never);

    const pending = client.layout(WRONG);
    client.dispose();

    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    await expect(pending).rejects.toThrow('disposed');
  });

  it('starts a new worker for a call after dispose', async () => {
    const { client, workers } = clientWith(viaViz);

    await client.layout(WRONG);
    client.dispose();
    await client.layout(WRONG);

    expect(workers).toHaveLength(2);
    expect(workers[1].sent).toHaveLength(1);
  });

  it('fails every waiting call when the worker fails, and starts a new one next time', async () => {
    const { client, workers } = clientWith(never);

    const one = client.layout(WRONG);
    const two = client.layout(CORRECT);
    workers[0].fail('net::ERR_FILE_NOT_FOUND');

    await expect(one).rejects.toThrow('net::ERR_FILE_NOT_FOUND');
    await expect(two).rejects.toThrow('net::ERR_FILE_NOT_FOUND');
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);

    void client.layout(WRONG).catch(() => {});
    expect(workers).toHaveLength(2);
    client.dispose();
  });

  it('rejects when it cannot start a worker', async () => {
    const client = createLayoutClient({
      createWorker: () => {
        throw new Error('no workers here');
      },
    });

    await expect(client.layout(WRONG)).rejects.toThrow('no workers here');
  });
});

describe('getLayoutClient', () => {
  it('is one client, shared', () => {
    expect(getLayoutClient()).toBe(getLayoutClient());
  });
});
