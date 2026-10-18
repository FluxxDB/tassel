// Which paper source runs, and the sources themselves.
import type { Platform } from '../../../shared/bridge';
import type { PaperBridge, PaperConfig, PaperSourceKind } from '../../../shared/paper-bridge';
import type { createCanvasFeed } from './sources/canvas-feed';
import { createHelperSource } from './sources/deskview-helper';
import { createFakeClipSource } from './sources/fake-clip';
import { createScreenSource } from './sources/screen';
import { createWebcamSource } from './sources/webcam';
import { createWindowCaptureSource } from './sources/window-capture';
import type { PaperSource } from './types';

// Task 1's check H passed (spike RESULTS.md): the helper reads Desk View on Electron's camera grant.
export const MACOS_DEFAULT: PaperSourceKind = 'deskview-helper';

/** A configured kind wins. `auto` is Desk View on macOS, and nothing elsewhere (R15). */
export function choosePaperSource(
  configured: PaperSourceKind | 'auto',
  platform: Platform,
): PaperSourceKind | null {
  if (configured !== 'auto') return configured;
  return platform === 'darwin' ? MACOS_DEFAULT : null;
}

/** Screen triggers never upload on their own (R7): P7 adds on-request screen frames. */
export function shouldUpload(kind: PaperSourceKind): boolean {
  return kind !== 'screen';
}

/** Only the helper on a real camera needs macOS's camera access; a clip needs none. */
export function needsCameraAccess(kind: PaperSourceKind, config: PaperConfig): boolean {
  return kind === 'deskview-helper' && !config.helperClip;
}

/** What the sources use. The optional ones are test seams; the defaults are the browser's. */
export interface SourceDeps {
  bridge: PaperBridge;
  config: PaperConfig;
  mediaDevices: MediaDevices;
  WebSocketCtor?: typeof WebSocket;
  document?: Document;
  decodeImage?: (jpeg: Uint8Array) => Promise<ImageBitmap>;
  createFeed?: typeof createCanvasFeed;
}

export function createPaperSource(kind: PaperSourceKind, deps: SourceDeps): PaperSource {
  switch (kind) {
    case 'webcam':
      return createWebcamSource(deps);
    case 'deskview-helper':
      return createHelperSource(deps);
    case 'fake-clip':
      return createFakeClipSource(deps);
    case 'window-capture':
      return createWindowCaptureSource(deps);
    case 'screen':
      return createScreenSource(deps);
  }
}
