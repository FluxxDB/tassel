// What Vite gives this folder at build time, for every project that compiles it (the unit tests'
// too, which reach TldrawCanvas through BoardPanel): its CSS imports, and the tldraw license key
// that electron.vite.config.ts sets (P5-R2), '' without one.
/// <reference types="vite/client" />

declare const __TASSEL_TLDRAW_LICENSE_KEY__: string;
