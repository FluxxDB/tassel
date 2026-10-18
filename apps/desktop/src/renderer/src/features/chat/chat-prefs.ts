// The chat sidebar's two remembered choices, kept across sessions and launches the way the audio
// settings are (localStorage, through zustand's persist): whether the sidebar shows, and whether
// Ada speaks her replies to typed messages. Until she chooses, the sidebar opens with a session;
// a launch can say otherwise (TASSEL_CHAT_SIDEBAR=closed, which the E2E specs set).
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { persist } from 'zustand/middleware';

interface Saved {
  /** Her choice, or null before she has made one. */
  open: boolean | null;
  /** Ada speaks replies (true), or answers in text only. */
  voiceReplies: boolean;
}

interface ChatPrefs extends Saved {
  /** Whether the sidebar shows before she chooses: the launch's default. */
  defaultOpen: boolean;
  /**
   * This session's own state, never saved, over her choice: closed when a session opens in a
   * window under 1120 px, or when Ada's split view needs the room (ChatSidebar). Null follows
   * her choice. Her toggle clears it.
   */
  session: boolean | null;
  setSession(open: boolean | null): void;
  setDefaultOpen(open: boolean): void;
  setOpen(open: boolean): void;
  toggle(): void;
  setVoiceReplies(on: boolean): void;
}

const DEFAULTS: Saved = { open: null, voiceReplies: true };

/** Only known, correctly typed fields cross the localStorage boundary. */
function readSaved(value: unknown): Saved {
  const result = { ...DEFAULTS };
  if (typeof value !== 'object' || value === null) return result;
  const open = Reflect.get(value, 'open');
  if (typeof open === 'boolean') result.open = open;
  const voiceReplies = Reflect.get(value, 'voiceReplies');
  if (typeof voiceReplies === 'boolean') result.voiceReplies = voiceReplies;
  return result;
}

export const useChatPrefs: UseBoundStore<StoreApi<ChatPrefs>> = create<ChatPrefs>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      defaultOpen: true,
      session: null,
      setDefaultOpen: (defaultOpen) => set({ defaultOpen }),
      setSession: (session) => set({ session }),
      setOpen: (open) => set({ open, session: null }),
      toggle: () => set((state) => ({ open: !isOpen(state), session: null })),
      setVoiceReplies: (voiceReplies) => set({ voiceReplies }),
    }),
    {
      name: 'tassel.chat-prefs',
      version: 1,
      partialize: (state) => readSaved(state),
      merge: (saved, current) => ({ ...current, ...readSaved(saved) }),
    },
  ),
);

function isOpen(state: Pick<ChatPrefs, 'session' | 'open' | 'defaultOpen'>): boolean {
  return state.session ?? state.open ?? state.defaultOpen;
}

/** Whether the sidebar shows now. */
export const useChatOpen = (): boolean => useChatPrefs(isOpen);

/** Whether the sidebar shows now, outside React. */
export const chatOpenNow = (): boolean => isOpen(useChatPrefs.getState());
