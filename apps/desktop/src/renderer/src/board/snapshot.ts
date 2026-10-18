// The board as it is now, for Ada's board turn (the voice server's board-snapshot request): every
// shape on the board, hers and the student's, as a PNG about 1280 px on its long side, posted as
// base64 to the session's board snapshot. The server waits 1.5 s for it and goes on without one,
// so nothing here blocks or shows: an empty or unmounted board sends nothing, a PNG still too big
// after a few smaller exports is dropped, and a failure is logged at debug.
import type { ApiClient } from '@tassel/shared/api';
import { exportBoardPng } from './board-store';

/** The long side asked of the first export, in px. */
export const SNAPSHOT_SIDE = 1280;
/** Under the server's 2 MiB, with room to spare. */
export const SNAPSHOT_MAX_BYTES = Math.floor(1.8 * 1024 * 1024);
/** Each export after one that came out too big is this much smaller. */
const SHRINK = 0.7;
/** The smallest long side worth sending. */
const MIN_SIDE = 320;

export interface SnapshotDeps {
  /** The board as a PNG about `maxSide` px on its long side, or null for no board. */
  exportPng?(maxSide: number): Promise<Blob | null>;
}

/** The board's PNG, under SNAPSHOT_MAX_BYTES; null when there's no board, or it can't fit. */
export async function boardSnapshotPng(
  exportPng: (maxSide: number) => Promise<Blob | null> = exportBoardPng,
): Promise<Blob | null> {
  for (let side = SNAPSHOT_SIDE; side >= MIN_SIDE; side = Math.round(side * SHRINK)) {
    const png = await exportPng(side);
    if (!png) return null;
    if (png.size <= SNAPSHOT_MAX_BYTES) return png;
  }
  console.debug('[board] The board snapshot stayed over 1.8 MiB, so none was sent');
  return null;
}

/** Posts the board as it is now for `sessionId`. Never throws. */
export async function sendBoardSnapshot(
  api: ApiClient,
  sessionId: string,
  deps: SnapshotDeps = {},
): Promise<void> {
  try {
    const png = await boardSnapshotPng(deps.exportPng);
    if (!png) return;
    const { response } = await api.POST('/v1/sessions/{session_id}/board/snapshot', {
      params: { path: { session_id: sessionId } },
      body: { image_png: await base64Of(png) },
    });
    if (!response.ok)
      console.debug(`[board] The server refused the board snapshot: ${response.status}`);
  } catch (error) {
    console.debug('[board] The board snapshot failed:', error);
  }
}

/** A blob's bytes as base64, a chunk at a time, so a large one never overflows the call stack. */
async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
