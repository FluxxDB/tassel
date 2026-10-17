// The preload script. It exposes window.tassel, the renderer's only way into the main process.
// It runs sandboxed, so it imports nothing at runtime but electron (the rest is bundled in).
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type Platform, type TasselBridge } from '../shared/bridge';
import { VOICE_IPC } from '../shared/voice-bridge';

const tassel: TasselBridge = {
  platform: process.platform as Platform,
  voice: {
    getConfig: () => ipcRenderer.invoke(VOICE_IPC.getConfig),
    micAccess: () => ipcRenderer.invoke(VOICE_IPC.micAccess),
    askMicAccess: () => ipcRenderer.invoke(VOICE_IPC.askMicAccess),
    openMicSettings: () => ipcRenderer.invoke(VOICE_IPC.openMicSettings),
  },
  getConfig: () => ipcRenderer.invoke(IPC.getConfig),
  getToken: () => ipcRenderer.invoke(IPC.getToken),
  refreshToken: () => ipcRenderer.invoke(IPC.refreshToken),
};

contextBridge.exposeInMainWorld('tassel', tassel);
