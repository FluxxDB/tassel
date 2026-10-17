import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// Entries are electron-vite's defaults: src/main/index.ts, src/preload/index.ts and
// src/renderer/index.html, built to out/. Every dependency is a devDependency, so
// externalizeDeps leaves them all bundled: the sandboxed preload can only require electron.
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()],
  },
});
