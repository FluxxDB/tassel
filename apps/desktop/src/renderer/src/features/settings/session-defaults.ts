// How a new session starts, from Settings → Session defaults: its language and source in the new
// session sheet, and whether captions are on. Kept across launches the way the audio settings
// are (localStorage, through zustand's persist). The dock's Captions toggle saves here too, so
// the next session opens the way she left the last one.
import type { Source } from '@tassel/shared/api';
import { type Lang, SUPPORTED_LANGS } from '@tassel/shared/i18n';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SessionDefaults {
  /** The session's language; null follows the UI language. */
  language: Lang | null;
  /** How she'll work; null is the platform's default (paper, or screen on Windows). */
  source: Source | null;
  captions: boolean;
}

export const DEFAULT_SESSION_DEFAULTS: SessionDefaults = {
  language: null,
  source: null,
  captions: true,
};

interface Actions {
  set(changes: Partial<SessionDefaults>): void;
}

const SOURCES: readonly Source[] = ['paper', 'screen', 'talk'];

/** Only known, correctly typed fields cross the localStorage boundary. */
function readDefaults(value: unknown): SessionDefaults {
  const result = { ...DEFAULT_SESSION_DEFAULTS };
  if (typeof value !== 'object' || value === null) return result;
  const language = Reflect.get(value, 'language');
  if ((SUPPORTED_LANGS as readonly unknown[]).includes(language)) result.language = language;
  const source = Reflect.get(value, 'source');
  if ((SOURCES as readonly unknown[]).includes(source)) result.source = source;
  const captions = Reflect.get(value, 'captions');
  if (typeof captions === 'boolean') result.captions = captions;
  return result;
}

export const useSessionDefaults: UseBoundStore<StoreApi<SessionDefaults & Actions>> = create<
  SessionDefaults & Actions
>()(
  persist(
    (set) => ({
      ...DEFAULT_SESSION_DEFAULTS,
      set: (changes) => set((state) => readDefaults({ ...state, ...changes })),
    }),
    {
      name: 'tassel.session-defaults',
      version: 1,
      partialize: (state) => readDefaults(state),
      merge: (saved, current) => ({ ...current, ...readDefaults(saved) }),
    },
  ),
);
