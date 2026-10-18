// Ada's tile: a small, live presence that floats over the stage, 212×176 on blush in its top right
// corner until she moves it. Her state is always named on it; the iris ring shows only while she
// speaks, and never alone, breathing unless motion is reduced.
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { FloatingTile } from '../../components/FloatingTile';
import { useReducedMotion } from '../../components/use-reduced-motion';
import { cn } from '../../lib/cn';
import { useLiveVoice } from '../voice/live-voice';
import { AvatarPlaceholder } from './AvatarPlaceholder';
import { useStageStore } from './stage-store';
import './tiles.css';

export function TutorTile({ inset, bottomClearance }: { inset: number; bottomClearance: number }) {
  const { t } = useTranslation();
  const state = useStageStore((store) => store.tutorState);
  const connection = useStageStore((store) => store.connection);
  const live = useLiveVoice((store) => store.live);
  const client = useLiveVoice((store) => store.client);
  const reducedMotion = useReducedMotion();
  const captionId = useId();
  // The live tutor's connection, until she's there: then her state, as with the scripted tutor.
  const status =
    live &&
    (connection === 'connecting' || connection === 'reconnecting' || connection === 'failed')
      ? t(`voice.connection.${connection}`)
      : null;
  const speaking = state === 'speaking';
  return (
    <FloatingTile
      id="tutor"
      label={t('session.tile.ada')}
      defaultCorner="top-right"
      defaultSize={{ w: 212, h: 176 }}
      minWidth={160}
      maxWidth={360}
      inset={inset}
      bottomClearance={bottomClearance}
    >
      <figure
        aria-labelledby={captionId}
        data-testid="tutor-tile"
        className={cn(
          // A box-shadow ring, so it never shifts the layout.
          'relative m-0 size-full overflow-hidden rounded-card bg-blush motion-safe:transition-shadow motion-safe:duration-150',
          speaking && 'shadow-[0_0_0_2px_var(--color-iris)]',
          speaking && !reducedMotion && 'tutor-speaking-pulse',
        )}
      >
        {/* 156px at the default size, centered 6px from the top: it scales with the tile. */}
        <AvatarPlaceholder className="absolute top-[3.4%] left-1/2 aspect-square h-[88.6%] -translate-x-1/2" />
        <figcaption
          id={captionId}
          className="absolute bottom-2.5 left-2.5 flex h-[27px] items-center gap-1.5 rounded-pill bg-paper px-2.5"
        >
          {status === null ? (
            <>
              <span className="text-[13px] leading-4 font-w520 text-ink">
                {t('session.tutorName')}
              </span>
              <span className="mono text-[11px] leading-[14px] text-iris-ink">
                {t(`session.tutorState.${state}`)}
              </span>
            </>
          ) : (
            <span className="text-[13px] leading-4 font-w520 text-ink">{status}</span>
          )}
        </figcaption>
        {live && connection === 'failed' && (
          <button
            type="button"
            onClick={() => void client?.voice?.reconnect()}
            className="absolute top-2.5 right-2.5 h-[27px] rounded-pill bg-ink px-3 text-[13px] leading-4 font-w520 text-paper hover:bg-ink/85"
          >
            {t('voice.connection.retry')}
          </button>
        )}
      </figure>
    </FloatingTile>
  );
}
