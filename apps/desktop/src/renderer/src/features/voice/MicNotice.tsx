// What the live voice session needs her to know, above the captions: that voice isn't configured
// or the server can't be reached (R39: plain words, never a scripted stand-in), and that her
// microphone is denied or unavailable. She can still type to Ada either way. Ada's tile carries
// the connection itself, with Retry.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Close } from '../../components/icons';
import type { MicStatus } from '../../tutor/types';
import { useStageStore } from '../session/stage-store';
import { useLiveVoice } from './live-voice';

const NOTICE =
  'pointer-events-auto flex items-center gap-3 rounded-card bg-paper py-2 pr-2 pl-4 text-[14px] leading-5 text-ink shadow-[0_0_0_1px_var(--color-hairline)]';

/** The live session's notices, for the captions' notice slot. */
export function VoiceNotices() {
  const { t } = useTranslation();
  const live = useLiveVoice((state) => state.live);
  const reason = useStageStore((state) => state.voiceError);
  const connection = useStageStore((state) => state.connection);
  if (!live) return null;
  const failing = reason !== null && connection !== 'connected';
  return (
    <>
      {failing && (
        <div role="status" className={NOTICE}>
          <p className="flex-1 py-1.5">
            {t(
              reason === 'not-configured'
                ? 'voice.connection.notConfigured'
                : 'voice.connection.unreachable',
            )}
          </p>
        </div>
      )}
      <MicNotice />
    </>
  );
}

/** Shown while the mic is denied or unavailable, until she dismisses it. */
export function MicNotice() {
  const { t } = useTranslation();
  const mic = useStageStore((state) => state.mic);
  const canOpenSettings = useLiveVoice((state) => state.config?.canOpenMicSettings ?? false);
  // Dismissed for this status: a new problem shows again.
  const [dismissed, setDismissed] = useState<MicStatus | null>(null);
  if (mic !== 'denied' && mic !== 'unavailable') return null;
  if (dismissed === mic) return null;
  return (
    <div className={NOTICE}>
      <p className="flex-1 py-1.5">{t(`voice.mic.${mic}`)}</p>
      {canOpenSettings && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void window.tassel.voice.openMicSettings();
          }}
        >
          {t('voice.mic.openSettings')}
        </Button>
      )}
      <IconButton
        label={t('voice.mic.dismiss')}
        onClick={() => setDismissed(mic)}
        className="size-9 [&>svg]:size-4"
      >
        <Close />
      </IconButton>
    </div>
  );
}
