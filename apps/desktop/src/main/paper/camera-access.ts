// Camera access for the Desk View helper, which runs on Electron's camera grant: macOS asks
// about the responsible process (Task 1's check H). The renderer asks before it starts the
// helper on a camera.
import type { SystemPreferences } from 'electron';
import type { CameraAccess } from '../../shared/paper-bridge';

/** The Camera pane of Privacy & Security. Opened through shell.openExternal (NSWorkspace). */
export const PRIVACY_CAMERA_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera';

export interface CameraAccessControl {
  status(): CameraAccess;
  request(): Promise<boolean>;
  openSettings(): Promise<void>;
}

export function createCameraAccess(deps: {
  platform: NodeJS.Platform;
  systemPreferences: Pick<SystemPreferences, 'getMediaAccessStatus' | 'askForMediaAccess'>;
  openExternal(url: string): Promise<void>;
  /** TASSEL_FAKE_CAMERA_ACCESS, in place of systemPreferences. */
  fake: CameraAccess | null;
  requireFake: boolean;
  log(line: string): void;
}): CameraAccessControl {
  return {
    status() {
      if (deps.fake) return deps.fake;
      if (deps.platform !== 'darwin') return 'unknown';
      return deps.systemPreferences.getMediaAccessStatus('camera');
    },

    async request() {
      // A fake answers without asking; requireFake never lets anything ask.
      if (deps.fake) return deps.fake === 'granted';
      if (deps.requireFake || deps.platform !== 'darwin') return false;
      return deps.systemPreferences.askForMediaAccess('camera');
    },

    async openSettings() {
      // Never open System Settings for a fake, or during an agent's run.
      if (deps.fake || deps.requireFake) return deps.log('[tassel] fake: open camera settings');
      // Desk View, and so the camera pane it needs, is macOS-only.
      if (deps.platform !== 'darwin') return;
      await deps.openExternal(PRIVACY_CAMERA_URL);
    },
  };
}
