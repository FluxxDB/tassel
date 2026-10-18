// The settings the main process keeps (userData/settings.json, main/settings.ts), through the
// bridge: the UI language, which applies at once and at every launch, and her paper source,
// which applies from the next launch.
import type { Lang } from '@tassel/shared/i18n';
import type { i18n } from 'i18next';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { SavedPaperSource, SavedSettings } from '../../../../shared/bridge';

interface AppSettings {
  saved: SavedSettings;
  /** The paper source this launch started with, so the view can say a change waits. */
  launchPaperSource: SavedPaperSource | null;
  load(): Promise<void>;
  setUiLanguage(lang: Lang, i18next: i18n): Promise<void>;
  setPaperSource(source: SavedPaperSource): Promise<void>;
}

const bridge = () => (typeof window === 'undefined' ? undefined : window.tassel?.settings);

export const useAppSettings: UseBoundStore<StoreApi<AppSettings>> = create<AppSettings>()(
  (set, get) => ({
    saved: {},
    launchPaperSource: null,
    load: async () => {
      const saved = (await bridge()?.get().catch(() => undefined)) ?? {};
      set((state) => ({
        saved,
        launchPaperSource: state.launchPaperSource ?? saved.paperSource ?? 'auto',
      }));
    },
    setUiLanguage: async (lang, i18next) => {
      await i18next.changeLanguage(lang);
      set({ saved: { ...get().saved, uiLanguage: lang } });
      const saved = await bridge()
        ?.set({ uiLanguage: lang })
        .catch(() => undefined);
      if (saved) set({ saved });
    },
    setPaperSource: async (paperSource) => {
      set({ saved: { ...get().saved, paperSource } });
      const saved = await bridge()
        ?.set({ paperSource })
        .catch(() => undefined);
      if (saved) set({ saved });
    },
  }),
);
