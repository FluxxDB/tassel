// Stored flattened paper: its pixels come from the authenticated API, its targets from the
// exact turn's freeze context. Loading never consults 'latest', which could have advanced.
import { type ApiClient, ApiError } from '@tassel/shared/api';
import { rectProjector } from './project';
import type { SnapshotSource } from './snapshot-sources';

export function createPaperSource(deps: {
  api: ApiClient;
  sessionId(): string | null;
  createObjectURL?(blob: Blob): string;
  revokeObjectURL?(url: string): void;
}): SnapshotSource {
  return {
    async load(ref, { signal, elements }) {
      signal.throwIfAborted();
      const sessionId = deps.sessionId();
      if (ref.kind !== 'paper' || !sessionId || !elements?.detected) {
        throw new Error('A paper snapshot needs a session, frame and detected page context');
      }
      const { data, error, response } = await deps.api.GET(
        '/v1/sessions/{session_id}/frames/{frame_id}/page',
        {
          params: { path: { session_id: sessionId, frame_id: ref.id } },
          parseAs: 'blob',
          signal,
        },
      );
      if (!data) throw new ApiError(response.status, error);
      signal.throwIfAborted();
      const url = deps.createObjectURL ? deps.createObjectURL(data) : URL.createObjectURL(data);
      const { width: w, height: h } = elements.detected;
      return {
        image: {
          kind: 'url',
          url,
          w,
          h,
          revoke: () => {
            if (deps.revokeObjectURL) deps.revokeObjectURL(url);
            else URL.revokeObjectURL(url);
          },
        },
        project: rectProjector(w, h),
        capturedAt: ref.capturedAt,
        elements,
      };
    },
  };
}
