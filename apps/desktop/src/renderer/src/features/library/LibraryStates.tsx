// The library's states that take the grid's place: loading, empty, no results and error, and
// the notice that this launch started a fresh library.
import { type ReactNode, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Close, Plus, Retry } from '../../components/icons';
import { cn } from '../../lib/cn';
import { CARD_GRID, SessionCardSkeleton } from './SessionCard';

/** A fast load never flashes the skeleton cards. */
const SKELETON_DELAY_MS = 160;
const SKELETON_KEYS = ['s1', 's2', 's3', 's4', 's5', 's6'] as const;

export function TokenResetNotice({ onDismiss }: { onDismiss?(): void }) {
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

export function LoadingGrid() {
  const { t } = useTranslation();
  const show = useDelayed(SKELETON_DELAY_MS);
  return (
    <div aria-busy="true" className="mt-5">
      <p role="status" className="sr-only">
        {t('library.loading')}
      </p>
      {show && (
        <ul aria-hidden="true" className={CARD_GRID}>
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

export function EmptyState({ onNewSession }: { onNewSession(): void }) {
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

export function NoResults({ query, onClear }: { query: string; onClear(): void }) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-1 flex-col">
      <StatePanel>
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

export function ErrorState({ busy, onRetry }: { busy: boolean; onRetry(): void }) {
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
        <Button
          size="lg"
          busy={busy}
          busyLabel={
            <>
              <Retry className="-ml-1 size-5 motion-safe:animate-spin" />
              {t('library.error.retrying')}
            </>
          }
          onClick={onRetry}
        >
          <Retry className="-ml-1 size-5" />
          {t('common.retry')}
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

/** False for the first `ms` after mount, then true. */
function useDelayed(ms: number): boolean {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDone(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return done;
}
