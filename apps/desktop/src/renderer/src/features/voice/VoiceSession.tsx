// The live voice session behind the session screen: it runs useVoiceSession, connects its client
// through useTutorSession, and publishes it to the screen's controls (live-voice.ts). In
// unpackaged builds it also mounts the latency HUD (Ctrl/Cmd+Shift+L). Typed student lines go
// through the chat sidebar's composer (features/chat), which sends them as `student-message`.
import type { Lang } from '@tassel/shared/i18n';
import { useEffect } from 'react';
import type { AppConfig } from '../../../../shared/bridge';
import type { VoiceConfig } from '../../../../shared/voice-bridge';
import { useApi } from '../../lib/api';
import { useTutorSession } from '../../tutor/use-tutor-session';
import { isHudShortcut } from '../session/shortcuts';
import { LatencyHud } from './LatencyHud';
import { useLiveVoice } from './live-voice';
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
  const { client, resources } = useVoiceSession({ sessionId, lang, app, config, api: useApi() });
  // Mounted once the session has loaded, so it is ready.
  useTutorSession(sessionId, client, true);
  const live = app.tutorMode !== 'fake';
  const mic = resources?.mic ?? null;
  useEffect(() => {
    useLiveVoice.getState().publish({ live, client, mic, config });
  }, [live, client, mic, config]);
  useEffect(() => () => useLiveVoice.getState().clear(), []);

  useEffect(() => {
    if (!config.devTools) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isHudShortcut(event)) return;
      event.preventDefault();
      useLiveVoice.getState().toggleHud();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [config.devTools]);

  const hudOpen = useLiveVoice((state) => state.hudOpen);
  if (!live || !config.devTools) return null;
  return <>{hudOpen && <LatencyHud />}</>;
}
