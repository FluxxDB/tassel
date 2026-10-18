// The chat's REST calls, typed by the server's OpenAPI schema: upload one of her images, attach
// her latest paper frame ("Snap my paper"), fetch an attachment's image (it needs the device
// token, so never a bare <img src>), and read the saved conversation. Until the server's chat
// routes exist they answer 501: history then reads as none, and an upload fails into a retry.
import type { ApiClient } from '@tassel/shared/api';
import type { MessageAttachment } from '@tassel/shared/voice';
import type { SavedMessage } from './chat-store';

const ATTACHMENTS = '/v1/sessions/{session_id}/attachments' as const;

export class AttachmentError extends Error {
  constructor(readonly status: number) {
    super(`The attachment upload failed (${status})`);
  }
}

function attachmentOf(data: unknown, status: number): MessageAttachment {
  if (
    typeof data === 'object' &&
    data !== null &&
    typeof Reflect.get(data, 'id') === 'string' &&
    typeof Reflect.get(data, 'w') === 'number' &&
    typeof Reflect.get(data, 'h') === 'number'
  )
    return {
      id: Reflect.get(data, 'id') as string,
      w: Reflect.get(data, 'w') as number,
      h: Reflect.get(data, 'h') as number,
    };
  throw new AttachmentError(status);
}

/** Uploads one of her images (a JPEG, made by prepare-image.ts). */
export async function uploadImage(
  api: ApiClient,
  sessionId: string,
  image: Blob,
): Promise<MessageAttachment> {
  const { data, response } = await api.POST(ATTACHMENTS, {
    params: { path: { session_id: sessionId } },
    // openapi-typescript types the binary part as a string; it's a Blob.
    body: { image } as never,
    bodySerializer: () => {
      const form = new FormData();
      form.append('image', image, 'image.jpg');
      return form;
    },
  });
  if (!response.ok) throw new AttachmentError(response.status);
  return attachmentOf(data, response.status);
}

/** Asks the server to attach her paper frame `frameId` ("Snap my paper"). */
export async function snapPaper(
  api: ApiClient,
  sessionId: string,
  frameId: string,
): Promise<MessageAttachment> {
  const { data, response } = await api.POST(ATTACHMENTS, {
    params: { path: { session_id: sessionId }, query: { frame_id: frameId } },
  });
  if (!response.ok) throw new AttachmentError(response.status);
  return attachmentOf(data, response.status);
}

/** An attachment's image, or null when it can't be had. Never throws. */
export async function attachmentImage(
  api: ApiClient,
  sessionId: string,
  attachmentId: string,
): Promise<Blob | null> {
  try {
    const { data, response } = await api.GET(
      '/v1/sessions/{session_id}/attachments/{attachment_id}',
      {
        params: { path: { session_id: sessionId, attachment_id: attachmentId } },
        parseAs: 'blob',
      },
    );
    return response.ok && data instanceof Blob ? data : null;
  } catch {
    return null;
  }
}

/** The saved conversation, oldest first; none when the server can't say. Never throws. */
export async function fetchHistory(api: ApiClient, sessionId: string): Promise<SavedMessage[]> {
  try {
    const { data, response } = await api.GET('/v1/sessions/{session_id}/messages', {
      params: { path: { session_id: sessionId } },
    });
    const messages = response.ok ? Reflect.get(Object(data), 'messages') : undefined;
    return Array.isArray(messages) ? messages.filter(isSaved) : [];
  } catch {
    return [];
  }
}

function isSaved(value: unknown): value is SavedMessage {
  if (typeof value !== 'object' || value === null) return false;
  const role = Reflect.get(value, 'role');
  return (
    typeof Reflect.get(value, 'id') === 'string' &&
    typeof Reflect.get(value, 'text') === 'string' &&
    (role === 'student' || role === 'tutor' || role === 'action') &&
    Array.isArray(Reflect.get(value, 'attachments'))
  );
}
