// Ties the Desk View helper to the app's life: quitting stops it (Review Focus 2). stop() sends
// SIGTERM synchronously, before the app goes; if Electron crashes instead, the helper sees its
// stdin close and exits on its own.
import type { HelperSupervisor } from './helper-supervisor';

export function bindHelperToApp(
  app: { on(event: 'will-quit', listener: () => void): unknown },
  helper: HelperSupervisor,
): void {
  app.on('will-quit', () => {
    void helper.stop();
  });
}
