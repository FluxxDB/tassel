// The library: every session the learner has, as cards she can sort and search, with its empty,
// loading, error and no-results states.
import type { Session, SessionSort } from '@tassel/shared/api';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppFrame } from '../../app/AppFrame';
import { useRoute } from '../../app/route-store';
import { Button } from '../../components/Button';
import { Close, Plus, Retry, Search } from '../../components/icons';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Wordmark } from '../../components/Wordmark';
import { cn } from '../../lib/cn';
import { groupByTopic } from './group-by-topic';
import { SessionCard, SessionCardSkeleton } from './SessionCard';
import { useSessions } from './useSessions';

export interface LibraryScreenProps {
  /** Opens the new-session sheet, from the strip's pill and the empty state's CTA. */
  onNewSession?(): void;
  /** Shows the one-time notice that this launch started a fresh library (AppConfig.tokenReset). */
  tokenNotice?: boolean;
  onDismissTokenNotice?(): void;
}

const SORTS: readonly SessionSort[] = ['recent', 'created', 'topic'];
// minmax(280px, 1fr): four columns at 1440 and three at 1024.
const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4';
/** A fast load never flashes the skeleton cards. */
const SKELETON_DELAY_MS = 160;
const SKELETON_KEYS = ['s1', 's2', 's3', 's4', 's5', 's6'] as const;

export function LibraryScreen({
  onNewSession,
  tokenNotice = false,
  onDismissTokenNotice,
}: LibraryScreenProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const [sort, setSort] = useState<SessionSort>('recent');
  const [search, setSearch] = useState('');
  const sessions = useSessions(sort, search);
  const [retrying, setRetrying] = useState(false);

  // A retry stays on the error panel, busy, until its answer arrives.
  useEffect(() => {
    if (sessions.status !== 'loading') setRetrying(false);
  }, [sessions.status]);
  const retry = () => {
    if (retrying) return;
    setRetrying(true);
    sessions.refetch();
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
    content = <EmptyState onNewSession={onNewSession} />;
  } else if (sessions.items.length === 0) {
    content = <NoResults query={sessions.query} onClear={() => setSearch('')} />;
  } else {
    content = <Sessions items={sessions.items} sort={sort} labelledBy={headingId} />;
  }

  return (
    <>
      <AppFrame className="relative">
        <Wordmark />
        <SearchField value={search} onChange={setSearch} />
        <Button size="sm" className="ml-auto" onClick={onNewSession}>
          <Plus className="-ml-1 size-[18px]" />
          {t('library.newSession')}
        </Button>
      </AppFrame>
      <main
        aria-labelledby={headingId}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto flex min-h-full w-full max-w-[1264px] flex-col px-8 pt-7 pb-12">
          {tokenNotice && <TokenResetNotice onDismiss={onDismissTokenNotice} />}
          {/* As tall as the sort control, so the heading doesn't move when it hides. */}
          <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <h1
              id={headingId}
              className="text-[24px] leading-tight font-w520 text-balance ko:leading-[1.6]"
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
        </div>
      </main>
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
      <ul aria-labelledby={labelledBy} className={cn(GRID, 'mt-5')}>
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
            <ul aria-labelledby={id} className={GRID}>
              {cards(group.items)}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function SearchField({ value, onChange }: { value: string; onChange(value: string): void }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
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

function TokenResetNotice({ onDismiss }: { onDismiss?(): void }) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="mb-6 flex items-center gap-4 rounded-card-sm bg-paper py-2 pr-2 pl-5 shadow-[0_0_0_1px_var(--color-hairline)]"
    >
      <p className="min-w-0 flex-1 text-[14px] text-ink text-pretty">
        {t('library.tokenReset.body')}
      </p>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        {t('library.tokenReset.dismiss')}
      </Button>
    </div>
  );
}

function LoadingGrid() {
  const { t } = useTranslation();
  const show = useDelayed(SKELETON_DELAY_MS);
  return (
    <div aria-busy="true" className="mt-5">
      <p role="status" className="sr-only">
        {t('library.loading')}
      </p>
      {show && (
        <ul aria-hidden="true" className={GRID}>
          {SKELETON_KEYS.map((key) => (
            <li key={key}>
              <SessionCardSkeleton />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A centered state that takes the grid's place. */
function StatePanel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-6 pt-10 pb-16 text-center',
        className,
      )}
    >
      {children}
    </div>
  );
}

function EmptyState({ onNewSession }: { onNewSession?(): void }) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-1 flex-col">
      <StatePanel>
        <EmptyIllustration />
        <div className="flex max-w-[44ch] flex-col gap-2">
          <h2
            id={titleId}
            className="text-[22px] leading-tight font-w520 text-balance ko:leading-[1.6]"
          >
            {t('library.empty.title')}
          </h2>
          <p className="text-[15px] text-smoke-text text-pretty">{t('library.empty.body')}</p>
        </div>
        <Button size="lg" onClick={onNewSession}>
          <Plus className="-ml-1 size-5" />
          {t('library.newSession')}
        </Button>
      </StatePanel>
    </section>
  );
}

function NoResults({ query, onClear }: { query: string; onClear(): void }) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-1 flex-col">
      <StatePanel className="gap-5">
        <div className="flex max-w-[44ch] flex-col gap-2">
          <h2
            id={titleId}
            className="text-[20px] leading-tight font-w520 text-balance wrap-anywhere ko:leading-[1.6]"
          >
            {t('library.noResults.title', { query })}
          </h2>
          <p className="text-[15px] text-smoke-text text-pretty">{t('library.noResults.body')}</p>
        </div>
        <Button variant="ghost" onClick={onClear}>
          <Close className="-ml-1 size-[18px]" />
          {t('library.clearSearch')}
        </Button>
      </StatePanel>
    </section>
  );
}

