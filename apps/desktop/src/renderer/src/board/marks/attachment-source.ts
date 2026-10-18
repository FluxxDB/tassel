// The student's images as the chat stored them: their pixels come from the authenticated API
// (GET /v1/sessions/{id}/attachments/{aid}), as stored (at most 2048 px on the long side, upright),
// and their size from decoding them, so Ada's marks scale to the image itself. Beside the pixels
// comes the image's Set-of-Mark (GET …/{aid}/elements): the numbered boxes Ada was shown, in the
// image's pixels, so her `el: m3` marks land on m3. An image whose boxes don't load still shows;
// its `at` and `box` marks still land.
import { type ApiClient, ApiError } from '@tassel/shared/api';
import { type DetectedElement, type DetectedElements, isDetectedId } from '@tassel/shared/beats';
import type { ImageSource } from './image-store';

export function createAttachmentSource(deps: {
  api: ApiClient;
  sessionId(): string | null;
  createObjectURL?(blob: Blob): string;
  revokeObjectURL?(url: string): void;
  /** The image's size in pixels; decodes it by default. */
  measure?(blob: Blob): Promise<{ w: number; h: number }>;
}): ImageSource {
  return {
    async load(attachmentId, { signal }) {
      signal.throwIfAborted();
      const sessionId = deps.sessionId();
      if (!sessionId) throw new Error('An image needs a session');
      const path = { session_id: sessionId, attachment_id: attachmentId };
      const elements = loadElements(deps.api, path, signal);
      const { data, error, response } = await deps.api.GET(
        '/v1/sessions/{session_id}/attachments/{attachment_id}',
        { params: { path }, parseAs: 'blob', signal },
      );
      if (!data) throw new ApiError(response.status, error);
      signal.throwIfAborted();
      const [{ w, h }, boxes] = await Promise.all([(deps.measure ?? measure)(data), elements]);
      signal.throwIfAborted();
      const detected = boxes instanceof Error ? undefined : boxes;
      if (boxes instanceof Error) {
        console.warn(
          `[tassel] Couldn't load the Set-of-Mark of the student's image ${attachmentId}; ` +
            'marks on its numbered ink will be skipped:',
          boxes,
        );
      }
      const url = deps.createObjectURL ? deps.createObjectURL(data) : URL.createObjectURL(data);
      return {
        url,
        w,
        h,
        revoke: () => {
          if (deps.revokeObjectURL) deps.revokeObjectURL(url);
          else URL.revokeObjectURL(url);
        },
        ...(detected && { detected }),
      };
    },
  };
}

/** The image's numbered boxes, or why they can't be had: never a failed image. */
async function loadElements(
  api: ApiClient,
  path: { session_id: string; attachment_id: string },
  signal: AbortSignal,
): Promise<DetectedElements | Error> {
  try {
    const { data, response } = await api.GET(
      '/v1/sessions/{session_id}/attachments/{attachment_id}/elements',
      { params: { path }, signal },
    );
    if (!data) throw new ApiError(response.status, undefined);
    const detected = readElements(data);
    if (!detected) throw new Error('the boxes are malformed');
    return detected;
  } catch (reason) {
    return reason instanceof Error ? reason : new Error(String(reason));
  }
}

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const nonNegative = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0;

/** The server's boxes as the stage reads them: each well-formed one, once; null without a size. */
export function readElements(value: unknown): DetectedElements | null {
  if (typeof value !== 'object' || value === null) return null;
  const { width, height, items } = value as Record<string, unknown>;
  if (!positive(width) || !positive(height) || !Array.isArray(items)) return null;
  const seen = new Set<string>();
  const kept: DetectedElement[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const { id, kind, box } = item as Record<string, unknown>;
    if (!isDetectedId(id) || seen.has(id) || (kind !== 'circle' && kind !== 'label')) continue;
    if (typeof box !== 'object' || box === null) continue;
    const { x, y, w, h } = box as Record<string, unknown>;
    if (!nonNegative(x) || !nonNegative(y) || !positive(w) || !positive(h)) continue;
    if (x + w > width || y + h > height) continue;
    seen.add(id);
    kept.push({ id, kind, box: { x, y, w, h } });
  }
  return { width, height, items: kept };
}

/** Decodes the image for its size, letting the bitmap go at once. */
async function measure(blob: Blob): Promise<{ w: number; h: number }> {
  const bitmap = await createImageBitmap(blob);
  try {
    return { w: bitmap.width, h: bitmap.height };
  } finally {
    bitmap.close();
  }
}
