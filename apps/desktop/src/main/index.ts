// The main process: app lifecycle, the single-instance lock and the app:// origin.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  desktopCapturer,
  net,
  safeStorage,
  session,
  shell,
  systemPreferences,
} from 'electron';
import { handleAppProtocol, registerAppScheme } from './app-protocol';
import { applyUserDataOverride, downloadDir, readConfig, tokenStoreMode } from './config';
import { registerDownloads } from './downloads';
import { registerIpc } from './ipc';
import { registerScreenOverlay } from './overlay/controller';
import { createCameraAccess } from './paper/camera-access';
import { readPaperSettings } from './paper/config';
import { registerDisplayMedia } from './paper/display-media';
import { helperPath } from './paper/helper-path';
import { createHelperSupervisor, helperToken } from './paper/helper-supervisor';
import { registerPaperIpc } from './paper/ipc';
import { bindHelperToApp } from './paper/lifecycle';
import { applyPaperSwitches } from './paper/switches';
import { readSavedSettings } from './settings';
import { createTokenStore } from './token-store';
import { readVoiceConfig, registerVoiceIpc } from './voice/ipc';
import { createMicAccess } from './voice/mic-access';
import { applyVoiceSwitches } from './voice/switches';
import { createMainWindow, hardenWebContents, isTrustedUrl, restrictPermissions } from './windows';

// First, because the single-instance lock lives in userData: E2E runs, each with its own
// TASSEL_USER_DATA, never block one another.
applyUserDataOverride();
// What Settings saved (userData/settings.json), read once per launch.
const saved = readSavedSettings(app.getPath('userData'));
// Paper's settings, and the fake camera's switches, which must be in before the app is ready.
const paper = readPaperSettings(process.env, app.isPackaged, existsSync, saved);
applyPaperSwitches(app.commandLine, paper);
registerAppScheme();
app.enableSandbox();
applyVoiceSwitches(app.commandLine);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', focusMainWindow);
  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents));
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app
    .whenReady()
    .then(() => {
      handleAppProtocol(join(__dirname, '../renderer'));
      restrictPermissions(session.defaultSession);
      // The board's PNG lands in Downloads with no dialog; macOS bounces the Downloads stack.
      registerDownloads(session.defaultSession, {
        dir: downloadDir(),
        finished: (path) => app.dock?.downloadFinished(path),
      });
      registerPaper();
      registerIpc(
        createTokenStore({
          dir: app.getPath('userData'),
          mode: tokenStoreMode(),
          crypto: safeStorage,
          // net.fetch takes a string or a Request, not a URL.
          fetch: (input, init) => net.fetch(input instanceof URL ? input.href : input, init),
          serverUrl: readConfig().serverUrl,
        }),
        app.getPath('userData'),
      );
      registerVoiceIpc({
        access: createMicAccess({
          platform: process.platform,
          prefs: systemPreferences,
          open: (url) => shell.openExternal(url),
        }),
        config: readVoiceConfig(),
      });
      const main = createMainWindow();
      registerScreenOverlay(main, {
        platform: process.platform,
        macosMajor:
          process.platform === 'darwin' ? Number.parseInt(process.getSystemVersion(), 10) : null,
        fakeDisplay: paper.fakeDisplay,
        requireFake: paper.requireFake,
        getSources: (options) => desktopCapturer.getSources(options),
        isTrusted: isTrustedUrl,
      });
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          const main = createMainWindow();
          registerScreenOverlay(main, {
            platform: process.platform,
            macosMajor:
              process.platform === 'darwin'
                ? Number.parseInt(process.getSystemVersion(), 10)
                : null,
            fakeDisplay: paper.fakeDisplay,
            requireFake: paper.requireFake,
            getSources: (options) => desktopCapturer.getSources(options),
            isTrusted: isTrustedUrl,
          });
        }
      });
    })
    .catch((error: unknown) => {
      console.error('[tassel] Startup failed:', error);
      app.exit(1);
    });
}

/** Paper (P3): display media for window and screen capture, and the Desk View helper. */
function registerPaper(): void {
  const { platform } = process;
  registerDisplayMedia(session.defaultSession, {
    platform,
    macosMajor: platform === 'darwin' ? Number.parseInt(process.getSystemVersion(), 10) : null,
    fakeDisplay: paper.fakeDisplay,
    requireFake: paper.requireFake,
    getSources: (options) => desktopCapturer.getSources(options),
    isTrusted: isTrustedUrl,
  });
  const helper = createHelperSupervisor({
    path: helperPath(paper, {
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      startDir: __dirname,
      platform,
      exists: existsSync,
    }),
    platform,
    clip: paper.helperClipPath,
    tag: paper.helperTag,
    requireFake: paper.requireFake,
    spawn,
    randomToken: helperToken,
    log: (line) => console.log(line),
  });
  const camera = createCameraAccess({
    platform,
    systemPreferences,
    openExternal: (url) => shell.openExternal(url),
    fake: paper.fakeCameraAccess,
    requireFake: paper.requireFake,
    log: (line) => console.log(line),
  });
  registerPaperIpc({ config: paper.config, helper, camera });
  bindHelperToApp(app, helper);
}

function focusMainWindow(): void {
  const [window] = BrowserWindow.getAllWindows();
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
}
