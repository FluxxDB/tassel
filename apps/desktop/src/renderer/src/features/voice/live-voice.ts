// The live voice session the session screen's controls reach: whether one runs, its client, its
// microphone and the launch's voice config. VoiceSession publishes them while it's mounted and
// clears them when it goes, so the dock, the title strip and Ada's tile never hold a finished
// session's client.
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { VoiceConfig } from '../../../../shared/voice-bridge';
import type { Mic } from '../../tutor/live/mic';
import type { TutorClient } from '../../tutor/types';

/** The parts of the microphone the controls read. */
export type LiveMic = Pick<Mic, 'level'>;

interface LiveVoice {
  /** True while a live voice session (not the scripted tutor) is on screen. */
  live: boolean;
  /** Its client, once made: `voice` holds Retry, the language reconnect and push-to-talk. */
  client: TutorClient | null;
  mic: LiveMic | null;
  config: VoiceConfig | null;
  /** Whether Space is held under push-to-talk, with the mic on. */
  held: boolean;
  /** The developer's latency HUD, toggled with Ctrl/Cmd+Shift+L. */
  hudOpen: boolean;
  publish(voice: {
    live: boolean;
    client: TutorClient | null;
    mic: LiveMic | null;
    config: VoiceConfig;
  }): void;
  setHeld(held: boolean): void;
  toggleHud(): void;
  clear(): void;
}

const EMPTY = {
  live: false,
  client: null,
  mic: null,
  config: null,
  held: false,
  hudOpen: false,
} as const;

export const useLiveVoice: UseBoundStore<StoreApi<LiveVoice>> = create<LiveVoice>()((set) => ({
  ...EMPTY,
  publish: ({ live, client, mic, config }) => set({ live, client, mic, config }),
  setHeld: (held) => set({ held }),
  toggleHud: () => set((state) => ({ hudOpen: !state.hudOpen })),
  clear: () => set(EMPTY),
}));
