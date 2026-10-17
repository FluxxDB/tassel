// The live session screen, "One stage, her work first": the title strip, the stage (her paper,
// Ada's board, or both), Ada's tile, the captions and the dock. End session, confirmed through
// a sheet, is the only way back to the library (R18).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRoute } from '../../app/route-store';
import { createPaperSource } from '../../board/marks/paper-source';
import { registerSnapshotSource } from '../../board/marks/snapshot-sources';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { useApi } from '../../lib/api';
import type { TutorClient } from '../../tutor/types';
import { useTutorSession } from '../../tutor/use-tutor-session';
import { Captions } from './Captions';
import { forgetCurrentSession, useCurrentSession } from './current-session';
import { Dock } from './Dock';
import { Stage } from './Stage';
import { useSessionShortcuts } from './shortcuts';
import { useStageStore } from './stage-store';
import { TitleStrip } from './TitleStrip';

export interface SessionScreenProps {
  sessionId: string;
  /** Makes this session's tutor (createTutorClient from the launch config). Without it, or if it
   * throws (the live tutor before P2, an unknown fake script), the session runs without one. */
  createTutor?: () => TutorClient;
}

/** A tutor that never connects or speaks: the stage stays usable without one. */
const NO_TUTOR: TutorClient = {
  connect: async () => {},
  disconnect: async () => {},
  on: () => () => {},
  sendText: () => {},
};

export function SessionScreen({ sessionId, createTutor }: SessionScreenProps) {
  const { t } = useTranslation();
  const api = useApi();
  // Registered before useTutorSession connects and may deliver its first freeze.
  useLayoutEffect(
    () =>
      registerSnapshotSource(
        'paper',
        createPaperSource({
          api,
          sessionId: () => sessionId,
        }),
      ),
    [api, sessionId],
  );
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
  // One tutor for the life of this screen. It connects once the session has loaded, so a session
  // that can't be loaded never starts it, and disconnects on unmount.
  const [tutor] = useState<TutorClient>(() => {
    if (!createTutor) return NO_TUTOR;
    try {
      return createTutor();
    } catch (error) {
      console.warn('[tassel] This session runs without a tutor:', error);
      return NO_TUTOR;
    }
  });
  useTutorSession(sessionId, tutor, session !== null);
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
