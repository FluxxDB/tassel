// IPC handlers behind the preload bridge. Each one refuses senders outside the renderer's origin.
import { type IpcMainInvokeEvent, ipcMain } from 'electron';
import { IPC } from '../shared/bridge';
import { readConfig } from './config';
import type { TokenStore } from './token-store';
import { isTrustedUrl } from './windows';

export function registerIpc(tokens: TokenStore): void {
  handleTrusted(IPC.getConfig, async () => ({
    ...readConfig(),
    tokenReset: await tokens.wasReset(),
  }));
  handleTrusted(IPC.getToken, () => tokens.getToken());
  handleTrusted(IPC.refreshToken, () => tokens.refreshToken());
}

/** Handles an IPC channel, refusing any sender outside the renderer's origin. */
export function handleTrusted(channel: string, respond: () => unknown): void {
  ipcMain.handle(channel, (event) => {
    if (!isTrustedSender(event)) throw new Error(`Refused ${channel} from an untrusted sender`);
    return respond();
  });
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url;
  return url !== undefined && isTrustedUrl(url);
}
