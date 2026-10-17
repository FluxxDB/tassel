/// <reference path="./env.d.ts" />
// tldraw 5.5.2 in the board panel: the canvas alone, in Tassel's theme, on P1's dotted board.
// BoardPanel loads this module lazily, so a session that never shows the board never loads
// tldraw. Only board/tldraw/** imports tldraw (P5-R1).
import type { JSX } from 'react';
import { type Editor, type TLComponents, Tldraw, type TldrawOptions } from 'tldraw';
import { BOARD_ASSET_URLS } from './assets';
import { TASSEL_THEME } from './theme';
import './board.css';

/** The owner's license key from the build (P5-R2); without one, tldraw runs unlicensed. */
const LICENSE_KEY = __TASSEL_TLDRAW_LICENSE_KEY__ || undefined;

const THEMES = { tassel: TASSEL_THEME };

const OPTIONS: Partial<TldrawOptions> = {
  // hideUi keeps tldraw's shortcuts: this and the user preference in onMount turn them off.
  enableToolbarKeyboardShortcuts: false,
  // Space belongs to the session (P2's push-to-talk), not to panning the board.
  spacebarPanning: false,
};

/** An error in tldraw goes on to BoardPanel's boundary, which keeps the dotted canvas. */
function PassErrorOn({ error }: { error: unknown }): never {
  throw error;
}

const COMPONENTS: TLComponents = {
  // The canvas is transparent: P1's dotted board shows through, while tldraw loads too.
  Background: null,
  Grid: null,
  LoadingScreen: null,
  // Never tldraw's own error screen in the board panel.
  ErrorFallback: PassErrorOn,
};

/** Accepts pasted or dropped files and links and does nothing with them. */
function ignore(): void {}

export function TldrawCanvas({ onEditor }: { onEditor(editor: Editor | null): void }): JSX.Element {
  return (
    <Tldraw
      className="board-tldraw"
      licenseKey={LICENSE_KEY}
      hideUi
      autoFocus={false}
      colorScheme="light"
      themes={THEMES}
      initialTheme="tassel"
      assetUrls={BOARD_ASSET_URLS}
      options={OPTIONS}
      components={COMPONENTS}
      onMount={(editor) => {
        // M, B and C are the session's (R18); tldraw's single letters would take B and C.
        editor.user.updateUserPreferences({ areKeyboardShortcutsEnabled: false });
        // A pasted link would fetch its preview, and a file has nowhere to go.
        editor.registerExternalContentHandler('files', ignore);
        editor.registerExternalContentHandler('url', ignore);
        onEditor(editor);
        return () => onEditor(null);
      }}
    />
  );
}
