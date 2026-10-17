import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  // Every test launches its own Electron app. One at a time keeps timings and screenshots stable.
  workers: 1,
  reporter: 'list',
  forbidOnly: !!process.env.CI,
});
