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

export interface TasselBridge {
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
} as const;

declare global {
  interface Window {
    tassel: TasselBridge;
  }
}
