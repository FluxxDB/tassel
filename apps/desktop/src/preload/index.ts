// The preload script. It exposes window.tassel, the renderer's only way into the main process.
// It runs sandboxed, so it imports nothing at runtime but electron (the rest is bundled in).
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type Platform, type TasselBridge } from '../shared/bridge';
import { PAPER_IPC } from '../shared/paper-bridge';
import {
  type OverlayIntent,
  type OverlayState,
  SCREEN_IPC,
  type ScreenPoint,
} from '../shared/screen-bridge';
import { VOICE_IPC } from '../shared/voice-bridge';

const tassel: TasselBridge = {
  platform: process.platform as Platform,
  screen: {
    displays: () => ipcRenderer.invoke(SCREEN_IPC.displays),
    select: (id) => ipcRenderer.invoke(SCREEN_IPC.select, id),
    prepare: () => ipcRenderer.invoke(SCREEN_IPC.prepare),
    collapse: (reducedMotion) => ipcRenderer.invoke(SCREEN_IPC.collapse, reducedMotion),
    restore: (reducedMotion) => ipcRenderer.invoke(SCREEN_IPC.restore, reducedMotion),
    close: () => ipcRenderer.invoke(SCREEN_IPC.close),
    capture: (clean) => ipcRenderer.invoke(SCREEN_IPC.capture, clean),
    publish: (state) => ipcRenderer.send(SCREEN_IPC.publish, state),
    intent: (intent) => ipcRenderer.send(SCREEN_IPC.intent, intent),
    stroke: (points) => ipcRenderer.send(SCREEN_IPC.stroke, points),
    move: (dx, dy) => ipcRenderer.send(SCREEN_IPC.move, { dx, dy }),
    ready: () => ipcRenderer.send(SCREEN_IPC.ready),
    onArrived: (listener) => subscribe(SCREEN_IPC.arrived, listener),
    onState: (listener) => subscribe<OverlayState>(SCREEN_IPC.state, listener),
    onIntent: (listener) => subscribe<OverlayIntent>(SCREEN_IPC.intent, listener),
    onStroke: (listener) => subscribe<ScreenPoint[]>(SCREEN_IPC.stroke, listener),
  },
  voice: {
    getConfig: () => ipcRenderer.invoke(VOICE_IPC.getConfig),
    micAccess: () => ipcRenderer.invoke(VOICE_IPC.micAccess),
    askMicAccess: () => ipcRenderer.invoke(VOICE_IPC.askMicAccess),
    openMicSettings: () => ipcRenderer.invoke(VOICE_IPC.openMicSettings),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.getSettings),
    set: (patch) => ipcRenderer.invoke(IPC.setSettings, patch),
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

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
