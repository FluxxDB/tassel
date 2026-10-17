// The session's 52px strip: the wordmark, the title and its chips centered in the free space,
// and on the right the source, the timer and the session's language.
import type { Session, Source } from '@tassel/shared/api';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AppFrame } from '../../app/AppFrame';
import { Chip } from '../../components/Chip';
import { Wordmark } from '../../components/Wordmark';
import { cn } from '../../lib/cn';
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
  const heading = useRef<HTMLHeadingElement>(null);
  const landed = useRef(false);
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
              className={cn(HEADING, session.title === null ? 'text-smoke-text' : 'text-ink')}
            >
              {session.title ?? t('session.untitled')}
            </h1>
            {session.subject !== null && (
              // The cap sits on a wrapper: on the Chip itself it would compete with the Chip's
              // own max-w-full, and cn doesn't resolve conflicting utilities.
              <span className="flex max-w-[200px] min-w-0 shrink-0">
                <Chip lang={session.language} title={session.subject}>
                  {session.subject}
                </Chip>
              </span>
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
        {session && <SourceLabel source={session.source} />}
        <Timer start={startedAt} />
        {session && (
          <Chip tone="ink">
            <span aria-hidden="true">{session.language}</span>
            <span className="sr-only">{t(`newSession.language.${session.language}`)}</span>
          </Chip>
        )}
      </div>
    </AppFrame>
  );
}

/**
 * What Ada works from, beside its dot. The dot turns live red only while something is really
 * captured; P1 captures nothing, so it stays neutral and the label doesn't claim "Live".
 */
function SourceLabel({ source, live = false }: { source: Source; live?: boolean }) {
  const { t } = useTranslation();
  return (
    <span className="mono flex items-center gap-1.5 text-[11px] leading-[14px] text-ink">
      <span
        aria-hidden="true"
        className={cn('size-[7px] rounded-pill', live ? 'bg-live' : 'bg-smoke')}
      />
      {live ? t(`session.liveSource.${source}`) : t(`session.source.${source}`)}
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
