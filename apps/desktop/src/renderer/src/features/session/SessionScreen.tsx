// The live session screen, "One stage, her work first": the title strip, the stage (her paper,
// Ada's board, or both), Ada's tile, the captions and the dock, with the chat sidebar on the
// right, which the stage shrinks beside (or, in a narrow window, which lies over its right side).
// End session, confirmed through a sheet, is the only way back to the library (R18).
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppConfig } from '../../../../shared/bridge';
import type { VoiceConfig } from '../../../../shared/voice-bridge';
import { useRoute } from '../../app/route-store';
import { createAttachmentSource } from '../../board/marks/attachment-source';
import { registerImageSource } from '../../board/marks/image-store';
import { createPaperSource } from '../../board/marks/paper-source';
import { registerSnapshotSource } from '../../board/marks/snapshot-sources';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { useApi } from '../../lib/api';
import { usePaperCapture } from '../../paper/use-paper-capture';
import { useScreenController } from '../../screen/controller';
import { ScreenPicker } from '../../screen/ScreenControls';
import { useScreen } from '../../screen/store';
import type { TutorClient } from '../../tutor/types';
import { useTutorSession } from '../../tutor/use-tutor-session';
import { ChatSidebar } from '../chat/ChatSidebar';
import { useChatCover } from '../chat/chat-layout';
import { useSessionChat } from '../chat/use-chat';
import { useLiveVoice } from '../voice/live-voice';
import { VoiceNotices } from '../voice/MicNotice';
import { VoiceSession } from '../voice/VoiceSession';
import { Captions } from './Captions';
import { forgetCurrentSession, useCurrentSession } from './current-session';
import { Dock } from './Dock';
import { Stage } from './Stage';
import { useSessionShortcuts } from './shortcuts';
import { useStageStore } from './stage-store';
import '../../overlay/overlay.css';
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
  useScreenController(sessionId, app);
  const presentation = useScreen((state) => state.presentation);
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
  // The student's images from the chat, for when Ada (or the chat) shows one on the stage.
  useLayoutEffect(
    () => registerImageSource(createAttachmentSource({ api, sessionId: () => sessionId })),
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
  // With the app's config, VoiceSession runs the live tutor instead.
  useTutorSession(sessionId, app ? null : tutor, session !== null);
  // Her paper (P3): captured for the life of this screen, so it goes on while the board fills
  // the stage. It starts once the session is known to be a paper session.
  const cameraOn = useStageStore((state) => state.cameraOn);
  usePaperCapture({ sessionId, sessionSource: session?.source ?? null, cameraOn });
  useSessionShortcuts();
  useSessionChat(api, sessionId, {
    startClosed: app?.chatSidebar === 'closed',
    history: app?.tutorMode !== 'fake',
  });
  // Typed messages go to the tutor this screen runs: the voice session's, or the injected one.
  const liveClient = useLiveVoice((state) => state.client);
  const chatClient = app ? liveClient : tutor === NO_TUTOR ? null : tutor;
  const cover = useChatCover((state) => state.cover);

  const end = () => {
    setConfirmingEnd(false);
    useStageStore.getState().reset();
    goLibrary();
  };

  return (
    <div className="screen-presentation flex h-full flex-col" data-presentation={presentation}>
      <ScreenPicker />
      <TitleStrip session={session} failed={failed} startedAt={startedAt} />
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <main
          className="relative min-h-0 min-w-0 flex-1"
          // What the overlaying chat sidebar covers, which the captions and the dock centre beside.
          style={cover ? ({ '--chat-cover': `${cover}px` } as CSSProperties) : undefined}
        >
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
          <Captions notice={app && voiceConfig ? <VoiceNotices /> : undefined} />
          <Dock onEnd={() => setConfirmingEnd(true)} boardRef={boardControl} />
        </main>
        <ChatSidebar sessionId={sessionId} lang={session?.language} client={chatClient} />
      </div>
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
