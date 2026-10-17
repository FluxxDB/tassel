// The renderer's side of the layout worker: it sends each spec once, matches the answers by id,
// and caches every layout by the spec's canonical JSON, so redrawing an automaton costs nothing.
// A call fails after LAYOUT_TIMEOUT_MS without an answer, or at once if the worker fails, so the
// board can fall back to fallbackLayout (Task 5) instead of waiting.
import type { AutomatonSpec } from '@tassel/shared/beats';
import type { FromLayoutWorker, ToLayoutWorker } from './messages';
import type { AutomatonLayout } from './types';

export const LAYOUT_TIMEOUT_MS = 4000;

export interface LayoutClient {
  layout(spec: AutomatonSpec): Promise<AutomatonLayout>;
  /** Stops the worker and fails every waiting call; a later call starts a new worker. */
  dispose(): void;
}

interface Waiting {
  resolve(layout: AutomatonLayout): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export function createLayoutClient(
  opts: { createWorker?: () => Worker; timeoutMs?: number } = {},
): LayoutClient {
  // A module worker: Vite's unbundled dev serves a worker as it is, ES imports and all, which
  // only a module worker can run; the build still bundles it into one chunk (ruling P5-R5, I1).
  // Never ?worker&inline, whose blob: URL would put it under the page's CSP (P5-R3).
  const createWorker =
    opts.createWorker ??
    (() => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }));
  const timeoutMs = opts.timeoutMs ?? LAYOUT_TIMEOUT_MS;
  const cache = new Map<string, Promise<AutomatonLayout>>();
  const waiting = new Map<number, Waiting>();
  let worker: Worker | null = null;
  let nextId = 1;

  const settle = (id: number): Waiting | undefined => {
    const call = waiting.get(id);
    if (call) {
      waiting.delete(id);
      clearTimeout(call.timer);
    }
    return call;
  };

  const failAll = (error: Error) => {
    for (const id of [...waiting.keys()]) settle(id)?.reject(error);
  };

  const started = (): Worker => {
    if (worker) return worker;
    const created = createWorker();
    created.onmessage = ({ data }: MessageEvent<FromLayoutWorker>) => {
      // No one waits for an answer that came after its call timed out or was disposed.
      const call = settle(data.id);
      if (!call) return;
      if ('layout' in data) call.resolve(data.layout);
      else call.reject(new Error(data.error));
    };
    created.onerror = (event: ErrorEvent) => {
      // Its script didn't load, or it threw outside a layout: nothing it holds will answer.
      created.terminate();
      if (worker === created) worker = null;
      failAll(new Error(`The layout worker failed: ${event.message || 'no message'}`));
    };
    worker = created;
    return created;
  };

  const request = (spec: AutomatonSpec) =>
    new Promise<AutomatonLayout>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        settle(id)?.reject(new Error(`No layout after ${timeoutMs} ms`));
      }, timeoutMs);
      waiting.set(id, { resolve, reject, timer });
      try {
        const message: ToLayoutWorker = { id, spec };
        started().postMessage(message);
      } catch (error) {
        settle(id)?.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

  return {
    layout(spec) {
      const key = canonicalJson(spec);
      const cached = cache.get(key);
      if (cached) return cached;
      const result = request(spec);
      cache.set(key, result);
      // A failure isn't kept: the next call for the spec asks again.
      result.catch(() => {
        if (cache.get(key) === result) cache.delete(key);
      });
      return result;
    },
    dispose() {
      worker?.terminate();
      worker = null;
      failAll(new Error('The layout client was disposed'));
      cache.clear();
    },
  };
}

let shared: LayoutClient | null = null;

/** The renderer's shared client, made on first use. */
export function getLayoutClient(): LayoutClient {
  shared ??= createLayoutClient();
  return shared;
}

/** The spec as JSON in one fixed shape, so equal specs written differently share a layout. */
function canonicalJson(spec: AutomatonSpec): string {
  return JSON.stringify([
    spec.kind,
    spec.states.map(({ id, accept }) => [id, accept === true]),
    spec.start,
    spec.transitions.map(({ from, to, symbols }) => [from, to, symbols]),
  ]);
}
