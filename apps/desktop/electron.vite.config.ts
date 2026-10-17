import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// Entries are electron-vite's defaults: src/main/index.ts, src/preload/index.ts and
// src/renderer/index.html, built to out/. Every dependency is a devDependency, so
// externalizeDeps leaves them all bundled: the sandboxed preload can only require electron.
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react(), tailwindcss()],
    // The paper detector is a module worker (client.ts): in the build too, as an ES module, so
    // OpenCV becomes a chunk it imports when it needs it.
    worker: { format: 'es' },
    // Pre-bundled when the dev server starts, so the worker's first import of OpenCV doesn't
    // make Vite re-optimize and reload the window.
    optimizeDeps: { include: ['@techstark/opencv-js'] },
  },
});
