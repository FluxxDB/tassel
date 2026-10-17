// The paper part of the preload bridge, window.tassel.paper (P3): the paper source config, the
// Desk View helper's lifecycle and camera access. Task 9 wires it into TasselBridge.

export type PaperSourceKind = 'deskview-helper' | 'window-capture' | 'fake-clip' | 'screen';

export type CameraAccess = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown';

export interface PaperConfig {
  source: PaperSourceKind | 'auto';
  debug: boolean;
  helperClip: boolean;
  fakeClip: boolean;
  params: Record<string, number>;
}

export type HelperStart =
  | { ok: true; url: string; token: string }
  | { ok: false; reason: 'unsupported' | 'missing-binary' | 'spawn-failed' | 'timeout' };

export interface PaperBridge {
  getConfig(): Promise<PaperConfig>;
  startHelper(): Promise<HelperStart>;
  stopHelper(): Promise<void>;
  cameraAccess(): Promise<CameraAccess>;
  requestCameraAccess(): Promise<boolean>;
  openCameraSettings(): Promise<void>;
}

/** The IPC channels behind the paper bridge. Task 9's src/main/paper/ipc.ts handles each one. */
export const PAPER_IPC = {
  getConfig: 'paper:getConfig',
  startHelper: 'paper:startHelper',
  stopHelper: 'paper:stopHelper',
  cameraAccess: 'paper:cameraAccess',
  requestCameraAccess: 'paper:requestCameraAccess',
  openCameraSettings: 'paper:openCameraSettings',
} as const;
