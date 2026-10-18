// The student's image on the stage: an attachment she sent in the chat, shown in the paper
// panel's slot and marked up as her paper is. `image.show` loads it through the registered
// source (the authenticated API in the app; a synthetic page in the image demo); until it's
// ready, what Ada marks on it waits, so the marks she sends in the same breath still land. Marks
// are kept per attachment, so switching images keeps each image's own; Back to paper takes the
// image off the stage and keeps it, loaded, for the next show. Every loaded image is let go when
// the session screen closes (reset).
import {
  type DetectedElements,
  type ImageAction,
  isDetectedId,
  type PaperMark,
} from '@tassel/shared/beats';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { targetsOf } from './geometry';

/** An attachment as its source loads it: an image URL to revoke once no longer needed. */
export interface LoadedImage {
  url: string;
  w: number;
  h: number;
  revoke(): void;
  /** The image's Set-of-Mark boxes, in its pixels, when known: `el` targets resolve through them. */
  detected?: DetectedElements;
}

export interface ImageSource {
  /** Rejects on failure; `signal` aborts when a newer show or Back to paper replaces this one. */
  load(attachmentId: string, ctx: { signal: AbortSignal }): Promise<LoadedImage>;
}

/** `failed` shows her paper, while the tag says the image couldn't load. */
export type ImageStatus = 'idle' | 'loading' | 'shown' | 'failed';

export interface ImageState {
  /** The attachment on the stage, loading or shown; null while her paper shows. */
  shown: string | null;
  status: ImageStatus;
  /** The shown attachment's image, once loaded. */
  image: LoadedImage | null;
  /** Ada's marks on each attachment, in the order she made them. */
  marks: ReadonlyMap<string, readonly PaperMark[]>;
  apply(action: ImageAction): void;
  /** Shows that attachment: what the chat's thumbnail or action row asks for. */
  show(attachmentId: string): void;
  /** Back to her paper: the image and its marks stay for the next show. */
  backToPaper(): void;
  /** Starts over, with no image: lets every loaded one go. */
  reset(): void;
}

let source: ImageSource | null = null;

/** Makes `next` load every attachment. Returns the unregister, which brings back the one it replaced. */
export function registerImageSource(next: ImageSource): () => void {
  const previous = source;
  source = next;
  return () => {
    if (source !== next) return;
    source = previous;
  };
}

const EMPTY: readonly PaperMark[] = [];

/** Ada's marks on `attachmentId`, in order. */
export function marksOf(
  state: Pick<ImageState, 'marks'>,
  attachmentId: string,
): readonly PaperMark[] {
  return state.marks.get(attachmentId) ?? EMPTY;
}

/** Every image loaded this session, by attachment, shown or not. */
let loaded = new Map<string, LoadedImage>();
/** The load in flight, if any: a newer show, Back to paper or a reset aborts it. */
let loading: AbortController | null = null;
/** Marks on an image that is still loading: applied once it's up, in order. */
let waiting: Array<Extract<ImageAction, { kind: 'image.mark' }>> = [];

const paper = () => ({ shown: null, status: 'idle', image: null }) satisfies Partial<ImageState>;

export const useImageStore: UseBoundStore<StoreApi<ImageState>> = create<ImageState>()(
  (set, get) => {
    const abort = () => {
      loading?.abort();
      loading = null;
      waiting = [];
    };

    const fail = (attachmentId: string, reason: unknown) => {
      console.warn(
        `[tassel] Couldn't load the student's image ${attachmentId}; her paper stays up:`,
        reason,
      );
      set({ shown: null, status: 'failed', image: null });
    };

    /** One of Ada's marks on an image that's up, or known: skipped when its ink isn't there. */
    const place = (action: Extract<ImageAction, { kind: 'image.mark' }>) => {
      const { attachmentId, mark } = action;
      const detected = loaded.get(attachmentId)?.detected;
      const missing = targetsOf(mark).find((target) => {
        if (!('el' in target)) return false;
        if (!isDetectedId(target.el)) return true;
        return detected !== undefined && !detected.items.some((item) => item.id === target.el);
      });
      if (missing) {
        console.warn(
          `[tassel] Skipped Ada's ${mark.type} mark "${mark.id}": the image has no such ink:`,
          missing,
        );
        return;
      }
      const marks = marksOf(get(), attachmentId);
      const at = marks.findIndex((m) => m.id === mark.id);
      const next = at < 0 ? [...marks, mark] : marks.map((m, i) => (i === at ? mark : m));
      set({ marks: new Map(get().marks).set(attachmentId, next) });
    };

    const show = (attachmentId: string) => {
      abort();
      const known = loaded.get(attachmentId);
      if (known) {
        set({ shown: attachmentId, status: 'shown', image: known });
        return;
      }
      set({ shown: attachmentId, status: 'loading', image: null });
      if (!source) {
        fail(attachmentId, 'no source loads attachments');
        return;
      }
      const controller = new AbortController();
      loading = controller;
      let load: Promise<LoadedImage>;
      try {
        load = source.load(attachmentId, { signal: controller.signal });
      } catch (error) {
        loading = null;
        fail(attachmentId, error);
        return;
      }
      load.then(
        (image) => {
          // Replaced while it loaded: nobody will show it.
          if (loading !== controller) {
            revoke(image);
            return;
          }
          loading = null;
          loaded.set(attachmentId, image);
          const marks = waiting;
          waiting = [];
          set({ shown: attachmentId, status: 'shown', image });
          for (const next of marks) place(next);
        },
        (error) => {
          if (loading !== controller) return;
          loading = null;
          waiting = [];
          fail(attachmentId, error);
        },
      );
    };

    return {
      ...paper(),
      marks: new Map(),
      apply(action) {
        switch (action.kind) {
          case 'image.show':
            show(action.attachmentId);
            return;
          case 'image.mark':
            if (get().status === 'loading' && get().shown === action.attachmentId) {
              waiting.push(action);
            } else {
              place(action);
            }
            return;
          case 'image.clear': {
            if (get().shown === action.attachmentId) {
              waiting = waiting.filter((m) => m.attachmentId !== action.attachmentId);
            }
            if (!get().marks.has(action.attachmentId)) return;
            const marks = new Map(get().marks);
            marks.delete(action.attachmentId);
            set({ marks });
            return;
          }
          default:
            return;
        }
      },
      show,
      backToPaper() {
        abort();
        set(paper());
      },
      reset() {
        abort();
        for (const image of loaded.values()) revoke(image);
        loaded = new Map();
        set({ ...paper(), marks: new Map() });
      },
    };
  },
);

/** Applies one of Ada's image actions, which dispatchActions has checked. */
export function applyImageAction(action: ImageAction): void {
  useImageStore.getState().apply(action);
}

/** Lets an image URL go once nothing shows it. */
function revoke(image: LoadedImage): void {
  try {
    image.revoke();
  } catch (error) {
    console.error("[tassel] Couldn't let go of an image:", error);
  }
}
