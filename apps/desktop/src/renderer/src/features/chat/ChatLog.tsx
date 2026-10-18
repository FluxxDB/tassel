// The conversation, a polite live log: Ada's lines on the left, unboxed under her iris label,
// growing as she speaks them and ending "Cut off" when she was; hers on the right as paper cards,
// spoken ones in italics behind a small mic, with her images above the words; and what Ada did
// on the stage as small pills that take the stage there. It keeps to the newest line while she
// reads at the bottom, and leaves her place alone when she has scrolled up.
import type { Lang } from '@tassel/shared/i18n';
import type { MessageAction } from '@tassel/shared/voice';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useBoardStore } from '../../board/board-store';
import { Board, ImageIcon, Mic, Paper, Undo } from '../../components/icons';
import { cn } from '../../lib/cn';
import { useStageStore } from '../session/stage-store';
import { ImageThumb, type Viewed } from './ChatImages';
import { type ChatImage, type ChatLine, useChatStore } from './chat-store';
import { showImageOnStage } from './image-stage';

/** Within this many px of the bottom, she's reading the newest line: it stays in view. */
const STICK_PX = 48;

export interface ChatLogProps {
  sessionId: string;
  /** The session's language, which its lines are in. */
  lang: Lang | undefined;
  onRetry(clientId: string): void;
  onOpenImage(image: Viewed): void;
}

