// The IPC handlers behind window.tassel.paper. Like every handler, each refuses senders outside
// the renderer's origin. None takes arguments.
import { PAPER_IPC, type PaperConfig } from '../../shared/paper-bridge';
import { handleTrusted } from '../ipc';
import type { CameraAccessControl } from './camera-access';
import type { HelperSupervisor } from './helper-supervisor';

export function registerPaperIpc(deps: {
  config: PaperConfig;
  helper: HelperSupervisor;
  camera: CameraAccessControl;
}): void {
  handleTrusted(PAPER_IPC.getConfig, () => deps.config);
  handleTrusted(PAPER_IPC.startHelper, () => deps.helper.start());
  handleTrusted(PAPER_IPC.stopHelper, () => deps.helper.stop());
  handleTrusted(PAPER_IPC.cameraAccess, () => deps.camera.status());
  handleTrusted(PAPER_IPC.requestCameraAccess, () => deps.camera.request());
  handleTrusted(PAPER_IPC.openCameraSettings, () => deps.camera.openSettings());
}
