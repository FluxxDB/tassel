// Connects the session screen to its tutor once the session has loaded: Ada's states, captions
// and view requests go to the stage store. Her title names an untitled session: it shows in the
// title strip at once (R4). The live tutor's titles are already saved by the server (P2), so they
// patch the local session only; the scripted tutor's persist from here, so the library shows them
// afterwards (R16). A session that already has a title keeps it (spec §5.1). Her board, paper and
// stage actions go to the dispatcher, now or, in a beat, as the beat player hears her words (P5).
import { patchSession } from '@tassel/shared/api';
import { useEffect } from 'react';
import { beatPlayer } from '../board/beats/player';
import { dispatchActions } from '../board/dispatch';
import { useCurrentSession } from '../features/session/current-session';
import { useStageStore } from '../features/session/stage-store';
import { useVoiceDebug } from '../features/voice/voice-debug';
import { useApi } from '../lib/api';
import type { TutorClient } from './types';

/**
 * Connects once `ready`, when the session has loaded, and disconnects on unmount. A session that
 * can't be loaded never starts its tutor, and neither does a missing client.
 */
export function useTutorSession(
  sessionId: string,
  client: TutorClient | null,
  ready: boolean,
): void {
  const api = useApi();
  const { nameIfUntitled, patchLocal } = useCurrentSession();

  useEffect(() => {
    if (!ready || !client) return;
    const off = client.on((event) => {
      // Read per event, so the store is always current here.
      const stage = useStageStore.getState();
      switch (event.type) {
        case 'state':
          stage.setTutorState(event.state);
          break;
        case 'caption':
          if (event.final) stage.pushCaption(event.speaker, event.text, event.lang);
          else stage.showInterim(event.speaker, event.text, event.lang);
          break;
        case 'stage':
          // Waits, remembered, while she has a view pinned.
          stage.requestMode(event.mode);
          break;
        case 'title': {
          const name = { title: event.title, subject: event.subject };
          if (client.voice) {
            // The server wrote it (title_source 'ai'), and never over the student's own title.
            patchLocal(name);
            break;
          }
          // R16: a failed save leaves the title on screen.
          if (nameIfUntitled(name)) patchSession(api, sessionId, name).catch(() => {});
          break;
        }
        case 'actions':
          dispatchActions(event.actions);
          break;
        case 'beat':
          beatPlayer.load(event.beat);
          break;
        case 'word':
          beatPlayer.hear({
            text: event.text,
            lang: event.lang,
            ...(event.segment !== undefined && { segment: event.segment }),
            ...(event.index !== undefined && { index: event.index }),
            atMs: performance.now(),
          });
          break;
        case 'connection':
          stage.setConnection(event.status, event.reason);
          break;
        case 'mic':
          stage.setMic(event.status);
          break;
        case 'language':
          patchLocal({ language: event.lang });
          break;
        case 'voice-debug':
          useVoiceDebug.getState().push(event.event);
          break;
      }
    });
    void client
      .connect(sessionId)
      .catch(() => useStageStore.getState().setConnection('failed', 'unreachable'));
    return () => {
      off();
      void client.disconnect();
      // The next session starts with no beats of this one's pending.
      beatPlayer.reset();
    };
  }, [api, client, nameIfUntitled, patchLocal, ready, sessionId]);
}
