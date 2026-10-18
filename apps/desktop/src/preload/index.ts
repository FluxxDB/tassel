// The preload script. It exposes window.tassel, the renderer's only way into the main process.
// It runs sandboxed, so it imports nothing at runtime but electron (the rest is bundled in).
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type Platform, type TasselBridge } from '../shared/bridge';
import { PAPER_IPC } from '../shared/paper-bridge';
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
  paper: {
    getConfig: () => ipcRenderer.invoke(PAPER_IPC.getConfig),
    startHelper: () => ipcRenderer.invoke(PAPER_IPC.startHelper),
    stopHelper: () => ipcRenderer.invoke(PAPER_IPC.stopHelper),
    cameraAccess: () => ipcRenderer.invoke(PAPER_IPC.cameraAccess),
    requestCameraAccess: () => ipcRenderer.invoke(PAPER_IPC.requestCameraAccess),
    openCameraSettings: () => ipcRenderer.invoke(PAPER_IPC.openCameraSettings),
  },
};

contextBridge.exposeInMainWorld('tassel', tassel);
