// The preload script. It exposes window.tassel, the renderer's only way into the main process.
// It runs sandboxed, so it imports nothing at runtime but electron (the rest is bundled in).
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type Platform, type TasselBridge } from '../shared/bridge';

const tassel: TasselBridge = {
  platform: process.platform as Platform,
  getConfig: () => ipcRenderer.invoke(IPC.getConfig),
  getToken: () => ipcRenderer.invoke(IPC.getToken),
  refreshToken: () => ipcRenderer.invoke(IPC.refreshToken),
};

contextBridge.exposeInMainWorld('tassel', tassel);
