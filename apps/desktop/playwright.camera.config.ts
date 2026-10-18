import { defineConfig } from '@playwright/test';

// The real-camera spec (Task 14): opt-in with TASSEL_E2E_CAMERA=1, macOS only, with the owner at
// the Mac. It keeps no screenshot, video or trace: real frames never leave the app.
export default defineConfig({
  testDir: './tests/camera',
  globalSetup: './tests/e2e/global-setup.ts',
  workers: 1,
  reporter: 'list',
  use: { trace: 'off', screenshot: 'off', video: 'off' },
});
