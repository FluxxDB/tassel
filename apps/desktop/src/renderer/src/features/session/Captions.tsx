// Captions as subtitles: an ink panel above the dock, the previous line small and muted, the
// current one large, each with its speaker. It grows upward from a fixed bottom edge, so a new
// line never moves the dock. C and the dock button hide and show it.
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/cn';
import { type CaptionLine, useStageStore } from './stage-store';

export function Captions() {
  const { t } = useTranslation();
  const on = useStageStore((state) => state.captionsOn);
  const { previous, current } = useStageStore((state) => state.caption);
  if (!on) return null;
  return (
    <div
      data-testid="captions"
      className="absolute bottom-[118px] left-1/2 z-20 w-[min(880px,calc(100%-144px))] -translate-x-1/2 rounded-card bg-ink px-[22px] pt-3.5 pb-4 text-paper"
    >
      {previous && (
        <Line line={previous} className="mb-1.5 text-[15px] leading-[19px] text-caption-muted" />
      )}
      {/* Only the current line is announced, politely. */}
      <div aria-live="polite">
        {current ? (
          <Line line={current} className="text-[21px] leading-[1.35] font-[450]" />
        ) : (
          <p className="text-[15px] leading-[19px] text-caption-muted">
            {t('session.captions.hint')}
          </p>
        )}
      </div>
    </div>
  );
}

function Line({ line, className }: { line: CaptionLine; className: string }) {
  const { t } = useTranslation();
  const tutor = line.speaker === 'tutor';
  return (
    <p className={className}>
      {/* Ada's label carries her iris; the student's never does. */}
      <span
        className={cn(
          'mono mr-2 align-[0.15em] text-[11px] leading-[14px]',
          tutor ? 'text-iris' : 'text-caption-muted',
        )}
      >
        {tutor ? t('session.tutorName') : t('session.you')}
      </span>
      <span lang={line.lang}>{line.text}</span>
    </p>
  );
}
