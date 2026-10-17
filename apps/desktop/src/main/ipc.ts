// IPC handlers behind the preload bridge. Each one refuses senders outside the renderer's origin.
import { type IpcMainInvokeEvent, ipcMain } from 'electron';
import { IPC } from '../shared/bridge';
import { readConfig } from './config';
import type { TokenStore } from './token-store';
import { isTrustedUrl } from './windows';

export function registerIpc(tokens: TokenStore): void {
  handle(IPC.getConfig, async () => ({ ...readConfig(), tokenReset: await tokens.wasReset() }));
  handle(IPC.getToken, () => tokens.getToken());
  handle(IPC.refreshToken, () => tokens.refreshToken());
}

function handle(channel: string, respond: () => unknown): void {
  ipcMain.handle(channel, (event) => {
    if (!isTrustedSender(event)) throw new Error(`Refused ${channel} from an untrusted sender`);
    return respond();
  });
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url;
  return url !== undefined && isTrustedUrl(url);
}
