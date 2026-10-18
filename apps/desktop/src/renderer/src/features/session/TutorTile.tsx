// Ada's tile: a small, live presence in the stage's top right corner, 212×176 on blush. Her state
// is always named on it; the iris ring shows only while she speaks, and never alone.
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/cn';
import { useLiveVoice } from '../voice/live-voice';
import { AvatarPlaceholder } from './AvatarPlaceholder';
import { useStageStore } from './stage-store';

export function TutorTile() {
  const { t } = useTranslation();
  const state = useStageStore((store) => store.tutorState);
  const connection = useStageStore((store) => store.connection);
  const live = useLiveVoice((store) => store.live);
  const client = useLiveVoice((store) => store.client);
  const captionId = useId();
  // The live tutor's connection, until she's there: then her state, as with the scripted tutor.
  const status =
    live &&
    (connection === 'connecting' || connection === 'reconnecting' || connection === 'failed')
      ? t(`voice.connection.${connection}`)
      : null;
  return (
    <figure
      aria-labelledby={captionId}
      data-testid="tutor-tile"
      className={cn(
        // A box-shadow ring, so it never shifts the layout.
        'absolute top-3.5 right-3.5 z-10 m-0 h-[176px] w-[212px] overflow-hidden rounded-card bg-blush motion-safe:transition-shadow motion-safe:duration-150',
        state === 'speaking' && 'shadow-[0_0_0_2px_var(--color-iris)]',
      )}
    >
      <AvatarPlaceholder className="absolute top-1.5 left-7 size-[156px]" />
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
  );
}
