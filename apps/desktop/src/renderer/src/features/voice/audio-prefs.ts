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
interface AudioPrefsActions {
  set(prefs: Partial<AudioPrefs>): void;
  setPresenter(on: boolean, outputId?: string | null): void;
  reset(): void;
}
/** Only known, correctly typed fields cross the localStorage boundary; actions never do. */
function readPrefs(value: unknown): AudioPrefs {
  const result = { ...DEFAULT_AUDIO_PREFS };
  if (typeof value !== 'object' || value === null) return result;
  for (const key of ['inputId', 'outputId', 'presenterOutputId'] as const) {
    const id = Reflect.get(value, key);
    if (id === null || typeof id === 'string') result[key] = id || null;
  }
  for (const key of ['presenter', 'pushToTalk'] as const) {
    const on = Reflect.get(value, key);
    if (typeof on === 'boolean') result[key] = on;
  }
  const sensitivity = Reflect.get(value, 'sensitivity');
  if (sensitivity === 'low' || sensitivity === 'normal' || sensitivity === 'high')
    result.sensitivity = sensitivity;
  return result;
}
export const useAudioPrefs = create<AudioPrefs & AudioPrefsActions>()(
  persist(
    (set) => ({
      ...DEFAULT_AUDIO_PREFS,
      set: (prefs) => set((state) => readPrefs({ ...state, ...prefs })),
      setPresenter: (on, outputId) =>
        set((state) =>
          on
            ? {
                presenter: true,
                presenterOutputId: outputId === undefined ? state.presenterOutputId : outputId,
                pushToTalk: true,
                sensitivity: 'low',
              }
            : { presenter: false },
        ),
      reset: () => set({ ...DEFAULT_AUDIO_PREFS }),
    }),
    {
      name: 'tassel.audio-prefs',
      version: 1,
      partialize: (state) => readPrefs(state),
      merge: (saved, current) => ({ ...current, ...readPrefs(saved) }),
      migrate: () => ({ ...DEFAULT_AUDIO_PREFS }),
    },
  ),
);
