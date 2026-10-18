// The main window, the renderer's origin, and the guards on every webContents and permission.
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  type Session,
  type WebContents,
} from 'electron';
import { APP_ENTRY_URL } from './app-protocol';

// Window chrome colors: bone and ink from packages/shared/src/styles/tokens.css.
const BONE = '#fff9f3';
const INK = '#222222';

/** Vite's dev server while `electron-vite dev` runs (never when packaged), else the app:// entry. */
export function rendererUrl(): string {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  return !app.isPackaged && devServerUrl ? devServerUrl : APP_ENTRY_URL;
}

/** True only for the renderer's own origin, the one origin that navigation, IPC and permissions trust. */
export function isTrustedUrl(url: string): boolean {
  let candidate: URL;
  try {
    candidate = new URL(url);
  } catch {
    return false;
  }
  // Compare protocol and host, not `origin`: Node reports origin "null" for every app:// URL.
  const trusted = new URL(rendererUrl());
  return candidate.protocol === trusted.protocol && candidate.host === trusted.host;
}

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: BONE,
    show: false,
    ...titleBar(process.platform),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  window.once('ready-to-show', () => window.show());
  window.loadURL(rendererUrl()).catch((error: unknown) => {
    console.error('[tassel] The renderer failed to load:', error);
  });
  return window;
}

/** Denies new windows and webviews, and navigation away from the renderer's origin. */
export function hardenWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event) => {
    if (!isTrustedUrl(event.url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

/** Grants permission requests and checks (camera, microphone and so on) only to the renderer's origin. */
export function restrictPermissions(session: Session): void {
  session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const fakeDenied =
      !app.isPackaged &&
      process.env.TASSEL_FAKE_MIC_ACCESS === 'denied' &&
      permission === 'media' &&
      'mediaTypes' in details &&
      details.mediaTypes?.includes('audio');
    callback(isTrustedUrl(details.requestingUrl) && !fakeDenied);
  });
  session.setPermissionCheckHandler((_contents, _permission, requestingOrigin) =>
    isTrustedUrl(requestingOrigin),
  );
}

function titleBar(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
  if (platform === 'darwin') {
    return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 18 } };
  }
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BONE, symbolColor: INK, height: 52 },
  };
}
