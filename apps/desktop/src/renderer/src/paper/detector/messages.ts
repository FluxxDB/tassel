// What the window and the detector worker say to each other.

import type { DetectorStats, DetectorTrigger, NormRect } from '../contracts';
import type { DetectorParams } from './params';

export type ToWorker =
  | {
      type: 'start';
      /** The camera's frames: a MediaStreamTrackProcessor's readable, transferred. */
      readable: ReadableStream<VideoFrame>;
      params: Partial<DetectorParams>;
      /** The part of each frame that is the feed (a window capture's content), or all of it. */
      contentRect: NormRect | null;
    }
  | { type: 'stop' };

export type FromWorker =
  | { type: 'ready'; opencv: boolean }
  | { type: 'stats'; stats: DetectorStats }
  | { type: 'trigger'; trigger: DetectorTrigger }
  | { type: 'error'; message: string };
