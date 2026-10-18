// Her latest uploaded paper frame, per session: what the chat's "Snap my paper" asks the server to
// attach (POST attachments with frame_id). Every frame upload, ink, page or turn, records itself.
import { create, type StoreApi, type UseBoundStore } from 'zustand';

interface LatestFrame {
  sessionId: string | null;
  frameId: string | null;
  record(sessionId: string, frameId: string): void;
  reset(): void;
}

export const useLatestFrame: UseBoundStore<StoreApi<LatestFrame>> = create<LatestFrame>()(
  (set) => ({
    sessionId: null,
    frameId: null,
    record: (sessionId, frameId) => set({ sessionId, frameId }),
    reset: () => set({ sessionId: null, frameId: null }),
  }),
);

/** The session's latest uploaded frame, or null before its first. */
export function latestFrameOf(sessionId: string): string | null {
  const { sessionId: of, frameId } = useLatestFrame.getState();
  return of === sessionId ? frameId : null;
}
