// The session screen's chat: a fresh conversation for each session, its saved history loaded
// when it opens (a past session from the library shows what was said, images included), and the
// launch's say on whether the sidebar starts open. The scripted tutor saves nothing on the
// server, so a fake launch has no history to load and doesn't ask.
import type { ApiClient } from '@tassel/shared/api';
import { useEffect, useLayoutEffect } from 'react';
import { fetchHistory } from './chat-api';
import { PUSH_MIN_WIDTH } from './chat-layout';
import { useChatPrefs } from './chat-prefs';
import { useChatStore } from './chat-store';

export function useSessionChat(
  api: ApiClient,
  sessionId: string,
  { startClosed, history }: { startClosed: boolean; history: boolean },
): void {
  // Before the first paint, so neither the last session's lines nor the wrong layout flash.
  // biome-ignore lint/correctness/useExhaustiveDependencies: each session starts its own chat.
  useLayoutEffect(() => {
    useChatStore.getState().reset();
    useChatPrefs.getState().setDefaultOpen(!startClosed);
    // In a narrow window the sidebar starts closed, whatever she chose, until she opens it.
    useChatPrefs.getState().setSession(window.innerWidth < PUSH_MIN_WIDTH ? false : null);
    return () => {
      useChatStore.getState().reset();
      useChatPrefs.getState().setSession(null);
    };
  }, [sessionId, startClosed]);
  useEffect(() => {
    if (!history) return;
    let live = true;
    void fetchHistory(api, sessionId).then((messages) => {
      if (live && messages.length > 0) useChatStore.getState().loadHistory(messages);
    });
    return () => {
      live = false;
    };
  }, [api, sessionId, history]);
}
