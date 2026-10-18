// The library: every session the learner has, as cards she can sort and search, with its empty,
// loading, error and no-results states.
import { deleteSession, patchSession, type Session, type SessionSort } from '@tassel/shared/api';
import { type ReactNode, type RefObject, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppFrame } from '../../app/AppFrame';
import { useRoute } from '../../app/route-store';
import { Button } from '../../components/Button';
import { ChevronDown, Close, Plus, Search } from '../../components/icons';
import { Menu, MenuRadioGroup } from '../../components/Menu';
import { Sheet } from '../../components/Sheet';
import { Wordmark } from '../../components/Wordmark';
import { useApi } from '../../lib/api';
import { cn } from '../../lib/cn';
import { NewSessionSheet } from '../new-session/NewSessionSheet';
import { SettingsButton } from '../settings/SettingsView';
import { groupByTopic } from './group-by-topic';
import { EmptyState, ErrorState, LoadingGrid, NoResults, TokenResetNotice } from './LibraryStates';
import { CARD_GRID, SessionCard } from './SessionCard';
import { useSessions } from './useSessions';

export interface LibraryScreenProps {
  /** Shows the one-time notice that this launch started a fresh library (AppConfig.tokenReset). */
  tokenNotice?: boolean;
  onDismissTokenNotice?(): void;
  /** She's back from a session: focus lands on the heading rather than the page body. */
  returning?: boolean;
}

const SORTS: readonly SessionSort[] = ['recent', 'created', 'topic'];

