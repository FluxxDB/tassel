import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { readTldrawLicenseKey, tldrawKeyLine } from './config/tldraw-license';

// tldraw's license key, read once per build or dev run, reaches the renderer as a build-time
// constant (P5-R2). The build says where the key came from, never what it is.
const tldrawKey = readTldrawLicenseKey();
console.log(tldrawKeyLine(tldrawKey));

/**
 * Without a key, tldraw's license gate blanks the canvas a few seconds after it mounts in a
 * production bundle (an `app://` origin is not one of its development origins), which made
 * every later assertion of the overlay spec a race. A keyless build is an agent's or CI's E2E
 * build, never the owner's packaged one, so there the gate reads as development, as it does
 * for `pnpm live` on http://localhost. The owner's key still licenses real builds.
 */
let gatesOpened = 0;
const keylessTldrawGate = {
  name: 'tassel-keyless-tldraw-gate',
  // Dev serves tldraw pre-bundled from http://localhost, which its gate already takes as development.
  apply: 'build' as const,
  transform(code: string, id: string) {
    // @tldraw/editor ships as one bundled module; the gate is LicenseManager.getIsDevelopment.
    if (tldrawKey.key || !/\/@tldraw\/editor\/.*\.m?js$/.test(id)) return null;
    const gate =
      /this\.isLoopbackHost\(hostname\) \|\| (?:process\.env\.NODE_ENV !== "production"|false)/;
    if (!gate.test(code)) return null;
    ++gatesOpened;
    return { code: code.replace(gate, 'this.isLoopbackHost(hostname) || true'), map: null };
  },
  buildEnd() {
    if (!tldrawKey.key && !gatesOpened)
      throw new Error('tldraw’s license gate changed; update tassel-keyless-tldraw-gate');
  },
};

// Entries are electron-vite's defaults: src/main/index.ts, src/preload/index.ts and
// src/renderer/index.html, built to out/. Every dependency is a devDependency, so
// externalizeDeps leaves them all bundled: the sandboxed preload can only require electron.
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    define: { __TASSEL_TLDRAW_LICENSE_KEY__: JSON.stringify(tldrawKey.key ?? '') },
    plugins: [react(), tailwindcss(), keylessTldrawGate],
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
