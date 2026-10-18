// The chat's composer, one paper card at the sidebar's foot: her images as removable chips (four
// at most), the message field, which grows with what she writes (Enter sends, Shift+Enter starts
// a new line, and Enter that ends an IME composition never sends), then the paperclip, "Snap my
// paper" while a paper source is live, the voice pill (Ada speaks replies, or answers in text
// only; remembered) and Send. Images come by the paperclip, by pasting, or dropped on the
// sidebar (useDraft's addFiles), and are made JPEGs, shrunk, before they're chips.
import type { ApiClient } from '@tassel/shared/api';
import { MESSAGE_MAX_ATTACHMENTS, MESSAGE_MAX_CHARS } from '@tassel/shared/voice';
import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../components/IconButton';
import { ArrowUp, Close, Paperclip, Snap, Speaker, SpeakerOff } from '../../components/icons';
import { cn } from '../../lib/cn';
import { latestFrameOf } from '../../paper/latest-frame';
import { ImageFill, useImageUrl } from './ChatImages';
import { snapPaper } from './chat-api';
import { useChatPrefs } from './chat-prefs';
import type { ChatImage } from './chat-store';
import { IMAGE_ACCEPT, isSendableImage, type PreparedImage, prepareImage } from './prepare-image';
import { canSend } from './send';
import { useFocusRequest } from './toggle';

/** The field grows to eight lines, then scrolls. */
const FIELD_MAX_PX = 8 * 21 + 16;
/** The count shows once she's this close to the limit. */
const COUNT_FROM = MESSAGE_MAX_CHARS - 400;

type Notice = 'limit' | 'unreadable' | 'snapFailed' | null;

export interface Draft {
  text: string;
  setText(text: string): void;
  images: ChatImage[];
  /** Adds her image files as chips, up to the limit; what isn't an image is left out. */
  addFiles(files: File[]): Promise<void>;
  remove(key: string): void;
  /** "Snap my paper": the server attaches her latest paper frame as a chip. */
  snap(): Promise<void>;
  snapping: boolean;
  /** Empties the draft for the next message; its images now belong to the sent line. */
  clear(): void;
  notice: Notice;
}

