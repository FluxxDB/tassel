// The typed preload bridge, window.tassel: the renderer's only way into the main process.
import type { Lang } from '@tassel/shared/i18n';

export type Platform = 'darwin' | 'win32' | 'linux';

export interface AppConfig {
  serverUrl: string;
  uiLanguage: Lang;
  tutorMode: 'fake' | 'live';
  fakeScript: string;
  fakeSpeed: number;
}

export interface TasselBridge {
  platform: Platform;
  getConfig(): Promise<AppConfig>;
  getToken(): Promise<string>;
  refreshToken(): Promise<string>;
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
