// What a paper source gives the capture controller (Task 12), and how it fails.
import type { NormRect, PaperSourceKind } from './contracts';

export type {
  CellMask,
  DetectorStats,
  NormRect,
  PaperSourceKind,
  Pt,
  Quad,
  UploadStats,
} from './contracts';

export type PaperStatus =
  | 'idle'
  | 'starting'
  | 'live'
  | 'off'
  | 'denied'
  | 'unavailable'
  | 'lost'
  | 'ended'
  | 'error';

/** A selectable camera; `builtIn` identifies the helper's preferred built-in Desk View camera. */
export interface HelperDevice {
  id: string;
  name: string;
  builtIn: boolean;
}

/** A running source: its video, and what part of each frame is the paper. */
export interface PaperFeed {
  kind: PaperSourceKind;
  stream: MediaStream;
  /** The frame's content, a window capture's title bar cut away; null for the whole frame. */
  contentRect: NormRect | null;
  devices: HelperDevice[];
  /**
   * Called once if the feed ends by itself: `lost` when the camera or clip went away, `ended`
   * when a shared window or screen stopped. Not after stop(). Returns an unsubscribe.
   */
  onEnd(listener: (reason: 'lost' | 'ended') => void): () => void;
  /** Releases everything the feed holds. Safe to call twice. */
  stop(): void;
}

export interface PaperSource {
  readonly kind: PaperSourceKind;
  start(opts: { deviceId?: string | null; signal: AbortSignal }): Promise<PaperFeed>;
}

export type PaperSourceErrorCode = 'denied' | 'unavailable' | 'cancelled' | 'aborted' | 'error';

export class PaperSourceError extends Error {
  constructor(
    readonly code: PaperSourceErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'PaperSourceError';
  }
}
