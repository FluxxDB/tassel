// Connects the session screen to its tutor once the session has loaded: Ada's states, captions
// and view requests go to the stage store. Her title shows in the title strip at once (R4). The
// app never saves a title: the server writes the live tutor's (P2-R4), and the scripted tutor's
// are display-only, naming only an untitled session (spec §5.1). Her board, paper and stage
// actions go to the dispatcher, now or, in a beat, as the beat player hears her words (P5).
import { useEffect, useRef } from 'react';
import { beatPlayer } from '../board/beats/player';
import { dispatchActions } from '../board/dispatch';
import { useCurrentSession } from '../features/session/current-session';
import { useStageStore } from '../features/session/stage-store';
import { useVoiceDebug } from '../features/voice/voice-debug';
import { useApi } from '../lib/api';
import { requestTurnFrame } from '../paper/turn-frame';
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
  const { nameIfUntitled, patchLocal } = useCurrentSession();
  const api = useApi();
  const visit = useRef(0);

  useEffect(() => {
    if (!ready || !client) return;
    const currentVisit = ++visit.current;
    let finishing = false;
    const finishMemory = () => {
      if (finishing || !client.voice) return;
      finishing = true;
      void api
        .POST('/v1/sessions/{session_id}/memory', {
          params: { path: { session_id: sessionId } },
          keepalive: true,
        })
        .catch(() => undefined);
    };
    window.addEventListener('pagehide', finishMemory);
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
          // The server wrote the live tutor's (title_source 'ai'), never over the student's own.
          if (client.voice) patchLocal(name);
          else nameIfUntitled(name);
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
        case 'paper-request':
          void requestTurnFrame();
          break;
      }
    });
    void client
      .connect(sessionId)
      .catch(() => useStageStore.getState().setConnection('failed', 'unreachable'));
    return () => {
      off();
      window.removeEventListener('pagehide', finishMemory);
      const disconnected = client.disconnect();
      // Defer past StrictMode's effect replay; reconnects inside the client never extract.
      queueMicrotask(() => {
        if (visit.current !== currentVisit || !client.voice) return;
        void disconnected
          .catch(() => undefined)
          .then(finishMemory)
          .catch(() => undefined);
      });
      // The next session starts with no beats of this one's pending.
      beatPlayer.reset();
    };
  }, [api, client, nameIfUntitled, patchLocal, ready, sessionId]);
}
