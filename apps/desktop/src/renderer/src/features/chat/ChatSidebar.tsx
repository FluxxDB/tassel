// The chat sidebar: the session's conversation beside the stage, on the window's bone ground
// behind one hairline. A header with its label and Hide, the log, and the composer. From 1120 px
// wide it takes 360 px from the stage, which shrinks beside it; narrower, it lies over the stage's
// right side, and the stage's tiles, captions and dock keep clear of it (chat-layout.ts). It
// opens and closes in 200 ms, at once under reduced motion; closed, it keeps her draft, inert.
// Images dropped anywhere on it join the draft.
import type { Lang } from '@tassel/shared/i18n';
import { type DragEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../components/IconButton';
import { Close } from '../../components/icons';
import { useApi } from '../../lib/api';
import { cn } from '../../lib/cn';
import { usePaperLive } from '../../paper/use-paper-capture';
import type { TutorClient } from '../../tutor/types';
import { ChatComposer, useDraft } from './ChatComposer';
import { ImageViewer, type Viewed } from './ChatImages';
import { ChatLog } from './ChatLog';
import { SIDEBAR_WIDTH, useChatCover, useWideWindow } from './chat-layout';
import { useChatOpen, useChatPrefs } from './chat-prefs';
import type { PreparedImage } from './prepare-image';
import { retryMessage, sendMessage } from './send';
import { CHAT_SIDEBAR_ID, setChatOpen } from './toggle';

const EASE = 'motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.16,1,0.3,1)]';

export interface ChatSidebarProps {
  sessionId: string;
  lang: Lang | undefined;
  /** The tutor typed messages go to; null while there's none. */
  client: TutorClient | null;
  /** Explicit image preparation for tests. */
  prepare?: (file: Blob) => Promise<PreparedImage>;
}

export function ChatSidebar({ sessionId, lang, client, prepare }: ChatSidebarProps) {
  const { t } = useTranslation();
  const api = useApi();
  const open = useChatOpen();
  const wide = useWideWindow();
  const paperLive = usePaperLive();
  const voice = useChatPrefs((state) => state.voiceReplies);
  const draft = useDraft({ api, sessionId, prepare });
  const [viewed, setViewed] = useState<Viewed | null>(null);
  const [dropping, setDropping] = useState(false);

  // Overlaying the stage, it covers main's right 360 px; pushing it, or closed, nothing.
  const cover = open && !wide ? SIDEBAR_WIDTH : 0;
  useEffect(() => {
    useChatCover.getState().setCover(cover);
  }, [cover]);
  useEffect(() => () => useChatCover.getState().setCover(0), []);

  const deps = { api, sessionId, client };
  const send = () => {
    void sendMessage(deps, { text: draft.text, images: draft.images, voice });
    draft.clear();
  };

  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');
  return (
    <div
      className={cn(
        wide
          ? cn('relative shrink-0 overflow-hidden motion-safe:transition-[width]', EASE)
          : cn(
              'absolute inset-y-0 right-0 z-30',
              EASE,
              // Visible at once as it opens (so its field can take focus), hidden only once it
              // has slid out.
              open
                ? 'visible translate-x-0 motion-safe:transition-[translate]'
                : 'invisible translate-x-full motion-safe:transition-[translate,visibility]',
            ),
      )}
      style={wide ? { width: open ? SIDEBAR_WIDTH : 0 } : { width: SIDEBAR_WIDTH }}
      data-testid="chat-sidebar-frame"
    >
      <aside
        id={CHAT_SIDEBAR_ID}
        aria-label={t('session.chat.title')}
        aria-hidden={!open || undefined}
        inert={!open}
        data-testid="chat-sidebar"
        data-layout={wide ? 'push' : 'overlay'}
        onDragEnter={(event) => {
          if (hasFiles(event)) setDropping(true);
        }}
        onDragOver={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
        }}
        onDrop={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          setDropping(false);
          void draft.addFiles([...event.dataTransfer.files]);
        }}
        className="relative flex h-full flex-col border-l border-hairline bg-bone"
        style={{ width: SIDEBAR_WIDTH }}
      >
        <div className="flex h-11 shrink-0 items-center justify-between pr-2 pl-5">
          <h2 className="mono text-[11px] leading-[14px] text-smoke-text">
            {t('session.chat.title')}
          </h2>
          <IconButton
            label={t('session.chat.hide')}
            title={t('session.chat.hide')}
            onClick={() => setChatOpen(false)}
            className="size-8 [&>svg]:size-[18px]"
          >
            <Close />
          </IconButton>
        </div>
        <ChatLog
          sessionId={sessionId}
          lang={lang}
          onRetry={(clientId) => void retryMessage(deps, clientId)}
          onOpenImage={setViewed}
        />
        <ChatComposer sessionId={sessionId} draft={draft} paperLive={paperLive} onSend={send} />
        {dropping && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-2 grid place-items-center rounded-card border border-dashed border-ink/40 bg-bone/95"
          >
            <p className="text-[13px] leading-5 font-w520 text-ink">
              {t('session.chat.composer.drop')}
            </p>
          </div>
        )}
      </aside>
      <ImageViewer sessionId={sessionId} viewed={viewed} onClose={() => setViewed(null)} />
    </div>
  );
}
