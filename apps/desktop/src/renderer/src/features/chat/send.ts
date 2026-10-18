// Sending one of her chat messages: it shows in the chat at once, its images upload first, then
// the student-message goes to the tutor with their ids (and interrupts Ada, as speaking over her
// does; the server does that). The server's echo, matched by client_id, then takes its place. A
// failed upload or a missing connection leaves it in the chat, marked, with a retry that uploads
// only what didn't go.
import type { ApiClient } from '@tassel/shared/api';
import { MESSAGE_MAX_ATTACHMENTS, MESSAGE_MAX_CHARS } from '@tassel/shared/voice';
import type { TutorClient } from '../../tutor/types';
import { uploadImage } from './chat-api';
import { type ChatImage, useChatStore } from './chat-store';

export interface SendDeps {
  api: ApiClient;
  sessionId: string;
  client: TutorClient | null;
  /** The message's client id; random by default. */
  newId?: () => string;
}

export interface Draft {
  text: string;
  images: ChatImage[];
  voice: boolean;
}

/** Whether a draft has anything to send: text, or an image. */
export const canSend = (draft: Pick<Draft, 'text' | 'images'>): boolean =>
  draft.text.trim().length > 0 || draft.images.length > 0;

export async function sendMessage(deps: SendDeps, draft: Draft): Promise<void> {
  if (!canSend(draft)) return;
  const clientId = (deps.newId ?? (() => crypto.randomUUID()))();
  useChatStore.getState().addPending({
    clientId,
    text: draft.text.trim().slice(0, MESSAGE_MAX_CHARS),
    images: draft.images.slice(0, MESSAGE_MAX_ATTACHMENTS),
    voice: draft.voice,
  });
  await deliver(deps, clientId);
}

/** Sends a failed message again: the images still to upload, then the message. */
export function retryMessage(deps: SendDeps, clientId: string): Promise<void> {
  return deliver(deps, clientId);
}

async function deliver(deps: SendDeps, clientId: string): Promise<void> {
  const store = useChatStore.getState();
  const line = store.lines.find((l) => l.clientId === clientId && l.id === null);
  if (!line) return;
  const images = [...line.images];
  if (images.some((image) => image.id === null)) {
    store.update(clientId, { status: 'uploading' });
    for (const [index, image] of images.entries()) {
      if (image.id !== null || !image.blob) continue;
      try {
        const { id, w, h } = await uploadImage(deps.api, deps.sessionId, image.blob);
        images[index] = { ...image, id, w: w || image.w, h: h || image.h, blob: null };
        useChatStore.getState().update(clientId, { images: [...images] });
      } catch (error) {
        console.debug('[chat] An image upload failed:', error);
        useChatStore.getState().update(clientId, { status: 'failed' });
        return;
      }
    }
  }
  const attachmentIds = images.flatMap((image) => (image.id ? [image.id] : []));
  const sent =
    deps.client?.sendMessage?.({
      clientId,
      text: line.text,
      attachmentIds,
      voice: line.voice,
    }) ?? false;
  useChatStore.getState().update(clientId, { status: sent ? 'sending' : 'failed' });
}
