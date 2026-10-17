// The stage: her paper, Ada's board, or both side by side at exactly 1:1, with Ada's tile in the
// top right corner. A change of view reflows the panels over 240 ms with an exponential
// ease-out while their contents cross-fade: the same for Ada's requests and the Board control,
// instant under reduced motion, and never on first mount.
import type { Source } from '@tassel/shared/api';
import { type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, Pin, Screen } from '../../components/icons';
import { cn } from '../../lib/cn';
import { PaperPanel } from '../../paper/PaperPanel';
import { PaperTopLineExtras } from '../../paper/PaperTopLineExtras';
import { usePaperTag } from '../../paper/use-paper-capture';
import { type StageMode, useStageStore } from './stage-store';
import { TutorTile } from './TutorTile';

// Only the panels' share of the width, their gap and their opacity move.
const REFLOW =
  'motion-safe:transition-[flex-grow,margin-left,opacity] motion-safe:duration-[240ms] motion-safe:ease-[cubic-bezier(0.16,1,0.3,1)]';

export interface StageProps {
  source: Source;
  /**
   * After Unpin, which takes its own pill (and focus) away: the session screen moves focus on to
   * the dock's Board control, whose name then reads "Board: following Ada".
   */
  onUnpinned?(): void;
}

export function Stage({ source, onUnpinned }: StageProps) {
  const { t } = useTranslation();
  const mode = useStageStore((state) => state.mode);
  // Her paper's tag follows the running source (P3): a shared window says so.
  const paperTag = usePaperTag();
  const paperShown = mode !== 'board';
  const boardShown = mode !== 'paper';
  const paper = source === 'paper';
  const tag = paper ? paperTag : t(`session.placeholder.${source}.tag`);
  return (
    <div data-testid="stage" className="absolute top-2 right-4 bottom-[104px] left-4 flex">
      <Panel shown={paperShown} label={tag}>
        {paper ? <PaperPanel fallback={<Waiting source="paper" />} /> : <Waiting source={source} />}
        <TopLine
          pinIndicator={paperShown}
          onUnpinned={onUnpinned}
          trailing={paper ? <PaperTopLineExtras /> : undefined}
        >
          <Tag className="bg-paper text-ink shadow-[0_0_0_1px_var(--color-hairline)]">{tag}</Tag>
        </TopLine>
      </Panel>
      <Panel
        shown={boardShown}
        label={t('session.board.tag')}
        className={cn('board-canvas', paperShown && boardShown && 'ml-3')}
      >
        {/* The leftmost panel carries the pin indicator: the board only when it's alone. */}
        <TopLine pinIndicator={!paperShown} onUnpinned={onUnpinned}>
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
 * this is the leftmost panel, then `trailing` (paper's extras, P3). If something doesn't fit
 * beside the tag, it wraps below it.
 */
function TopLine({
  pinIndicator,
  onUnpinned,
  trailing,
  children,
}: {
  pinIndicator: boolean;
  onUnpinned?(): void;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="pointer-events-none absolute top-3.5 right-3.5 left-3.5 z-10 flex flex-wrap items-center gap-2">
      {children}
      {pinIndicator && <PinIndicator onUnpinned={onUnpinned} />}
      {trailing}
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
function PinIndicator({ onUnpinned }: { onUnpinned?(): void }) {
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
        'pointer-events-auto h-[26px] items-center gap-2 rounded-pill bg-paper pr-px pl-3 shadow-[0_0_0_1px_var(--color-hairline)] motion-safe:duration-[140ms]',
        // Shown, it's in the row (and Unpin reachable) at once while it fades in; hidden, it stays
        // through the fade and only then leaves the row, so what follows it on the top line
        // (paper's extras, P3) never sits after an empty gap.
        pinned
          ? 'flex opacity-100 motion-safe:transition-opacity motion-safe:starting:opacity-0'
          : 'hidden opacity-0 motion-safe:transition-[opacity,display] motion-safe:transition-discrete',
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
        onClick={() => {
          unpin();
          onUnpinned?.();
        }}
        // 24px tall: WCAG 2.2's minimum target, inside the 26px pill.
        className="h-6 rounded-pill px-2.5 text-[13px] leading-6 font-w520 whitespace-nowrap text-ink transition-[background-color] duration-[120ms] hover:bg-bone"
      >
        {t('session.pin.unpin')}
      </button>
    </div>
  );
}

/** Her side of the stage until a source runs (P3's fallback): calm, centered, and static. */
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
