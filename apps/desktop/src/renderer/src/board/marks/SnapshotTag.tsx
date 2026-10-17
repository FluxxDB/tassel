/// <reference types="vite/client" />
// The paper panel's top-line pill while Ada marks a snapshot, after P3's pills: 26 px, paper,
// a hairline. Loading, it says so; a failed load shows for 4 s; frozen, it reads the session
// timer's time when the frame was taken (plan review M1, overturning P5-R9's wall clock), then
// Back to live. Chrome, so in the UI's language.
import type { JSX, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatElapsed } from '../../features/session/use-elapsed';
import { MOTION } from '../motion';
import { useMarksStore } from './marks-store';
import './marks.css';

/** How long a failed load's notice stays. */
const FAILED_NOTICE_MS = 4_000;

const PILL =
  'mark-fade pointer-events-auto flex h-[26px] items-center rounded-pill bg-paper shadow-[0_0_0_1px_var(--color-hairline)]';
const FADE = { animationDuration: `${MOTION.fadeMs}ms`, animationTimingFunction: MOTION.ease };

export function SnapshotTag(): JSX.Element | null {
  const { t } = useTranslation();
  const status = useMarksStore((state) => state.status);
  const capturedAt = useMarksStore((state) => state.snapshot?.capturedAt ?? null);
  const startedAt = useMarksStore((state) => state.sessionStartedAt);
  const goLive = useMarksStore((state) => state.goLive);
  const failedNotice = useFailedNotice();

  if (status === 'loading') return <Notice>{t('marks.loading')}</Notice>;
  if (status === 'failed' && failedNotice) return <Notice>{t('marks.failed')}</Notice>;
  if (status !== 'frozen' || capturedAt === null) return null;
  return (
    <div data-testid="snapshot-tag" className={`${PILL} gap-2 pr-px pl-3`} style={FADE}>
      <span
        data-testid="snapshot-time"
        className="mono text-[11px] leading-[14px] whitespace-nowrap text-ink"
      >
        {t('marks.snapshot', { time: sessionTime(capturedAt, startedAt) })}
      </span>
      <button
        type="button"
        onClick={goLive}
        // 24px tall: WCAG 2.2's minimum target, inside the 26px pill.
        className="h-6 rounded-pill px-2.5 text-[13px] leading-6 font-w520 whitespace-nowrap text-ink transition-[background-color] duration-[120ms] hover:bg-bone"
      >
        {t('marks.backToLive')}
      </button>
    </div>
  );
}

/** A loading or failure notice, announced politely. */
function Notice({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="snapshot-tag"
      role="status"
      className={`${PILL} px-3 text-[13px] leading-4 whitespace-nowrap text-ink`}
      style={FADE}
    >
      {children}
    </div>
  );
}

/** The session timer's reading when the frame was captured, as the title strip shows it. */
function sessionTime(capturedAt: string, startedAt: number | null): string {
  const captured = Date.parse(capturedAt);
  if (!Number.isFinite(captured)) return formatElapsed(0);
  return formatElapsed(captured - (startedAt ?? captured));
}

/** True for 4 s after each failed load. */
function useFailedNotice(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = useMarksStore.subscribe((state, previous) => {
      if (state.status === previous.status) return;
      clearTimeout(timer);
      setShown(state.status === 'failed');
      if (state.status === 'failed') timer = setTimeout(() => setShown(false), FAILED_NOTICE_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);
  return shown;
}
