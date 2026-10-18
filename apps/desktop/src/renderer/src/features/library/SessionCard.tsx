// One session in the library: a white card on bone that opens the session. The title names it;
// its subject, type, time and language describe it. The card is a container: one stretched
// button opens the session, and its "⋯" menu sits above it, with Rename (the title becomes a
// field: Enter saves, Escape cancels) and Delete (which the library confirms).
import type { Session } from '@tassel/shared/api';
import type { Lang } from '@tassel/shared/i18n';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chip } from '../../components/Chip';
import { IconButton } from '../../components/IconButton';
import { More } from '../../components/icons';
import { Menu, MenuItem } from '../../components/Menu';
import { TitleField } from '../../components/TitleField';
import { cn } from '../../lib/cn';
import { firstClickOnly } from '../../lib/first-click';
import { formatRelative } from './relative-time';

export interface SessionCardProps {
  session: Session;
  /** The time shown: last activity, or creation under the Date created sort. */
  dated: 'last_activity_at' | 'created_at';
  /** False under the Topic sort, where the section's heading already names the subject. */
  showSubject: boolean;
  now: Date;
  onOpen(id: string): void;
  /** Saves her title (patchSession); rejects if it couldn't be saved. */
  onRename?(id: string, title: string): Promise<void>;
  /** Asks to delete the session; the library confirms first. */
  onDelete?(session: Session): void;
}

// Shared with the skeleton, so the loading grid has the real cards' size.
const CARD = 'flex h-full w-full flex-col gap-4 rounded-card bg-paper p-5';

/** The cards' grid, minmax(280px, 1fr): four columns at 1440 and three at 1024. */
export const CARD_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4';

export function SessionCard({
  session,
  dated,
  showSubject,
  now,
  onOpen,
  onRename,
  onDelete,
}: SessionCardProps) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const lang = i18n.language as Lang;
  const [renaming, setRenaming] = useState(false);
  const untitled = session.title === null;
  const title = session.title ?? t('session.untitled');
  const time = new Date(session[dated]);
  return (
    <div
      data-testid="session-card"
      className={cn(
        CARD,
        'group relative transition-shadow duration-[120ms] has-[>button:first-child:hover]:shadow-[0_0_0_1px_var(--color-hairline)] has-[>button:first-child:active]:shadow-[0_0_0_1px_var(--color-smoke)]',
      )}
    >
      <button
        type="button"
        // The second click of a double click on End lands here once the library shows: ignore it.
        onClick={firstClickOnly(() => onOpen(session.id))}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-about`}
        className="absolute inset-0 rounded-card"
      />
      {/*
        Two lines at Korean leading (2 × 1.6em) are reserved for every title, so every card in
        the grid is the same height, whatever the session's language.
      */}
      <div className="pointer-events-none relative flex min-h-[3.2em] items-start gap-2 text-[17px] leading-[1.35] ko:leading-[1.6]">
        {renaming && onRename ? (
          <TitleField
            initial={session.title ?? ''}
            lang={session.language}
            label={t('library.card.renameLabel')}
            onSave={(next) => onRename(session.id, next)}
            onDone={() => setRenaming(false)}
            className="pointer-events-auto -mx-1.5 -my-0.5 min-w-0 flex-1 px-1.5 py-0.5 text-[17px] font-w520"
          />
        ) : (
          <span
            id={`${id}-title`}
            lang={untitled ? undefined : session.language}
            className={cn(
              'line-clamp-2 min-w-0 flex-1 font-w520 wrap-anywhere ko:break-keep',
              untitled ? 'text-smoke-text' : 'text-ink',
            )}
          >
            {title}
          </span>
        )}
        {(onRename || onDelete) && (
          <Menu
            trigger={
              <IconButton
                label={t('library.card.menu', { title })}
                title={t('library.card.menuShort')}
                className="pointer-events-auto -mt-1.5 -mr-2 size-8 text-smoke-text hover:text-ink data-[state=open]:bg-ink/[0.06] data-[state=open]:text-ink [&>svg]:size-5"
              >
                <More />
              </IconButton>
            }
          >
            {onRename && (
              <MenuItem onSelect={() => setRenaming(true)}>{t('library.card.rename')}</MenuItem>
            )}
            {onDelete && (
              <MenuItem onSelect={() => onDelete(session)}>{t('library.card.delete')}</MenuItem>
            )}
          </Menu>
        )}
      </div>
      <span id={`${id}-about`} className="pointer-events-none relative mt-auto flex flex-col gap-2.5">
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
    </div>
  );
}

/** A placeholder card for the loading grid, the size of a real one. */
export function SessionCardSkeleton() {
  return (
    <div
      data-testid="session-skeleton"
      className={cn(CARD, 'motion-safe:animate-[skeleton-pulse_1.6s_ease-in-out_infinite]')}
    >
      <span className="flex min-h-[54.4px] flex-col gap-2.5 pt-1">
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
