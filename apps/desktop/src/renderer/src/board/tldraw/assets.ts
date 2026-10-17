// tldraw's fonts, icons and translations, bundled with the app and served from app://tassel, so
// the board never reaches for cdn.tldraw.com, which the page CSP refuses. Vite gives each one a
// complete URL (the build's relative base resolves them against the page), which the formatter
// keeps as it is: tldraw's default would prefix '/' to anything not http(s).
import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite';

export const BOARD_ASSET_URLS: ReturnType<typeof getAssetUrlsByImport> = getAssetUrlsByImport(
  (url) => url,
);
