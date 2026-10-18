// The student's images as the chat stored them: their pixels come from the authenticated API
// (GET /v1/sessions/{id}/attachments/{aid}), as stored (at most 2048 px on the long side, upright),
// and their size from decoding them, so Ada's marks scale to the image itself.
import { type ApiClient, ApiError } from '@tassel/shared/api';
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
      const { data, error, response } = await deps.api.GET(
        '/v1/sessions/{session_id}/attachments/{attachment_id}',
        {
          params: { path: { session_id: sessionId, attachment_id: attachmentId } },
          parseAs: 'blob',
          signal,
        },
      );
      if (!data) throw new ApiError(response.status, error);
      signal.throwIfAborted();
      const { w, h } = await (deps.measure ?? measure)(data);
      signal.throwIfAborted();
      const url = deps.createObjectURL ? deps.createObjectURL(data) : URL.createObjectURL(data);
      return {
        url,
        w,
        h,
        revoke: () => {
          if (deps.revokeObjectURL) deps.revokeObjectURL(url);
          else URL.revokeObjectURL(url);
        },
      };
    },
  };
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
