// The preload script. It exposes window.tassel, the renderer's only way into the main process.
// It runs sandboxed, so it imports nothing at runtime but electron (the rest is bundled in).
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type Platform, type TasselBridge } from '../shared/bridge';
import { PAPER_IPC } from '../shared/paper-bridge';

const tassel: TasselBridge = {
  platform: process.platform as Platform,
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
