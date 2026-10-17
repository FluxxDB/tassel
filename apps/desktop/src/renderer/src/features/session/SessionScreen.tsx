// The live session screen, "One stage, her work first": the title strip, the stage (her paper,
// Ada's board, or both), Ada's tile, the captions and the dock. End session, confirmed through
// a sheet, is the only way back to the library (R18).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppConfig } from '../../../../shared/bridge';
import type { VoiceConfig } from '../../../../shared/voice-bridge';
import { useRoute } from '../../app/route-store';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import type { TutorClient } from '../../tutor/types';
import { useTutorSession } from '../../tutor/use-tutor-session';
import { VoiceSession } from '../voice/VoiceSession';
import { Captions } from './Captions';
import { forgetCurrentSession, useCurrentSession } from './current-session';
import { Dock } from './Dock';
import { Stage } from './Stage';
import { useSessionShortcuts } from './shortcuts';
import { useStageStore } from './stage-store';
import { TitleStrip } from './TitleStrip';

export interface SessionScreenProps {
  sessionId: string;
  app?: AppConfig;
  voiceConfig?: VoiceConfig;
  /** Explicit tutor injection for tests. Production passes the app and voice config. */
  createTutor?: () => TutorClient;
}

/** A tutor that never connects or speaks: the stage stays usable without one. */
const NO_TUTOR: TutorClient = {
  connect: async () => {},
  disconnect: async () => {},
  on: () => () => {},
  sendText: () => {},
};

export function SessionScreen({ sessionId, createTutor, app, voiceConfig }: SessionScreenProps) {
  const { t } = useTranslation();
  const { session, failed, load } = useCurrentSession();
  const goLibrary = useRoute((state) => state.goLibrary);
  // The timer counts from when this screen opens, not from the session's creation (R7).
  const [startedAt] = useState(() => new Date());
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const boardControl = useRef<HTMLButtonElement>(null);

  // Every session opens on a fresh stage, before its first paint, so nothing animates in.
  useLayoutEffect(() => useStageStore.getState().reset(), []);
  useEffect(() => {
    void load(sessionId);
    return forgetCurrentSession;
  }, [load, sessionId]);
  // One tutor for the life of this screen; it connects on mount and disconnects on unmount.
  const [tutor] = useState<TutorClient>(() => {
    if (!createTutor) return NO_TUTOR;
    try {
      return createTutor();
    } catch (error) {
      console.warn('[tassel] This session runs without a tutor:', error);
      return NO_TUTOR;
    }
  });
  useTutorSession(sessionId, app ? null : tutor);
  useSessionShortcuts();

  const end = () => {
    setConfirmingEnd(false);
    useStageStore.getState().reset();
    goLibrary();
  };

  return (
    <div className="flex h-full flex-col">
      <TitleStrip session={session} failed={failed} startedAt={startedAt} />
      <main className="relative min-h-0 flex-1">
        {/* Until the session loads, the stage shows her paper, as a paper session would. */}
        <Stage
          source={session?.source ?? 'paper'}
          onUnpinned={() => boardControl.current?.focus()}
        />
        {session && app && voiceConfig && (
          <VoiceSession
            sessionId={sessionId}
            lang={session.language}
            app={app}
            config={voiceConfig}
          />
        )}
        <Captions />
        <Dock onEnd={() => setConfirmingEnd(true)} boardRef={boardControl} />
      </main>
      <Sheet open={confirmingEnd} onOpenChange={setConfirmingEnd} title={t('session.end.title')}>
        {/* Keep going comes first, so it has focus when the sheet opens. */}
        <div className="flex justify-end gap-3">
          <Button variant="ghost" size="lg" onClick={() => setConfirmingEnd(false)}>
            {t('session.end.cancel')}
          </Button>
          <Button size="lg" onClick={end}>
            {t('session.end.confirm')}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
