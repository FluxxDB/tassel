// The typed preload bridge, window.tassel: the renderer's only way into the main process.
import type { Lang } from '@tassel/shared/i18n';
import type { PaperBridge } from './paper-bridge';
import type { ScreenBridge } from './screen-bridge';
import type { VoiceBridge } from './voice-bridge';

export type Platform = 'darwin' | 'win32' | 'linux';

export interface AppConfig {
  serverUrl: string;
  uiLanguage: Lang;
  tutorMode: 'fake' | 'live';
  fakeScript: string;
  fakeSpeed: number;
  /**
   * TASSEL_CHAT_SIDEBAR=closed: the chat sidebar starts hidden until she shows it (the E2E specs'
   * default, so they lay out as before it existed). Unset, it opens with a session.
   */
  chatSidebar?: 'closed';
  /**
   * True when this launch couldn't read the stored device token, so the app registers a fresh
   * device: a new learner, and an empty library. The library says so once.
   */
  tokenReset: boolean;
}

/** The paper sources she can save in Settings → Camera & paper (a packaged app's choices). */
export const SAVED_PAPER_SOURCES = ['auto', 'deskview-helper', 'webcam', 'window-capture'] as const;
export type SavedPaperSource = (typeof SAVED_PAPER_SOURCES)[number];

/**
 * The settings the main process reads at launch (userData/settings.json). Unset means the
 * default: the system's language, and the automatic paper source. A TASSEL_* variable, as dev
 * runs and E2E set, still wins over either.
 */
export interface SavedSettings {
  uiLanguage?: Lang;
  paperSource?: SavedPaperSource;
}

export interface SettingsBridge {
  get(): Promise<SavedSettings>;
  /** Saves the given fields (null clears one) and answers with everything saved. */
  set(patch: { [K in keyof SavedSettings]?: SavedSettings[K] | null }): Promise<SavedSettings>;
}

export interface TasselBridge {
  settings: SettingsBridge;
  screen: ScreenBridge;
  voice: VoiceBridge;
  platform: Platform;
  getConfig(): Promise<AppConfig>;
  getToken(): Promise<string>;
  refreshToken(): Promise<string>;
  /** Paper (P3): its source config, the Desk View helper and camera access. */
  paper: PaperBridge;
}

/** The IPC channels behind the bridge. src/main/ipc.ts handles each one. */
export const IPC = {
  getConfig: 'config:get',
  getToken: 'auth:getToken',
  refreshToken: 'auth:refreshToken',
  getSettings: 'settings:get',
  setSettings: 'settings:set',
} as const;

declare global {
  interface Window {
    tassel: TasselBridge;
  }
}
