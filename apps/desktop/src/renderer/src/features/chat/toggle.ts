// Showing and hiding the chat sidebar, from the title strip's toggle, T, or the sidebar's own
// Hide. Her choice is remembered (chat-prefs.ts). Opened, focus goes to the message field so she
// can type at once; closed with focus inside it, focus goes back to the toggle, never the body.
// Each move of focus is a request the sidebar or the toggle carries out once it has rendered.
import { useEffect, useRef } from 'react';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { chatOpenNow, useChatPrefs } from './chat-prefs';

/** The sidebar's id, for the toggle's aria-controls. */
export const CHAT_SIDEBAR_ID = 'chat-sidebar';

interface FocusRequests {
  /** Bumped when the field should take focus. */
  field: number;
  /** Bumped when the toggle should take focus. */
  toggle: number;
}

export const useChatFocus: UseBoundStore<StoreApi<FocusRequests>> = create<FocusRequests>()(() => ({
  field: 0,
  toggle: 0,
}));

export function setChatOpen(open: boolean): void {
  const sidebar = document.getElementById(CHAT_SIDEBAR_ID);
  const hadFocus = sidebar?.contains(document.activeElement) ?? false;
  useChatPrefs.getState().setOpen(open);
  if (open) useChatFocus.setState((state) => ({ field: state.field + 1 }));
  else if (hadFocus) useChatFocus.setState((state) => ({ toggle: state.toggle + 1 }));
}

/** Closes the sidebar for this session only (her saved choice stays), with the same focus care. */
export function closeChatForSession(): void {
  const sidebar = document.getElementById(CHAT_SIDEBAR_ID);
  const hadFocus = sidebar?.contains(document.activeElement) ?? false;
  useChatPrefs.getState().setSession(false);
  if (hadFocus) useChatFocus.setState((state) => ({ toggle: state.toggle + 1 }));
}

export function toggleChat(): void {
  setChatOpen(!chatOpenNow());
}

/** Runs `focus` on each new request for `which`, never for one made before it mounted. */
export function useFocusRequest(which: keyof FocusRequests, focus: () => void): void {
  const asked = useChatFocus((state) => state[which]);
  const seen = useRef(asked);
  const latest = useRef(focus);
  latest.current = focus;
  useEffect(() => {
    if (asked === seen.current) return;
    seen.current = asked;
    latest.current();
  }, [asked]);
}
