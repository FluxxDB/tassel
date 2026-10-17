import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // tests/e2e holds Playwright specs, which Vitest must not pick up.
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    // Node by default; component tests opt into jsdom with a `@vitest-environment jsdom` comment.
    environment: 'node',
    setupFiles: ['tests/unit/setup.ts'],
  },
});
