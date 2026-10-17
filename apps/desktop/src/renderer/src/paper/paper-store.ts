// Paper's state for the session screen: the running source, its status and stream, and the
// choices that restart it (Retry, another source, another camera). The capture controller
// (Task 12) writes it; the paper panel reads it.
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type {
  DetectorStats,
  HelperDevice,
  NormRect,
  PaperFeed,
  PaperSourceKind,
  PaperStatus,
  UploadStats,
} from './types';

export interface PaperStore {
  kind: PaperSourceKind | null;
  status: PaperStatus;
  stream: MediaStream | null;
  contentRect: NormRect | null;
  devices: HelperDevice[];
  deviceId: string | null;
  override: PaperSourceKind | null;
  /** Bumped by every choice that restarts the source. */
  restartNonce: number;
  /** True from retry() until the restarted run settles. */
  retrying: boolean;
  stats: DetectorStats | null;
  uploads: UploadStats;
  /** Any status but `starting` settles the run, and so ends a retry. */
  setStatus(s: PaperStatus): void;
  /** A feed brings its kind, stream, crop and devices; null drops all but the kind. */
  setFeed(f: PaperFeed | null): void;
  setStats(s: DetectorStats | null): void;
  setUploads(u: UploadStats): void;
  retry(): void;
  useInstead(kind: PaperSourceKind): void;
  useDevice(id: string): void;
  reset(): void;
}

type PaperState = Omit<
  PaperStore,
  | 'setStatus'
  | 'setFeed'
  | 'setStats'
  | 'setUploads'
  | 'retry'
  | 'useInstead'
  | 'useDevice'
  | 'reset'
>;

function initialState(): PaperState {
  return {
    kind: null,
    status: 'idle',
    stream: null,
    contentRect: null,
    devices: [],
    deviceId: null,
    override: null,
    restartNonce: 0,
    retrying: false,
    stats: null,
    uploads: { sent: 0, pending: 0, failed: 0, lastError: null },
  };
}

export const usePaperStore: UseBoundStore<StoreApi<PaperStore>> = create<PaperStore>()((set) => ({
  ...initialState(),
  setStatus: (status) => set(status === 'starting' ? { status } : { status, retrying: false }),
  setFeed: (feed) =>
    set(
      feed
        ? {
            kind: feed.kind,
            stream: feed.stream,
            contentRect: feed.contentRect,
            devices: feed.devices,
          }
        : { stream: null, contentRect: null, devices: [] },
    ),
  setStats: (stats) => set({ stats }),
  setUploads: (uploads) => set({ uploads }),
  retry: () => set((state) => ({ restartNonce: state.restartNonce + 1, retrying: true })),
  useInstead: (kind) => set((state) => ({ override: kind, restartNonce: state.restartNonce + 1 })),
  useDevice: (id) => set((state) => ({ deviceId: id, restartNonce: state.restartNonce + 1 })),
  reset: () => set(initialState()),
}));
