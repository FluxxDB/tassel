import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { readTldrawLicenseKey, tldrawKeyLine } from './config/tldraw-license';

// tldraw's license key, read once per build or dev run, reaches the renderer as a build-time
// constant (P5-R2). The build says where the key came from, never what it is.
const tldrawKey = readTldrawLicenseKey();
console.log(tldrawKeyLine(tldrawKey));

// Entries are electron-vite's defaults: src/main/index.ts, src/preload/index.ts and
// src/renderer/index.html, built to out/. Every dependency is a devDependency, so
// externalizeDeps leaves them all bundled: the sandboxed preload can only require electron.
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    define: { __TASSEL_TLDRAW_LICENSE_KEY__: JSON.stringify(tldrawKey.key ?? '') },
    plugins: [react(), tailwindcss()],
    // The paper detector and the board's layout are module workers: in the build too, as ES
    // modules, so OpenCV and Graphviz become chunks they import when they need them.
    worker: { format: 'es' },
    optimizeDeps: {
      // Vite's dev pre-bundling can't follow @tldraw/assets's `./translations/*.json?url`
      // imports (each fails as a missing file, and the dev server exits), so the board's assets
      // are served as they are, as the build does.
      exclude: ['@tldraw/assets'],
      // Only workers import OpenCV and Graphviz, and Vite's scan doesn't follow workers: found
      // on first use, they would make Vite re-optimize and reload the window mid-session.
      include: ['@techstark/opencv-js', '@viz-js/viz'],
    },
    build: {
      // tldraw fetches its translations, and the page CSP's connect-src takes no data: URLs, so
      // none of its assets is inlined, however small (en.json is 3 bytes). Others keep the default.
      assetsInlineLimit: (file) => (/[\\/]@tldraw[\\/]assets[\\/]/.test(file) ? false : undefined),
    },
  },
});