export function useDraft({
  api,
  sessionId,
  prepare = prepareImage,
}: {
  api: ApiClient;
  sessionId: string;
  prepare?: (file: Blob) => Promise<PreparedImage>;
}): Draft {
  const [text, setText] = useState('');
  const [images, setImages] = useState<ChatImage[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [snapping, setSnapping] = useState(false);
  // Chips and the ones still being made, so a quick second paste can't pass the limit.
  const taken = useRef(0);
  taken.current = Math.max(taken.current, images.length);

  const add = useCallback((image: ChatImage) => setImages((now) => [...now, image]), []);

  const addFiles = useCallback(
    async (files: File[]) => {
      const sendable = files.filter(isSendableImage);
      if (sendable.length === 0) return;
      const room = MESSAGE_MAX_ATTACHMENTS - taken.current;
      setNotice(sendable.length > room ? 'limit' : null);
      const chosen = sendable.slice(0, Math.max(0, room));
      taken.current += chosen.length;
      for (const file of chosen) {
        try {
          const { blob, w, h } = await prepare(file);
          add({
            id: null,
            key: crypto.randomUUID(),
            w,
            h,
            preview: URL.createObjectURL(blob),
            blob,
          });
        } catch {
          taken.current -= 1;
          setNotice('unreadable');
        }
      }
    },
    [add, prepare],
  );

  const remove = useCallback((key: string) => {
    setImages((now) => {
      const gone = now.find((image) => image.key === key);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      taken.current = now.length - 1;
      return now.filter((image) => image.key !== key);
    });
    setNotice(null);
  }, []);

  const snap = useCallback(async () => {
    const frameId = latestFrameOf(sessionId);
    if (taken.current >= MESSAGE_MAX_ATTACHMENTS) {
      setNotice('limit');
      return;
    }
    if (!frameId) {
      setNotice('snapFailed');
      return;
    }
    setSnapping(true);
    taken.current += 1;
    try {
      const { id, w, h } = await snapPaper(api, sessionId, frameId);
      add({ id, key: id, w, h, preview: null, blob: null });
      setNotice(null);
    } catch {
      taken.current -= 1;
      setNotice('snapFailed');
    } finally {
      setSnapping(false);
    }
  }, [add, api, sessionId]);

  const clear = useCallback(() => {
    setText('');
    setImages([]);
    setNotice(null);
    taken.current = 0;
  }, []);

  return { text, setText, images, addFiles, remove, snap, snapping, clear, notice };
}

export interface ChatComposerProps {
  sessionId: string;
  draft: Draft;
  /** Whether a paper source is live, which shows "Snap my paper". */
  paperLive: boolean;
  onSend(): void;
}

export function ChatComposer({ sessionId, draft, paperLive, onSend }: ChatComposerProps) {
  const { t } = useTranslation();
  const fieldId = useId();
  const countId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const voice = useChatPrefs((state) => state.voiceReplies);
  const setVoice = useChatPrefs((state) => state.setVoiceReplies);
  const { text, images } = draft;
  const ready = canSend(draft);
  // She opened the sidebar: the field takes focus, without scrolling the sidebar as it opens.
  useFocusRequest('field', () => field.current?.focus({ preventScroll: true }));

  // Grows with what she writes, from one line to eight.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measured as the text changes.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, FIELD_MAX_PX)}px`;
  }, [text]);

  const send = () => {
    if (!ready) return;
    onSend();
  };

  return (
    <form
      aria-label={t('session.chat.composer.label')}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
      className="mx-3 mb-3 shrink-0 rounded-card border border-hairline bg-paper transition-[border-color] duration-150 has-[textarea:focus-visible]:border-ink/50"
    >
      {images.length > 0 && (
        <ul className="flex gap-2 px-3 pt-3">
          {images.map((image, index) => (
            <Chip
              key={image.key}
              sessionId={sessionId}
              image={image}
              label={t('session.chat.composer.removeImage', { n: index + 1 })}
              alt={t('session.chat.image', { n: index + 1 })}
              onRemove={() => {
                draft.remove(image.key);
                field.current?.focus();
              }}
            />
          ))}
        </ul>
      )}
      <label htmlFor={fieldId} className="sr-only">
        {t('session.chat.composer.label')}
      </label>
      <textarea
        id={fieldId}
        ref={field}
        data-chat-field=""
        rows={1}
        value={text}
        maxLength={MESSAGE_MAX_CHARS}
        placeholder={t('session.chat.composer.placeholder')}
        aria-describedby={text.length >= COUNT_FROM ? countId : undefined}
        onChange={(event) => draft.setText(event.target.value)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey) return;
          // Enter that ends an IME composition (Korean, say) commits it; it never sends.
          if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          send();
        }}
        onPaste={(event) => {
          const pasted = [...event.clipboardData.files].filter(isSendableImage);
          if (pasted.length === 0) return;
          event.preventDefault();
          void draft.addFiles(pasted);
        }}
        className="block max-h-[184px] w-full resize-none bg-transparent px-4 pt-3 pb-1.5 text-[14px] leading-[21px] text-ink placeholder:text-smoke-text focus-visible:outline-none ko:leading-[1.6]"
      />
      {(draft.notice || text.length >= COUNT_FROM) && (
        <div className="flex items-baseline justify-between gap-3 px-4 pb-1">
          <p role="status" className="min-w-0 text-[12px] leading-4 text-smoke-text">
            {draft.notice &&
              t(`session.chat.composer.${draft.notice}`, { max: MESSAGE_MAX_ATTACHMENTS })}
          </p>
          {text.length >= COUNT_FROM && (
            <p className="mono shrink-0 text-[11px] leading-[14px] text-smoke-text">
              <span aria-hidden="true">
                {text.length}/{MESSAGE_MAX_CHARS}
              </span>
              <span id={countId} className="sr-only">
                {t('session.chat.composer.count', { count: text.length, max: MESSAGE_MAX_CHARS })}
              </span>
            </p>
          )}
        </div>
      )}
      <div className="flex items-center gap-0.5 px-2 pt-0.5 pb-2">
        <IconButton
          label={t('session.chat.composer.attach')}
          title={t('session.chat.composer.attach')}
          onClick={() => files.current?.click()}
          className={SMALL}
        >
          <Paperclip />
        </IconButton>
        <input
          ref={files}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          tabIndex={-1}
          aria-hidden="true"
          data-testid="chat-file-input"
          className="hidden"
          onChange={(event) => {
            const picked = [...(event.target.files ?? [])];
            event.target.value = '';
            void draft.addFiles(picked);
          }}
        />
        {paperLive && (
          <IconButton
            label={t('session.chat.composer.snap')}
            title={t('session.chat.composer.snap')}
            aria-disabled={draft.snapping || undefined}
            onClick={() => void draft.snap()}
            className={cn(SMALL, draft.snapping && 'cursor-progress')}
          >
            <Snap />
          </IconButton>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setVoice(!voice)}
          title={t(
            voice ? 'session.chat.composer.voiceOnHint' : 'session.chat.composer.voiceOffHint',
          )}
          data-testid="chat-voice"
          className="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-pill px-2.5 text-[12px] leading-4 font-w520 text-ink transition-[background-color] duration-150 hover:bg-ink/[0.06] active:bg-ink/10"
        >
          {voice ? (
            <Speaker className="size-4 shrink-0" />
          ) : (
            <SpeakerOff className="size-4 shrink-0 text-smoke" />
          )}
          <span className="truncate">
            {t(voice ? 'session.chat.composer.voiceOn' : 'session.chat.composer.voiceOff')}
          </span>
        </button>
        <button
          type="submit"
          aria-label={t('session.chat.composer.send')}
          title={t('session.chat.composer.send')}
          aria-disabled={!ready || undefined}
          className={cn(
            'ml-1 grid size-8 shrink-0 place-items-center rounded-pill transition-[background-color,color] duration-150',
            ready ? 'bg-ink text-paper hover:bg-ink/85' : 'cursor-default bg-ink/[0.08] text-smoke',
          )}
        >
          <ArrowUp className="size-[18px]" />
        </button>
      </div>
    </form>
  );
}

/** The composer's 32px round controls, drawing their icons at 18px. */
const SMALL = 'size-8 [&>svg]:size-[18px]';

function Chip({
  sessionId,
  image,
  label,
  alt,
  onRemove,
}: {
  sessionId: string;
  image: ChatImage;
  label: string;
  alt: string;
  onRemove(): void;
}) {
  const url = useImageUrl(sessionId, image);
  return (
    <li className="relative size-14 shrink-0 overflow-hidden rounded-input border border-hairline">
      <ImageFill url={url} alt={alt} />
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={onRemove}
        className="absolute top-0.5 right-0.5 grid size-6 place-items-center rounded-pill bg-paper/90 text-ink transition-[background-color] duration-150 hover:bg-paper"
      >
        <Close className="size-3.5" />
      </button>
    </li>
  );
}
