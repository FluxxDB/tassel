// One session in the library: a white card on bone that opens the session. The title names it;
// its subject, type, time and language describe it.
import type { Session } from '@tassel/shared/api';
import type { Lang } from '@tassel/shared/i18n';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Chip } from '../../components/Chip';
import { cn } from '../../lib/cn';
import { formatRelative } from './relative-time';

export interface SessionCardProps {
  session: Session;
  /** The time shown: last activity, or creation under the Date created sort. */
  dated: 'last_activity_at' | 'created_at';
  /** False under the Topic sort, where the section's heading already names the subject. */
  showSubject: boolean;
  now: Date;
  onOpen(id: string): void;
}

// Shared with the skeleton, so the loading grid has the real cards' size.
const CARD = 'flex h-full w-full flex-col gap-4 rounded-card bg-paper p-5';

export function SessionCard({ session, dated, showSubject, now, onOpen }: SessionCardProps) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const lang = i18n.language as Lang;
  const untitled = session.title === null;
  const time = new Date(session[dated]);
  return (
    <button
      type="button"
      onClick={() => onOpen(session.id)}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-about`}
      className={cn(
        CARD,
        'text-left transition-shadow duration-[120ms] hover:shadow-[0_0_0_1px_var(--color-hairline)] active:shadow-[0_0_0_1px_var(--color-smoke)]',
      )}
    >
      {/* Two lines reserved, so every card in the grid is the same height. */}
      <span
        id={`${id}-title`}
        lang={untitled ? undefined : session.language}
        className={cn(
          'line-clamp-2 min-h-[2lh] text-[17px] leading-[1.35] font-w520 wrap-anywhere ko:leading-[1.6] ko:break-keep',
          untitled ? 'text-smoke-text' : 'text-ink',
        )}
      >
        {session.title ?? t('session.untitled')}
      </span>
      <span id={`${id}-about`} className="mt-auto flex flex-col gap-2.5">
        <span className="flex min-w-0 items-center gap-1.5">
          {showSubject && session.subject !== null && (
            <Chip tone="bone" lang={session.language} title={session.subject}>
              {session.subject}
            </Chip>
          )}
          <Chip tone="bone" className="shrink-0">
            {t(`newSession.type.${session.type}`)}
          </Chip>
        </span>
        <span className="mono flex items-center justify-between gap-3 text-[11px] leading-4 text-smoke-text">
          <time dateTime={session[dated]} title={formatAbsolute(time, lang)}>
            {formatRelative(time, now, lang)}
          </time>
          <span>
            <span aria-hidden="true">{session.language}</span>
            <span className="sr-only">{t(`newSession.language.${session.language}`)}</span>
          </span>
        </span>
      </span>
    </button>
  );
}

/** A placeholder card for the loading grid, the size of a real one. */
export function SessionCardSkeleton() {
  return (
    <div
      data-testid="session-skeleton"
      className={cn(CARD, 'motion-safe:animate-[skeleton-pulse_1.6s_ease-in-out_infinite]')}
    >
      <span className="flex min-h-[46px] flex-col gap-2.5 pt-1">
        <span className="h-3.5 w-4/5 rounded-pill bg-hairline" />
        <span className="h-3.5 w-1/2 rounded-pill bg-hairline" />
      </span>
      <span className="mt-auto flex flex-col gap-2.5">
        <span className="flex gap-1.5">
          <span className="h-[22px] w-24 rounded-pill bg-hairline" />
          <span className="h-[22px] w-16 rounded-pill bg-hairline" />
        </span>
        <span className="flex h-4 items-center justify-between">
          <span className="h-2.5 w-20 rounded-pill bg-hairline" />
          <span className="h-2.5 w-5 rounded-pill bg-hairline" />
        </span>
      </span>
    </div>
  );
}

const absolute = new Map<Lang, Intl.DateTimeFormat>();

/** The exact date and time, for the relative time's tooltip. */
function formatAbsolute(date: Date, lang: Lang): string {
  let format = absolute.get(lang);
  if (!format) {
    format = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' });
    absolute.set(lang, format);
  }
  return format.format(date);
}