export function LibraryScreen({
  tokenNotice = false,
  onDismissTokenNotice,
  returning = false,
}: LibraryScreenProps) {
  const { t } = useTranslation();
  const api = useApi();
  const headingId = useId();
  const [sort, setSort] = useState<SessionSort>('recent');
  const [search, setSearch] = useState('');
  const sessions = useSessions(sort, search);
  const [retrying, setRetrying] = useState(false);
  // The strip's pill and the empty state's CTA both open the new session sheet.
  const [creating, setCreating] = useState(false);
  const newSession = () => setCreating(true);
  // When a panel takes its focused button away, focus moves on rather than falling to <body>.
  const heading = useRef<HTMLHeadingElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<Session | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);

  useEffect(() => {
    if (returning && document.activeElement === document.body) heading.current?.focus();
  }, [returning]);

  // A retry stays on the error panel, busy, until its answer arrives. If it succeeds, the panel
  // and its Retry button go, so focus moves to the heading above the sessions.
  useEffect(() => {
    if (sessions.status === 'loading') return;
    if (retrying && sessions.status === 'ready' && document.activeElement === document.body) {
      heading.current?.focus();
    }
    setRetrying(false);
  }, [sessions.status, retrying]);
  const retry = () => {
    if (retrying) return;
    setRetrying(true);
    sessions.refetch();
  };
  const clearSearch = () => {
    setSearch('');
    searchInput.current?.focus();
  };
  const dismissNotice = () => {
    onDismissTokenNotice?.();
    heading.current?.focus();
  };

  // Her title (title_source "student", so Ada never renames it). The card shows it once the
  // library has it again; a rename doesn't move the card under Recent activity.
  const rename = async (id: string, title: string) => {
    await patchSession(api, id, { title });
    sessions.refetch();
  };
  const confirmDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteFailed(false);
    try {
      await deleteSession(api, deleting.id);
      setDeleting(null);
      sessions.refetch();
      heading.current?.focus();
    } catch {
      setDeleteFailed(true);
    } finally {
      setDeleteBusy(false);
    }
  };

  const failed = sessions.status === 'error' || (sessions.status === 'loading' && retrying);
  const emptyLibrary =
    sessions.status === 'ready' && sessions.items.length === 0 && sessions.query === '';

  let content: ReactNode;
  if (failed) {
    content = <ErrorState busy={retrying} onRetry={retry} />;
  } else if (sessions.status === 'loading') {
    content = <LoadingGrid />;
  } else if (emptyLibrary) {
    content = <EmptyState onNewSession={newSession} />;
  } else if (sessions.items.length === 0) {
    content = <NoResults query={sessions.query} onClear={clearSearch} />;
  } else {
    content = (
      <Sessions
        items={sessions.items}
        sort={sort}
        labelledBy={headingId}
        onRename={rename}
        onDelete={(session) => {
          setDeleteFailed(false);
          setDeleting(session);
        }}
      />
    );
  }

  const sortable = !emptyLibrary && !failed;
  return (
    <>
      <AppFrame className="relative">
        <Wordmark />
        {/* Centered on the window, whatever the strip's insets on either side. */}
        <div className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5">
          <SearchField value={search} onChange={setSearch} inputRef={searchInput} />
          {sortable && <SortMenu value={sort} onChange={setSort} />}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <SettingsButton />
          <Button size="sm" onClick={newSession}>
            <Plus className="-ml-1 size-[18px]" />
            {t('library.newSession')}
          </Button>
        </div>
      </AppFrame>
      <main
        aria-labelledby={headingId}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto flex min-h-full w-full max-w-[1264px] flex-col px-8 pt-3 pb-12">
          {tokenNotice && <TokenResetNotice onDismiss={dismissNotice} />}
          {/*
            The page's name for assistive tech, and a landing spot for focus from code (see
            above): never a Tab stop. The strip already says where she is, so it isn't shown.
          */}
          <h1 id={headingId} ref={heading} tabIndex={-1} className="sr-only">
            {t('library.title')}
          </h1>
          {content}
          {/* Says what a search found, politely (WCAG 4.1.3); silent without a search. */}
          <p role="status" data-testid="search-outcome" className="sr-only">
            {sessions.status === 'ready' && sessions.query !== ''
              ? sessions.items.length === 0
                ? t('library.noResults.title', { query: sessions.query })
                : t('library.results', { count: sessions.items.length })
              : ''}
          </p>
        </div>
      </main>
      <NewSessionSheet open={creating} onOpenChange={setCreating} />
      <Sheet
        open={deleting !== null}
        onOpenChange={(open) => !open && !deleteBusy && setDeleting(null)}
        title={t('library.delete.title', { title: deleting?.title ?? t('session.untitled') })}
        description={t('library.delete.body')}
      >
        <div className="flex items-center justify-end gap-3">
          {deleteFailed && (
            <p role="alert" className="mr-auto text-[13px] leading-snug text-ink">
              {t('library.delete.failed')}
            </p>
          )}
          {/* Keep it comes first, so it has focus when the sheet opens. */}
          <Button variant="ghost" size="lg" onClick={() => setDeleting(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            size="lg"
            busy={deleteBusy}
            busyLabel={t('library.delete.deleting')}
            onClick={() => void confirmDelete()}
          >
            {t('library.delete.confirm')}
          </Button>
        </div>
      </Sheet>
    </>
  );
}

/** The cards, in one grid, or in a section per subject under the Topic sort. */
function Sessions({
  items,
  sort,
  labelledBy,
  onRename,
  onDelete,
}: {
  items: Session[];
  sort: SessionSort;
  labelledBy: string;
  onRename(id: string, title: string): Promise<void>;
  onDelete(session: Session): void;
}) {
  const { t } = useTranslation();
  const groupId = useId();
  const now = useNow();
  const openSession = useRoute((state) => state.openSession);
  const cards = (list: Session[]) =>
    list.map((session) => (
      <li key={session.id}>
        <SessionCard
          session={session}
          dated={sort === 'created' ? 'created_at' : 'last_activity_at'}
          showSubject={sort !== 'topic'}
          now={now}
          onOpen={openSession}
          onRename={onRename}
          onDelete={onDelete}
        />
      </li>
    ));

  if (sort !== 'topic') {
    return (
      <ul aria-labelledby={labelledBy} className={cn(CARD_GRID, 'mt-5')}>
        {cards(items)}
      </ul>
    );
  }
  return (
    <div className="mt-5 flex flex-col gap-8">
      {groupByTopic(items, t('library.noTopic')).map((group, index) => {
        const id = `${groupId}-${index}`;
        const [first] = group.items;
        return (
          // A session sits in one group only, so its first session's id keys the group.
          <section key={first.id} aria-labelledby={id} className="flex flex-col gap-3">
            <h2
              id={id}
              lang={first.subject === null ? undefined : first.language}
              className="text-[16px] leading-snug font-w520 wrap-anywhere ko:leading-[1.6]"
            >
              {group.topic}
            </h2>
            <ul aria-labelledby={id} className={CARD_GRID}>
              {cards(group.items)}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** The sort, as a menu: the button names the current order, the menu offers all three. */
function SortMenu({ value, onChange }: { value: SessionSort; onChange(sort: SessionSort): void }) {
  const { t } = useTranslation();
  const current = t(`library.sort.${value}`);
  return (
    <Menu
      label={t('library.sort.label')}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('library.sort.current', { sort: current })}
          className="gap-1.5 px-3 text-[13px] font-normal text-smoke-text hover:text-ink data-[state=open]:bg-ink/[0.06] data-[state=open]:text-ink"
        >
          {current}
          <ChevronDown className="size-4" />
        </Button>
      }
    >
      <MenuRadioGroup<SessionSort>
        label={t('library.sort.label')}
        value={value}
        onChange={onChange}
        options={SORTS.map((sort) => ({ value: sort, label: t(`library.sort.${sort}`) }))}
      />
    </Menu>
  );
}

function SearchField({
  value,
  onChange,
  inputRef: input,
}: {
  value: string;
  onChange(value: string): void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const { t } = useTranslation();
  return (
    <search className="relative w-[min(320px,26vw)]">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-smoke-text" />
      <input
        ref={input}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value !== '') {
            event.preventDefault();
            onChange('');
          }
        }}
        aria-label={t('library.search')}
        placeholder={t('library.searchPlaceholder')}
        spellCheck={false}
        className="h-9 w-full rounded-input bg-paper pr-9 pl-9 text-[14px] text-ink shadow-[0_0_0_1px_var(--color-hairline)] placeholder:text-smoke-text"
      />
      {value !== '' && (
        <button
          type="button"
          aria-label={t('library.clearSearch')}
          onClick={() => {
            onChange('');
            input.current?.focus();
          }}
          className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-pill text-smoke-text transition-[color,background-color] duration-[120ms] hover:bg-ink/[0.06] hover:text-ink"
        >
          <Close className="size-4" />
        </button>
      )}
    </search>
  );
}

/** The current time, refreshed every minute, so "2 minutes ago" keeps up while she waits. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
