// Her images in the chat: a thumbnail that opens a viewer, from its local preview while it's hers
// and on its way, or fetched with the device token once it's the server's (an attachment needs
// auth, so never a bare <img src>). The viewer is a sheet with the image at its own aspect ratio.
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { ImageIcon } from '../../components/icons';
import { Sheet } from '../../components/Sheet';
import { useApi } from '../../lib/api';
import { cn } from '../../lib/cn';
import { attachmentImage } from './chat-api';
import type { ChatImage } from './chat-store';

/** The image's URL: its preview, or the server's copy, fetched once; null while it loads. */
export function useImageUrl(sessionId: string, image: Pick<ChatImage, 'id' | 'preview'>) {
  const api = useApi();
  const [fetched, setFetched] = useState<string | null>(null);
  const { id, preview } = image;
  useEffect(() => {
    if (preview || !id) return;
    let url: string | null = null;
    let live = true;
    void attachmentImage(api, sessionId, id).then((blob) => {
      if (!live || !blob) return;
      url = URL.createObjectURL(blob);
      setFetched(url);
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [api, sessionId, id, preview]);
  return preview ?? fetched;
}

/** An image, or a quiet placeholder until it has loaded (or if it can't). */
export function ImageFill({
  url,
  alt,
  className,
}: {
  url: string | null;
  alt: string;
  className?: string;
}) {
  return url ? (
    <img
      src={url}
      alt={alt}
      className={cn('size-full object-cover', className)}
      draggable={false}
    />
  ) : (
    <span role="img" aria-label={alt} className="grid size-full place-items-center bg-bone">
      <ImageIcon className="size-5 text-smoke" />
    </span>
  );
}

/** A line's thumbnail: a button that opens the viewer. */
export function ImageThumb({
  sessionId,
  image,
  label,
  onOpen,
}: {
  sessionId: string;
  image: ChatImage;
  label: string;
  onOpen(url: string | null): void;
}) {
  const url = useImageUrl(sessionId, image);
  return (
    <button
      type="button"
      onClick={() => onOpen(url)}
      aria-label={label}
      title={label}
      className="size-16 overflow-hidden rounded-input border border-hairline bg-paper transition-[border-color] duration-150 hover:border-ink/30"
    >
      <ImageFill url={url} alt="" />
    </button>
  );
}

export interface Viewed {
  /** Its local preview or fetched URL, when the opener has one. */
  url: string | null;
  /** The server's attachment, fetched here when there's no URL yet. */
  id: string | null;
  label: string;
}

/** The image viewer: the whole image in a sheet. */
export function ImageViewer({
  sessionId,
  viewed,
  onClose,
  children,
}: {
  sessionId: string;
  viewed: Viewed | null;
  onClose(): void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const url = useImageUrl(sessionId, { id: viewed?.id ?? null, preview: viewed?.url ?? null });
  return (
    <Sheet
      open={viewed !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t('session.chat.viewer.title')}
      className="max-w-[min(960px,calc(100%-48px))] gap-5 p-6"
    >
      {viewed && (
        <div className="grid min-h-0 place-items-center">
          {url ? (
            <img
              src={url}
              alt={viewed.label}
              className="max-h-[calc(100vh-200px)] max-w-full rounded-card-sm object-contain"
            />
          ) : (
            <span className="grid h-48 w-full place-items-center rounded-card-sm bg-bone">
              <ImageIcon className="size-8 text-smoke" />
            </span>
          )}
        </div>
      )}
      <div className="flex justify-end gap-3">
        {children}
        <Button variant="ghost" size="lg" onClick={onClose}>
          {t('session.chat.viewer.close')}
        </Button>
      </div>
    </Sheet>
  );
}
