// The stage: her paper, Ada's board, or both side by side at exactly 1:1, with Ada's tile in the
// top right corner. A change of view reflows the panels over 240 ms with an exponential
// ease-out while their contents cross-fade: the same for Ada's requests and the Board control,
// instant under reduced motion, and never on first mount.
import type { Source } from '@tassel/shared/api';
import { type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, Pin, Screen } from '../../components/icons';
import { cn } from '../../lib/cn';
import { type StageMode, useStageStore } from './stage-store';
import { TutorTile } from './TutorTile';

// Only the panels' share of the width, their gap and their opacity move.
const REFLOW =
  'motion-safe:transition-[flex-grow,margin-left,opacity] motion-safe:duration-[240ms] motion-safe:ease-[cubic-bezier(0.16,1,0.3,1)]';

export function Stage({ source }: { source: Source }) {
  const { t } = useTranslation();
  const mode = useStageStore((state) => state.mode);
  const paperShown = mode !== 'board';
  const boardShown = mode !== 'paper';
  return (
    <div data-testid="stage" className="absolute top-2 right-4 bottom-[104px] left-4 flex">
      <Panel shown={paperShown} label={t(`session.placeholder.${source}.tag`)}>
        <Waiting source={source} />
        <TopLine pinIndicator={paperShown}>
          <Tag className="bg-paper text-ink shadow-[0_0_0_1px_var(--color-hairline)]">
            {t(`session.placeholder.${source}.tag`)}
          </Tag>
        </TopLine>
      </Panel>
      <Panel
        shown={boardShown}
        label={t('session.board.tag')}
        className={cn('board-canvas', paperShown && boardShown && 'ml-3')}
      >
        {/* The leftmost panel carries the pin indicator: the board only when it's alone. */}
        <TopLine pinIndicator={!paperShown}>
          <Tag className="bg-ink text-paper">{t('session.board.tag')}</Tag>
        </TopLine>
      </Panel>
      <TutorTile />
    </div>
  );
}

/**
 * One of the stage's two panels. A hidden panel shrinks to nothing and leaves the reading
 * order: inert, and hidden from assistive tech, while the other takes the whole stage.
 */
function Panel({
  shown,
  label,
  className,
  children,
}: {
  shown: boolean;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      aria-hidden={!shown || undefined}
      inert={!shown}
      className={cn(
        'relative min-w-0 basis-0 overflow-hidden rounded-card bg-paper',
        shown ? 'grow opacity-100' : 'grow-0 opacity-0',
        REFLOW,
        className,
      )}
    >
      {children}
    </section>
  );
}

/**
 * A panel's top line, 14px in from its top left: its tag, then 8px on, the pin indicator when
 * this is the leftmost panel. If the indicator doesn't fit beside the tag, it wraps below it.
 */
function TopLine({ pinIndicator, children }: { pinIndicator: boolean; children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute top-3.5 right-3.5 left-3.5 z-10 flex flex-wrap items-center gap-2">
      {children}
      {pinIndicator && <PinIndicator />}
    </div>
  );
}

/** A panel's lab label. */
function Tag({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        'mono inline-flex h-[26px] items-center rounded-pill px-3 text-[11px] leading-[14px] whitespace-nowrap',
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Shown on the leftmost panel while a view is pinned (R17): which view, the view Ada has asked
 * for since the pin when it differs, and Unpin, which follows Ada again. It fades in and out;
 * while hidden it keeps the last pinned view's words, so the fade never shows them change.
 */
function PinIndicator() {
  const { t } = useTranslation();
  const pinned = useStageStore((state) => state.pinned);
  const requested = useStageStore((state) => state.requested);
  const unpin = useStageStore((state) => state.unpin);
  const lastPinned = useRef<StageMode>('paper');
  if (pinned) lastPinned.current = pinned;
  const view = pinned ?? lastPinned.current;
  // What Ada had asked for when this pin was made: older requests aren't news. Updated during
  // render when the pin changes, so no render ever pairs a new pin with an old snapshot.
  const [atPin, setAtPin] = useState({ pinned, requested });
  if (atPin.pinned !== pinned) setAtPin({ pinned, requested });
  const adaAsks = pinned !== null && requested !== pinned && requested !== atPin.requested;
  return (
    <div
      aria-hidden={!pinned || undefined}
      className={cn(
        'pointer-events-auto flex h-[26px] items-center gap-2 rounded-pill bg-paper pr-[3px] pl-3 shadow-[0_0_0_1px_var(--color-hairline)] motion-safe:transition-[opacity,visibility] motion-safe:duration-[140ms]',
        pinned ? 'visible opacity-100' : 'invisible opacity-0',
      )}
    >
      <Pin className="size-3.5 shrink-0" />
      <span className="mono text-[11px] leading-[14px] whitespace-nowrap text-ink">
        {t('session.pin.label', { view: t(`session.stage.${view}`) })}
      </span>
      {adaAsks && (
        <span className="mono text-[11px] leading-[14px] whitespace-nowrap text-iris-ink">
          {t('session.pin.adaAsks', { view: t(`session.stage.${requested}`) })}
        </span>
      )}
      <button
        type="button"
        onClick={unpin}
        className="h-5 rounded-pill px-2.5 text-[13px] leading-5 font-w520 whitespace-nowrap text-ink transition-[background-color] duration-[120ms] hover:bg-bone"
      >
        {t('session.pin.unpin')}
      </button>
    </div>
  );
}

/** Her side of the stage until P3 brings the live feed: calm, centered, and static. */
function Waiting({ source }: { source: Source }) {
  const { t } = useTranslation();
  return (
    // A fixed-width block, centered: as the panel narrows, it's clipped, never reflowed.
    <div className="absolute inset-0 grid place-items-center">
      <div className="flex w-[280px] flex-col items-center gap-4 text-center text-smoke-text">
        {source === 'paper' && <DeskViewGlyph />}
        {source === 'screen' && <Screen className="size-12" />}
        {source === 'talk' && <Mic className="size-12" />}
        <p className="text-[15px] leading-snug font-w520 text-ink">
          {t(`session.placeholder.${source}.waiting`)}
        </p>
      </div>
    </div>
  );
}

/** A sheet of paper under a camera looking down: Desk View, in the icons' hand. */
function DeskViewGlyph() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="17" y="4" width="14" height="9" rx="3" />
      <circle cx="24" cy="8.5" r="2" />
      <path d="m19 16-5 8M29 16l5 8" strokeDasharray="2 3" />
      <path d="M8 28h32l-4 15H12z" />
      <path d="M15 33h17M16 38h11" />
    </svg>
  );
}
