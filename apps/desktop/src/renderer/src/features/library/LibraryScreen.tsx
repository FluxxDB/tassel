// The library: every session the learner has, as cards she can sort and search, with its empty,
// loading, error and no-results states.
import type { Session, SessionSort } from '@tassel/shared/api';
import { type ReactNode, type RefObject, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppFrame } from '../../app/AppFrame';
import { useRoute } from '../../app/route-store';
import { Button } from '../../components/Button';
import { Close, Plus, Search } from '../../components/icons';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Wordmark } from '../../components/Wordmark';
import { cn } from '../../lib/cn';
import { NewSessionSheet } from '../new-session/NewSessionSheet';
import { groupByTopic } from './group-by-topic';
import { EmptyState, ErrorState, LoadingGrid, NoResults, TokenResetNotice } from './LibraryStates';
import { CARD_GRID, SessionCard } from './SessionCard';
import { useSessions } from './useSessions';

export interface LibraryScreenProps {
  /** Shows the one-time notice that this launch started a fresh library (AppConfig.tokenReset). */
  tokenNotice?: boolean;
  onDismissTokenNotice?(): void;
}

const SORTS: readonly SessionSort[] = ['recent', 'created', 'topic'];

export function LibraryScreen({ tokenNotice = false, onDismissTokenNotice }: LibraryScreenProps) {
  const { t } = useTranslation();
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
    content = <Sessions items={sessions.items} sort={sort} labelledBy={headingId} />;
  }

  return (
    <>
      <AppFrame className="relative">
        <Wordmark />
        <SearchField value={search} onChange={setSearch} inputRef={searchInput} />
        <Button size="sm" className="ml-auto" onClick={newSession}>
          <Plus className="-ml-1 size-[18px]" />
          {t('library.newSession')}
        </Button>
      </AppFrame>
      <main
        aria-labelledby={headingId}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto flex min-h-full w-full max-w-[1264px] flex-col px-8 pt-7 pb-12">
          {tokenNotice && <TokenResetNotice onDismiss={dismissNotice} />}
          {/* As tall as the sort control, so the heading doesn't move when it hides. */}
          <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <h1
              id={headingId}
              ref={heading}
              // A landing spot for focus from code (see above): never a Tab stop, and no ring,
              // since nothing here can be operated.
              tabIndex={-1}
              className="text-[24px] leading-tight font-w520 text-balance focus-visible:outline-none ko:leading-[1.6]"
            >
              {t('library.title')}
            </h1>
            {!emptyLibrary && !failed && (
              <SegmentedControl<SessionSort>
                label={t('library.sort.label')}
                options={SORTS.map((value) => ({ value, label: t(`library.sort.${value}`) }))}
                value={sort}
                onChange={setSort}
              />
            )}
          </div>
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
    </>
  );
}

/** The cards, in one grid, or in a section per subject under the Topic sort. */
function Sessions({
  items,
  sort,
  labelledBy,
}: {
  items: Session[];
  sort: SessionSort;
  labelledBy: string;
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
    // Centered on the window, whatever the strip's insets on either side.
    <search className="absolute top-1/2 left-1/2 w-[min(400px,36vw)] -translate-x-1/2 -translate-y-1/2">
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
