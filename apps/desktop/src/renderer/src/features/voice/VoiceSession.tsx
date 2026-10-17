import type { Lang } from '@tassel/shared/i18n';
import { useTranslation } from 'react-i18next';
import type { AppConfig } from '../../../../shared/bridge';
import type { VoiceConfig } from '../../../../shared/voice-bridge';
import { Button } from '../../components/Button';
import { useApi } from '../../lib/api';
import { useTutorSession } from '../../tutor/use-tutor-session';
import { useStageStore } from '../session/stage-store';
import { useVoiceSession } from './use-voice-session';

/** Mounted only once the session's saved language is known. */
export function VoiceSession({
  sessionId,
  lang,
  app,
  config,
}: {
  sessionId: string;
  lang: Lang;
  app: AppConfig;
  config: VoiceConfig;
}) {
  const { client } = useVoiceSession({ sessionId, lang, app, config, api: useApi() });
  useTutorSession(sessionId, client);
  const connection = useStageStore((s) => s.connection);
  const reason = useStageStore((s) => s.voiceError);
  const { t } = useTranslation();
  if (
    app.tutorMode === 'fake' ||
    (!reason && connection !== 'failed' && connection !== 'reconnecting')
  )
    return null;
  return (
    <div
      role="status"
      className="absolute left-6 top-6 z-20 max-w-md rounded-card border border-hairline bg-paper p-4 text-sm"
    >
      <p>
        {t(
          reason === 'not-configured'
            ? 'voice.connection.notConfigured'
            : 'voice.connection.unreachable',
        )}
      </p>
      {connection === 'reconnecting' && <p>{t('voice.connection.reconnecting')}</p>}
      {connection === 'failed' && (
        <Button
          onClick={() => {
            void client?.voice?.reconnect();
          }}
        >
          {t('voice.connection.retry')}
        </Button>
      )}
    </div>
  );
}
