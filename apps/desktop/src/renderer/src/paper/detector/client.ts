/// <reference path="./breakout-box.d.ts" />
// The window's side of the change detector: it turns the camera track into a stream of
// VideoFrames (MediaStreamTrackProcessor exists on Window only in Chromium 152; a track can't be
// transferred, but its stream can) and hands it to the detector worker.
//
// The worker is a module worker in dev and in the build. Vite's dev server serves worker.ts
// unbundled, with ES imports a classic worker can't parse; the build bundles it as an ES module
// (`worker.format: 'es'` in electron.vite.config.ts), with OpenCV as a chunk it loads lazily.
// Its script comes from app://tassel (or the dev server), so it runs under its own policy, not
// the page's <meta> CSP: OpenCV's WebAssembly needs no change to the page.

import type { DetectorStats, DetectorTrigger, NormRect } from '../contracts';
import type { FromWorker, ToWorker } from './messages';
import type { DetectorParams } from './params';

export interface ChangeDetectorOptions {
  params?: Partial<DetectorParams>;
  contentRect?: NormRect | null;
  onStats(stats: DetectorStats): void;
  onTrigger(trigger: DetectorTrigger): void;
  onError(message: string): void;
  /**
   * Once OpenCV has settled in the worker: true when it loaded, false when the page finder is off
   * and the central crop is compared instead. The frame watchdog arms here, since loading and
   * starting OpenCV can hold the worker's thread for seconds (re-review N4).
   */
  onReady?(opencv: boolean): void;
  createWorker?: () => Worker;
  createProcessor?: (track: MediaStreamTrack) => { readable: ReadableStream<VideoFrame> };
}

export function createChangeDetector(
  stream: MediaStream,
  opts: ChangeDetectorOptions,
): { stop(): void } {
  const [track] = stream.getVideoTracks();
  if (!track) {
    opts.onError('The paper stream has no video track');
    return { stop() {} };
  }
  const worker =
    opts.createWorker?.() ??
    new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'paper-detector' });
  const processor = opts.createProcessor?.(track) ?? new MediaStreamTrackProcessor({ track });
  let stopped = false;

  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    if (stopped) return;
    const message = event.data;
    if (message.type === 'stats') opts.onStats(message.stats);
    else if (message.type === 'trigger') opts.onTrigger(message.trigger);
    else if (message.type === 'error') opts.onError(message.message);
    else if (message.type === 'ready') opts.onReady?.(message.opencv);
  };
  worker.onerror = (event: ErrorEvent) => {
    if (!stopped) opts.onError(event.message || 'The change detector stopped');
  };

  const start: ToWorker = {
    type: 'start',
    readable: processor.readable,
    params: opts.params ?? {},
    contentRect: opts.contentRect ?? null,
  };
  worker.postMessage(start, [processor.readable]);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      const stop: ToWorker = { type: 'stop' };
      worker.postMessage(stop);
      worker.terminate();
    },
  };
}
