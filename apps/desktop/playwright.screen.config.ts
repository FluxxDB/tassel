import { defineConfig } from '@playwright/test';
/** Standalone fake API and self-window capture. No DB, providers or real devices. */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'screen-overlay.spec.ts',
  workers: 1,
  reporter: 'list',
  timeout: 45_000,
});