export function ChatLog({ sessionId, lang, onRetry, onOpenImage }: ChatLogProps) {
  const { t } = useTranslation();
  const lines = useChatStore((state) => state.lines);
  const box = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the lines as they change.
  useLayoutEffect(() => {
    const el = box.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [lines]);
  // The log shrinks as the composer grows (chips, more lines, a notice): the newest line stays
  // in view while she's reading there.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (stuck.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={box}
      role="log"
      aria-live="polite"
      aria-label={t('session.chat.title')}
      data-testid="chat-log"
      onScroll={(event) => {
        const el = event.currentTarget;
        stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
      }}
      // Lines scrolled up past the header fade out under it, as the captions do.
      className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 pt-3 pb-5 [mask-image:linear-gradient(to_bottom,transparent,#000_14px)]"
    >
      {lines.length === 0 ? (
        <p className="m-auto max-w-[248px] text-center text-[13px] leading-5 text-smoke-text">
          {t('session.chat.empty')}
        </p>
      ) : (
        // mt-auto: a short conversation sits at the bottom, by the composer, and grows upward.
        <ol className="mt-auto flex flex-col">
          {lines.map((line, index) => (
            <li
              key={line.key}
              data-testid="chat-line"
              data-role={line.role}
              className={cn(
                'flex flex-col',
                index > 0 && (sameSide(lines[index - 1] as ChatLine, line) ? 'mt-2' : 'mt-4'),
              )}
            >
              {line.role === 'student' && (
                <StudentLine
                  line={line}
                  lang={lang}
                  sessionId={sessionId}
                  onRetry={onRetry}
                  onOpenImage={onOpenImage}
                />
              )}
              {line.role === 'tutor' && (
                <TutorLine
                  line={line}
                  lang={lang}
                  labelled={index === 0 || lines[index - 1]?.role === 'student'}
                />
              )}
              {line.role === 'action' && line.action && (
                <ActionRow action={line.action} text={line.text} onOpenImage={onOpenImage} />
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Ada's lines and her action rows are one side; hers the other. */
const sameSide = (a: ChatLine, b: ChatLine) => (a.role === 'student') === (b.role === 'student');

const LINE_TEXT = 'text-[14px] leading-[21px] ko:leading-[1.6] break-words whitespace-pre-wrap';

function TutorLine({
  line,
  lang,
  labelled,
}: {
  line: ChatLine;
  lang: Lang | undefined;
  labelled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="pr-6">
      {/* Her label opens each run of her lines; the rest of the run reads as hers. */}
      <p
        className={cn('mono mb-1 text-[11px] leading-[14px] text-iris-ink', !labelled && 'sr-only')}
      >
        {t('session.tutorName')}
      </p>
      <p className={cn(LINE_TEXT, 'text-ink')}>
        <span lang={lang}>{line.text}</span>
        {line.interrupted && (
          <span className="mono ml-2 align-[0.1em] text-[11px] leading-[14px] whitespace-nowrap text-smoke-text">
            {t('session.chat.cutOff')}
          </span>
        )}
      </p>
    </div>
  );
}

function StudentLine({
  line,
  lang,
  sessionId,
  onRetry,
  onOpenImage,
}: {
  line: ChatLine;
  lang: Lang | undefined;
  sessionId: string;
  onRetry(clientId: string): void;
  onOpenImage(image: Viewed): void;
}) {
  const { t } = useTranslation();
  const spoken = line.source === 'voice';
  return (
    <div className="flex max-w-[86%] flex-col items-end gap-1.5 self-end">
      <p className="sr-only">{t('session.you')}</p>
      {line.images.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {line.images.map((image: ChatImage, index) => {
            const label = t('session.chat.image', { n: index + 1 });
            return (
              <ImageThumb
                key={image.key}
                sessionId={sessionId}
                image={image}
                label={label}
                onOpen={(url) => onOpenImage({ url, id: image.id, label })}
              />
            );
          })}
        </div>
      )}
      {line.text && (
        <p
          className={cn(
            LINE_TEXT,
            'rounded-card-sm border border-hairline bg-paper px-3.5 py-2 text-ink',
            spoken && 'italic',
            line.status === 'uploading' && 'text-smoke-text',
          )}
        >
          {spoken && (
            <>
              <Mic aria-hidden="true" className="mr-1.5 inline size-3 align-[-1px] text-smoke" />
              <span className="sr-only">{t('session.chat.spoken')}: </span>
            </>
          )}
          <span lang={lang}>{line.text}</span>
        </p>
      )}
      {line.status === 'uploading' && (
        <p className="mono text-[11px] leading-[14px] text-smoke-text">
          {t('session.chat.sending')}
        </p>
      )}
      {line.status === 'failed' && line.clientId && (
        <p className="flex items-center gap-2">
          <span className="mono text-[11px] leading-[14px] text-ink">
            {t('session.chat.failed')}
          </span>
          <button
            type="button"
            onClick={() => line.clientId && onRetry(line.clientId)}
            className="h-6 rounded-pill px-2.5 text-[12px] leading-6 font-w520 text-ink underline decoration-hairline underline-offset-4 transition-[background-color] duration-150 hover:bg-ink/[0.06]"
          >
            {t('session.chat.retry')}
          </button>
        </p>
      )}
    </div>
  );
}

const ACTION_ICONS = { board: Board, paper: Paper, image: ImageIcon } as const;

/** What Ada did, as a pill that shows the stage where she did it. */
function ActionRow({
  action,
  text,
  onOpenImage,
}: {
  action: MessageAction;
  text: string;
  onOpenImage(image: Viewed): void;
}) {
  const { t } = useTranslation();
  const tag = useItemTag(action.item);
  const label =
    text ||
    (action.kind === 'undo' || action.kind === 'redo'
      ? t(`session.chat.action.${action.kind}`)
      : t(`session.chat.action.${action.kind}.${action.side}`));
  const Icon = action.kind === 'undo' || action.kind === 'redo' ? Undo : ACTION_ICONS[action.side];
  const show = () => {
    const stage = useStageStore.getState();
    if (action.side === 'board') stage.pin('board');
    else if (action.side === 'paper') stage.pin('paper');
    else if (action.attachment_id && !showImageOnStage(action.attachment_id))
      onOpenImage({ url: null, id: action.attachment_id, label: t('session.chat.show.image') });
  };
  return (
    <button
      type="button"
      onClick={show}
      title={t(`session.chat.show.${action.side}`)}
      data-testid="chat-action"
      className="inline-flex h-7 max-w-full items-center gap-1.5 self-start rounded-pill border border-hairline bg-paper pr-3 pl-2.5 text-[12px] leading-4 text-ink transition-[background-color,border-color] duration-150 hover:border-ink/25 hover:bg-bone"
    >
      <Icon className={cn('size-3.5 shrink-0', action.kind === 'redo' && '-scale-x-100')} />
      <span className="truncate">{label}</span>
      {tag && (
        <span className="mono shrink-0 text-[11px] leading-[14px] text-smoke-text">{tag}</span>
      )}
    </button>
  );
}

/** What Ada's board calls the item: its title, or what kind of automaton it is. */
function useItemTag(item: string | null): string | null {
  return useBoardStore((state) => {
    if (!item) return null;
    const found = state.scene.items.find((i) => i.id === item);
    if (!found) return null;
    if ('title' in found && found.title) return found.title;
    if (found.kind === 'automaton') return found.spec.kind.toUpperCase();
    return null;
  });
}
