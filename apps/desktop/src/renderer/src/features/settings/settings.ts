// Every setting the app has, in one place. Each stays in the store that already owns it, and this
// module is the one way in: the Settings view, the dock and the new session sheet read and write
// them here.
// - Tutor: the avatar profile (avatar/store.ts, localStorage).
// - Personality and Memory: the server (/v1/learner/personalization, /v1/learner/memory).
// - Voice & audio: devices, push-to-talk, presenter mode, interruptions (voice/audio-prefs.ts).
// - Session defaults: language, source, captions (session-defaults.ts), and the chat sidebar and
//   voice replies (chat/chat-prefs.ts).
// - Language and Camera & paper: the main process (app-settings.ts, userData/settings.json).
// The view's own state, whether it shows and which section, is here too.
import { create, type StoreApi, type UseBoundStore } from 'zustand';

export { useAvatar } from '../../avatar/store';
export { useChatPrefs } from '../chat/chat-prefs';
export { useAudioPrefs } from '../voice/audio-prefs';
export { useAppSettings } from './app-settings';
export { useSessionDefaults } from './session-defaults';

export const SETTINGS_SECTIONS = [
  'tutor',
  'personality',
  'memory',
  'voice',
  'defaults',
  'language',
  'camera',
  'privacy',
  'about',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

interface SettingsView {
  open: boolean;
  section: SettingsSection;
  /** Opens Settings, on `section` if given, else where she left it. */
  openSettings(section?: SettingsSection): void;
  setSection(section: SettingsSection): void;
  close(): void;
}

export const useSettingsView: UseBoundStore<StoreApi<SettingsView>> = create<SettingsView>()(
  (set) => ({
    open: false,
    section: 'tutor',
    openSettings: (section) => set((state) => ({ open: true, section: section ?? state.section })),
    setSection: (section) => set({ section }),
    close: () => set({ open: false }),
  }),
);
