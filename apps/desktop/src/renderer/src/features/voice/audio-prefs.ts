import type { Sensitivity } from '@tassel/shared/voice';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AudioPrefs {
  inputId: string | null;
  outputId: string | null;
  presenter: boolean;
  presenterOutputId: string | null;
  pushToTalk: boolean;
  sensitivity: Sensitivity;
}
export const DEFAULT_AUDIO_PREFS: AudioPrefs = {
  inputId: null,
  outputId: null,
  presenter: false,
  presenterOutputId: null,
  pushToTalk: false,
  sensitivity: 'normal',
};
export const useAudioPrefs = create<
  AudioPrefs & {
    set(p: Partial<AudioPrefs>): void;
    setPresenter(on: boolean, outputId?: string | null): void;
    reset(): void;
  }
>()(
  persist(
    (set) => ({
      ...DEFAULT_AUDIO_PREFS,
      set,
      setPresenter: (on, outputId) =>
        set(
          on
            ? {
                presenter: true,
                presenterOutputId: outputId ?? null,
                pushToTalk: true,
                sensitivity: 'low',
              }
            : { presenter: false },
        ),
      reset: () => set(DEFAULT_AUDIO_PREFS),
    }),
    { name: 'tassel.audio-prefs', version: 1 },
  ),
);
