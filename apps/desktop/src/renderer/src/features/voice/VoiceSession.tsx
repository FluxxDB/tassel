import type { Lang } from '@tassel/shared/i18n';
import { useTranslation } from 'react-i18next';
import type { AppConfig } from '../../../../shared/bridge';
import type { VoiceConfig } from '../../../../shared/voice-bridge';
import { Button } from '../../components/Button';
import { useApi } from '../../lib/api';
import { useTutorSession } from '../../tutor/use-tutor-session';
import { useStageStore } from '../session/stage-store';
import { DevConsole } from './DevConsole';
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
  // Mounted once the session has loaded, so it is ready.
  useTutorSession(sessionId, client, true);
  const connection = useStageStore((s) => s.connection);
  const reason = useStageStore((s) => s.voiceError);
  const { t } = useTranslation();
  // The developer console (TASSEL_DEV_CONSOLE=1): typed lines go to Ada as the student's.
  const devConsole = config.devConsole && client && (
    <div className="absolute bottom-[196px] left-6 z-20 w-96 max-w-[calc(100%-3rem)]">
      <DevConsole onSend={(text) => client.sendText(text)} />
    </div>
  );
  if (
    app.tutorMode === 'fake' ||
    (!reason && connection !== 'failed' && connection !== 'reconnecting')
  )
    return devConsole || null;
  return (
    <>
      {devConsole}
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
    </>
  );
}
