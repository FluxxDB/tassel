// The session's conversation for the chat sidebar: the server's `message` lines in the order they
// first arrived, a tutor line updated in place by id as Ada speaks it, and the student's own
// typed messages shown at once (optimistic) until the server's echo, matched by client_id, takes
// their place. A session opens with its saved history; End and the next session start empty.
import type { ChatMessage, MessageAction } from '@tassel/shared/voice';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

/** An image on a line: the server's attachment, or one of hers still on its way. */
export interface ChatImage {
  /** The server's attachment id, once uploaded. */
  id: string | null;
  /** Stable for React and retries, the server's id for a line from the server. */
  key: string;
  w: number;
  h: number;
  /** A local object URL for one of hers; null when it comes from the server. */
  preview: string | null;
  /** The JPEG still to upload; null once it's up, or for one from the server. */
  blob: Blob | null;
}

/** Where one of her typed messages is: on its way, or refused, with a retry. */
export type SendStatus = 'uploading' | 'sending' | 'sent' | 'failed';

export interface ChatLine {
  /** Stable for React: the server's id, or her message's client id until the echo. */
  key: string;
  id: string | null;
  clientId: string | null;
  role: ChatMessage['role'];
  source: ChatMessage['source'];
  text: string;
  final: boolean;
  interrupted: boolean;
  images: ChatImage[];
  action: MessageAction | null;
  status: SendStatus;
  /** For a retry: whether she asked for a spoken reply. */
  voice: boolean;
}

/** A saved line, as `GET /v1/sessions/{id}/messages` returns it. */
export type SavedMessage = Omit<ChatMessage, 'final'> & { created_at?: string };

interface ChatStore {
  lines: ChatLine[];
  /** A line from the server's `message` event. */
  receive(message: ChatMessage): void;
  /** Her typed message, shown before it has gone. */
  addPending(line: { clientId: string; text: string; images: ChatImage[]; voice: boolean }): void;
  /** Her message's progress; `images` replaces its images (their ids once uploaded). */
  update(clientId: string, patch: { status?: SendStatus; images?: ChatImage[] }): void;
  /** The saved conversation, ahead of anything that arrived while it loaded. */
  loadHistory(messages: SavedMessage[]): void;
  /** Ada's line in progress was cut off (her screen turn reset): it ends where it was. */
  interruptCurrent(): void;
  reset(): void;
}

function fromServer(message: ChatMessage, key = message.id): ChatLine {
  return {
    key,
    id: message.id,
    clientId: message.client_id,
    role: message.role,
    source: message.source,
    text: message.text,
    final: message.final,
    interrupted: message.interrupted,
    images: message.attachments.map((a) => ({
      id: a.id,
      key: a.id,
      w: a.w,
      h: a.h,
      preview: null,
      blob: null,
    })),
    action: message.action,
    status: 'sent',
    voice: true,
  };
}

/** Her local previews stay on the echoed line (no refetch), with the server's sizes when known. */
function mergeImages(local: ChatImage[], server: ChatImage[]): ChatImage[] {
  if (server.length === 0) return local.map((image) => ({ ...image, blob: null }));
  return server.map((image, index) => {
    const mine = local.find((l) => l.id === image.id) ?? local[index];
    return mine
      ? {
          ...image,
          key: mine.key,
          preview: mine.preview,
          w: image.w || mine.w,
          h: image.h || mine.h,
        }
      : image;
  });
}

export const useChatStore: UseBoundStore<StoreApi<ChatStore>> = create<ChatStore>()((set) => ({
  lines: [],
  receive: (message) =>
    set((state) => {
      // Only her final spoken lines show: never the interim words.
      if (message.role === 'student' && message.source === 'voice' && !message.final) return state;
      const lines = [...state.lines];
      const byId = lines.findIndex((line) => line.id === message.id);
      if (byId >= 0) {
        const old = lines[byId] as ChatLine;
        lines[byId] = {
          ...fromServer(message, old.key),
          images: mergeImages(old.images, fromServer(message).images),
          voice: old.voice,
        };
        return { lines };
      }
      const mine =
        message.client_id === null
          ? -1
          : lines.findIndex((line) => line.id === null && line.clientId === message.client_id);
      if (mine >= 0) {
        const old = lines[mine] as ChatLine;
        lines[mine] = {
          ...fromServer(message, old.key),
          images: mergeImages(old.images, fromServer(message).images),
          voice: old.voice,
        };
        return { lines };
      }
      return { lines: [...lines, fromServer(message)] };
    }),
  addPending: ({ clientId, text, images, voice }) =>
    set((state) => ({
      lines: [
        ...state.lines,
        {
          key: clientId,
          id: null,
          clientId,
          role: 'student',
          source: 'typed',
          text,
          final: true,
          interrupted: false,
          images,
          action: null,
          status: images.some((image) => image.id === null) ? 'uploading' : 'sending',
          voice,
        },
      ],
    })),
  update: (clientId, patch) =>
    set((state) => ({
      lines: state.lines.map((line) =>
        line.clientId === clientId && line.id === null ? { ...line, ...patch } : line,
      ),
    })),
  loadHistory: (messages) =>
    set((state) => {
      const saved = messages.map((message) => fromServer({ ...message, final: true }));
      const ids = new Set(saved.map((line) => line.id));
      return { lines: [...saved, ...state.lines.filter((line) => !ids.has(line.id))] };
    }),
  interruptCurrent: () =>
    set((state) => {
      const at = state.lines.findLastIndex((line) => line.role === 'tutor' && !line.final);
      if (at < 0) return state;
      const lines = [...state.lines];
      lines[at] = { ...(lines[at] as ChatLine), final: true, interrupted: true };
      return { lines };
    }),
  reset: () =>
    set((state) => {
      for (const line of state.lines)
        for (const image of line.images) if (image.preview) URL.revokeObjectURL(image.preview);
      return { lines: [] };
    }),
}));
