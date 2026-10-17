// Connects the session screen to its tutor once the session has loaded: Ada's states, captions
// and view requests go to the stage store. Her title names an untitled session: it shows in the
// title strip at once (R4) and persists, so the library shows it afterwards (R16). A session that
// already has a title keeps it (spec §5.1).
import { patchSession } from '@tassel/shared/api';
import { useEffect } from 'react';
import { useCurrentSession } from '../features/session/current-session';
import { useStageStore } from '../features/session/stage-store';
import { useApi } from '../lib/api';
import type { TutorClient } from './types';

/**
 * Connects once `ready`, when the session has loaded, and disconnects on unmount. A session that
 * can't be loaded never starts its tutor.
 */
export function useTutorSession(sessionId: string, client: TutorClient, ready: boolean): void {
  const api = useApi();
  const { nameIfUntitled } = useCurrentSession();

  useEffect(() => {
    if (!ready) return;
    const off = client.on((event) => {
      // Read per event, so the store is always current here.
      const stage = useStageStore.getState();
      switch (event.type) {
        case 'state':
          stage.setTutorState(event.state);
          break;
        case 'caption':
          // A line still being heard waits until it's final; P2's live captions refine this.
          if (event.final) stage.pushCaption(event.speaker, event.text, event.lang);
          break;
        case 'stage':
          // Waits, remembered, while she has a view pinned.
          stage.requestMode(event.mode);
          break;
        case 'title': {
          const name = { title: event.title, subject: event.subject };
          // R16: P2 moves title writing to the server. A failed save leaves the title on screen.
          if (nameIfUntitled(name)) patchSession(api, sessionId, name).catch(() => {});
          break;
        }
      }
    });
    void client.connect(sessionId);
    return () => {
      off();
      void client.disconnect();
    };
  }, [api, client, nameIfUntitled, ready, sessionId]);
}
