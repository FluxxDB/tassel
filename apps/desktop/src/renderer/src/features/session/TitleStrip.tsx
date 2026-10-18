// The session's 52px strip: the wordmark, the title and its chips centered in the free space,
// and on the right the source, the timer and the session's language. In a live voice session the
// language opens the language menu, and a title Ada gives the session types on (spec §5.1).
import type { Session, Source } from '@tassel/shared/api';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppFrame } from '../../app/AppFrame';
import { prefersReducedMotion } from '../../board/motion';
import { Chip } from '../../components/Chip';
import { Wordmark } from '../../components/Wordmark';
import { cn } from '../../lib/cn';
import { usePaperStore } from '../../paper/paper-store';
import { usePaperLive } from '../../paper/use-paper-capture';
import { LanguageMenu } from '../voice/LanguageMenu';
import { useLiveVoice } from '../voice/live-voice';
import { useElapsed } from './use-elapsed';

export interface TitleStripProps {
  /** Null while the session loads, or if it couldn't be loaded (`failed`). */
  session: Session | null;
  failed: boolean;
  /** When the session screen opened: the timer counts from here (R7). */
  startedAt: Date;
}

// A landing spot for focus: never a Tab stop, and no ring, since nothing here is a control.
const HEADING = 'min-w-0 truncate text-[15px] leading-[22px] font-w520 focus-visible:outline-none';

export function TitleStrip({ session, failed, startedAt }: TitleStripProps) {
  const { t } = useTranslation();
  // The dot is live red only while her paper is really delivering frames (R29).
  const paperLive = usePaperLive();
  const heading = useRef<HTMLHeadingElement>(null);
  const landed = useRef(false);
  const live = useLiveVoice((state) => state.live);
  // The title the session opened with shows at once; one that comes later types on.
  const opening = useRef<string | null | undefined>(undefined);
  if (session && opening.current === undefined) opening.current = session.title;
  const shown = session !== null || failed;
  // She arrives from a card or the new session sheet, whose button is gone: focus lands on the
  // title once it shows, so it isn't left on the page body.
  useEffect(() => {
    if (!shown || landed.current) return;
    landed.current = true;
    if (document.activeElement === document.body) heading.current?.focus();
  }, [shown]);
  return (
    <AppFrame>
      <Wordmark />
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2.5">
        {session && (
          <>
            <h1
              ref={heading}
              tabIndex={-1}
              lang={session.title === null ? undefined : session.language}
              aria-label={session.title ?? undefined}
              className={cn(HEADING, session.title === null ? 'text-smoke-text' : 'text-ink')}
            >
              {session.title === null ? (
                t('session.untitled')
              ) : (
                <TypedTitle title={session.title} opening={opening.current ?? null} />
              )}
            </h1>
            {session.subject !== null && (
              // The cap replaces the Chip's own max-w-full (cn settles the two).
              <Chip
                lang={session.language}
                title={session.subject}
                className="max-w-[200px] shrink-0"
              >
                {session.subject}
              </Chip>
            )}
            <Chip className="shrink-0">{t(`newSession.type.${session.type}`)}</Chip>
          </>
        )}
        {!session && failed && (
          <h1 ref={heading} tabIndex={-1} className={cn(HEADING, 'text-smoke-text')}>
            {t('session.loadError')}
          </h1>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3.5">
        {session && (
          <SourceLabel source={session.source} live={session.source === 'paper' && paperLive} />
        )}
        <Timer start={startedAt} />
        {session && live && <LanguageMenu session={session} />}
        {session && !live && (
          <Chip tone="ink">
            <span aria-hidden="true">{session.language}</span>
            <span className="sr-only">{t(`newSession.language.${session.language}`)}</span>
          </Chip>
        )}
      </div>
    </AppFrame>
  );
}

/** About 30 ms a character (spec §5.1). */
const TYPE_MS = 30;

/**
 * A title that arrives while the screen is open types on, a character every 30 ms, and shows at
 * once under reduced motion. The title it opened with shows at once. The rest of the title is
 * laid out but invisible, so the strip doesn't shift, and the heading's name is always the whole
 * title (its aria-label).
 */
function TypedTitle({ title, opening }: { title: string; opening: string | null }) {
  const chars = Array.from(title);
  const [shown, setShown] = useState(() =>
    title === opening || prefersReducedMotion() ? chars.length : 0,
  );
  const first = useRef<string | null>(opening);
  // Before paint, so a new title never flashes whole first.
  useLayoutEffect(() => {
    if (title === first.current) return;
    first.current = title;
    const total = Array.from(title).length;
    if (prefersReducedMotion()) {
      setShown(total);
      return;
    }
    setShown(0);
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      setShown(count);
      if (count >= total) clearInterval(timer);
    }, TYPE_MS);
    return () => clearInterval(timer);
  }, [title]);
  return (
    <>
      <span data-testid="title-typed">{chars.slice(0, shown).join('')}</span>
      <span aria-hidden="true" className="invisible">
        {chars.slice(shown).join('')}
      </span>
    </>
  );
}

/**
 * What Ada works from, beside its dot. The dot turns live red only while something is really
 * captured (P3's paper feed); otherwise it stays neutral and the label doesn't claim "Live".
 */
function SourceLabel({ source, live = false }: { source: Source; live?: boolean }) {
  const webcam = usePaperStore((state) => state.kind === 'webcam');
  const { t } = useTranslation();
  return (
    <span className="mono flex items-center gap-1.5 text-[11px] leading-[14px] text-ink">
      <span
        aria-hidden="true"
        className={cn('size-[7px] rounded-pill', live ? 'bg-live' : 'bg-smoke')}
      />
      {source === 'paper' && webcam
        ? t(live ? 'paper.webcam.live' : 'paper.webcam.source')
        : live
          ? t(`session.liveSource.${source}`)
          : t(`session.source.${source}`)}
    </span>
  );
}

/** Its own component, so only the timer re-renders each second. Not a live region. */
function Timer({ start }: { start: Date }) {
  const { t } = useTranslation();
  const elapsed = useElapsed(start);
  return (
    <span
      role="timer"
      aria-label={t('session.timer', { elapsed })}
      className="mono text-[11px] leading-[14px] text-smoke-text"
    >
      {elapsed}
    </span>
  );
}
