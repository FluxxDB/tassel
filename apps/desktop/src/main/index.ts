// The main process: app lifecycle, the single-instance lock and the app:// origin.
import { join } from 'node:path';
import { app, BrowserWindow, net, safeStorage, session, shell, systemPreferences } from 'electron';
import { handleAppProtocol, registerAppScheme } from './app-protocol';
import { applyUserDataOverride, readConfig, tokenStoreMode } from './config';
import { registerIpc } from './ipc';
import { createTokenStore } from './token-store';
import { readVoiceConfig, registerVoiceIpc } from './voice/ipc';
import { createMicAccess } from './voice/mic-access';
import { applyVoiceSwitches } from './voice/switches';
import { createMainWindow, hardenWebContents, restrictPermissions } from './windows';

// First, because the single-instance lock lives in userData: E2E runs, each with its own
// TASSEL_USER_DATA, never block one another.
applyUserDataOverride();
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
      registerIpc(
        createTokenStore({
          dir: app.getPath('userData'),
          mode: tokenStoreMode(),
          crypto: safeStorage,
          // net.fetch takes a string or a Request, not a URL.
          fetch: (input, init) => net.fetch(input instanceof URL ? input.href : input, init),
          serverUrl: readConfig().serverUrl,
        }),
      );
      registerVoiceIpc({
        access: createMicAccess({
          platform: process.platform,
          prefs: systemPreferences,
          open: (url) => shell.openExternal(url),
        }),
        config: readVoiceConfig(),
      });
      createMainWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
      });
    })
    .catch((error: unknown) => {
      console.error('[tassel] Startup failed:', error);
      app.exit(1);
    });
}

function focusMainWindow(): void {
  const [window] = BrowserWindow.getAllWindows();
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
}
