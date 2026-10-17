// The live session screen, "One stage, her work first": the title strip, the stage (her paper,
// Ada's board, or both), Ada's tile, the captions and the dock. End session, confirmed through
// a sheet, is the only way back to the library (R18).
import { useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRoute } from '../../app/route-store';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { Captions } from './Captions';
import { useCurrentSession } from './current-session';
import { Dock } from './Dock';
import { Stage } from './Stage';
import { useSessionShortcuts } from './shortcuts';
import { useStageStore } from './stage-store';
import { TitleStrip } from './TitleStrip';

export function SessionScreen({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const { session, failed, load } = useCurrentSession();
  const goLibrary = useRoute((state) => state.goLibrary);
  // The timer counts from when this screen opens, not from the session's creation (R7).
  const [startedAt] = useState(() => new Date());
  const [confirmingEnd, setConfirmingEnd] = useState(false);

  // Every session opens on a fresh stage, before its first paint, so nothing animates in.
  useLayoutEffect(() => useStageStore.getState().reset(), []);
  useEffect(() => {
    void load(sessionId);
  }, [load, sessionId]);
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
        <Stage source={session?.source ?? 'paper'} />
        <Captions />
        <Dock onEnd={() => setConfirmingEnd(true)} />
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
