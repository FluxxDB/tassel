// IPC handlers behind the preload bridge. Each one refuses senders outside the renderer's origin.
import { type IpcMainInvokeEvent, ipcMain } from 'electron';
import { IPC } from '../shared/bridge';
import { readConfig } from './config';
import { readSavedSettings, writeSavedSettings } from './settings';
import type { TokenStore } from './token-store';
import { isTrustedUrl } from './windows';

/**
 * `settingsDir`, userData in the app, holds settings.json (main/settings.ts): config:get reads
 * the saved UI language from it, and settings:get and settings:set read and write it.
 */
export function registerIpc(tokens: TokenStore, settingsDir?: string): void {
  handleTrusted(IPC.getConfig, async () => ({
    ...readConfig(process.env, settingsDir ? readSavedSettings(settingsDir) : {}),
    tokenReset: await tokens.wasReset(),
  }));
  handleTrusted(IPC.getToken, () => tokens.getToken());
  handleTrusted(IPC.refreshToken, () => tokens.refreshToken());
  if (settingsDir) {
    handleTrusted(IPC.getSettings, () => readSavedSettings(settingsDir));
    handleTrusted(IPC.setSettings, (patch) => writeSavedSettings(settingsDir, patch));
  }
}

/** Handles an IPC channel, refusing any sender outside the renderer's origin. */
export function handleTrusted(channel: string, respond: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!isTrustedSender(event)) throw new Error(`Refused ${channel} from an untrusted sender`);
    return respond(...args);
  });
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url;
  return url !== undefined && isTrustedUrl(url);
}
