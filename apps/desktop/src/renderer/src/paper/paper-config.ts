// The paper config from the main process (window.tassel.paper.getConfig), loaded once at boot
// (Task 13), so code that renders reads it synchronously.
import { useSyncExternalStore } from 'react';
import type { PaperConfig } from '../../../shared/paper-bridge';

export const DEFAULT_PAPER_CONFIG: PaperConfig = Object.freeze({
  source: 'auto',
  debug: false,
  helperClip: false,
  fakeClip: false,
  params: Object.freeze({}),
}) as PaperConfig;

let current: PaperConfig = DEFAULT_PAPER_CONFIG;
const listeners = new Set<() => void>();

export function setPaperConfig(config: PaperConfig): void {
  current = config;
  for (const listener of [...listeners]) listener();
}

/** DEFAULT_PAPER_CONFIG until setPaperConfig runs. */
export function getPaperConfig(): PaperConfig {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePaperConfig(): PaperConfig {
  return useSyncExternalStore(subscribe, getPaperConfig);
}
