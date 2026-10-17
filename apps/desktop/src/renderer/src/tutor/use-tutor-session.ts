// Connects the session screen to its tutor: Ada's states, captions and view requests go to the
// stage store; server-owned titles and language changes patch the local session only.

import { useEffect } from 'react';
import { useCurrentSession } from '../features/session/current-session';
import { useStageStore } from '../features/session/stage-store';
import { useVoiceDebug } from '../features/voice/voice-debug';
import type { TutorClient } from './types';

/** Connects on mount and disconnects on unmount. */
export function useTutorSession(sessionId: string, client: TutorClient | null): void {
  const { patchLocal } = useCurrentSession();

  useEffect(() => {
    if (!client) return;
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
          const changes = { title: event.title, subject: event.subject };
          patchLocal(changes);
          // The server owns AI title persistence; scripted titles are display-only.
          break;
        }
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
        case 'word':
          break;
      }
    });
    void client
      .connect(sessionId)
      .catch(() => useStageStore.getState().setConnection('failed', 'unreachable'));
    return () => {
      off();
      void client.disconnect();
    };
  }, [client, patchLocal, sessionId]);
}