function ErrorState({ busy, onRetry }: { busy: boolean; onRetry(): void }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="flex flex-1 flex-col">
      <StatePanel>
        <div className="flex max-w-[44ch] flex-col gap-2">
          <h2 className="text-[22px] leading-tight font-w520 text-balance ko:leading-[1.6]">
            {t('library.error.title')}
          </h2>
          <p className="text-[15px] text-smoke-text text-pretty">{t('library.error.body')}</p>
        </div>
        {/*
          Busy keeps the button's width and focus: it ignores clicks rather than disabling. Both
          labels share one grid cell, so the button is as wide as the longer one throughout.
        */}
        <Button
          size="lg"
          onClick={onRetry}
          aria-disabled={busy || undefined}
          className={cn(busy && 'cursor-progress')}
        >
          <span className="grid justify-items-center">
            <span
              aria-hidden={busy || undefined}
              className={cn('col-start-1 row-start-1 flex items-center gap-2', busy && 'invisible')}
            >
              <Retry className="-ml-1 size-5" />
              {t('common.retry')}
            </span>
            <span
              aria-hidden={!busy || undefined}
              className={cn(
                'col-start-1 row-start-1 flex items-center gap-2',
                !busy && 'invisible',
              )}
            >
              <Retry className="-ml-1 size-5 motion-safe:animate-spin" />
              {t('library.error.retrying')}
            </span>
          </span>
        </Button>
      </StatePanel>
    </div>
  );
}

/**
 * A worksheet with a small DFA on it, over two pastel washes, and one of Ada's iris-ink marks:
 * the empty library's picture. Drawn in the icons' hand (1.6 strokes, round caps).
 */
function EmptyIllustration() {
  return (
    <svg
      width="200"
      height="156"
      viewBox="0 0 200 156"
      fill="none"
      aria-hidden="true"
      focusable="false"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="60" cy="62" r="44" className="fill-blush" />
      <circle cx="154" cy="118" r="26" className="fill-meringue" />
      <g transform="rotate(-4 102 80)">
        <rect x="52" y="16" width="100" height="126" rx="8" className="fill-paper stroke-ink" />
        <path d="M66 36h58M66 48h38M66 124h44" className="stroke-sky" />
        <g className="stroke-ink">
          <path d="M60 94h6M63.5 91.5 66 94l-2.5 2.5" />
          <circle cx="78" cy="94" r="11" />
          <path d="M89 94h14M100.5 91.5 103 94l-2.5 2.5" />
          <circle cx="115" cy="94" r="11" />
          <circle cx="115" cy="94" r="7" />
          <path d="M73.5 84c-3-10 12-10 9 0M80.4 82l2.1 2 1.3-2.7" />
        </g>
        <path
          d="M115 77c10 0 17.5 7.5 17.5 17s-7.5 17.5-17.5 17.5S97.5 103.5 97.5 94c0-8 5-14 13-16.5"
          className="stroke-iris-ink"
        />
      </g>
    </svg>
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

/** False for the first `ms` after mount, then true. */
function useDelayed(ms: number): boolean {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDone(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return done;
}
