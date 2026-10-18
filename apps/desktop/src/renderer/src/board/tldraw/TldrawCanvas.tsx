/// <reference path="./env.d.ts" />
// tldraw 5.5.2 in the board panel: the canvas alone, in Tassel's theme, on P1's dotted board,
// with Ada's shapes and effects. BoardPanel loads this module lazily, so a session that never
// shows the board never loads tldraw, and gets back a BoardEngine, never an Editor: nothing
// outside board/tldraw/** imports tldraw (P5-R1, review M15).
import type { Lang } from '@tassel/shared/i18n';
import { type JSX, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { type TLComponents, Tldraw, type TldrawOptions } from 'tldraw';
import type { BoardEngine, StageGeometry } from '../engine';
import { prefersReducedMotion } from '../motion';
import { BOARD_ASSET_URLS } from './assets';
import { BoardLang } from './board-lang';
import { hideUnrevealed, OVERLAY_UTILS, SHAPE_UTILS } from './editor-config';
import { createTldrawEngine, type TldrawEngine } from './engine';
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

export function TldrawCanvas({
  lang,
  onEngine,
  stage,
  overlay = false,
}: {
  /** The session's language, which Ada's board speaks. */
  lang: Lang;
  overlay?: boolean;
  onEngine(engine: BoardEngine | null): void;
  /** Where the stage lays things over the board, for the camera's fit (P5-R9). */
  stage(): StageGeometry | null;
}): JSX.Element {
  const { i18n } = useTranslation();
  const engine = useRef<TldrawEngine | null>(null);
  // The engine starts in the language of the moment it's made, then follows it.
  const current = useRef(lang);
  current.current = lang;
  const stageNow = useRef(stage);
  stageNow.current = stage;
  useEffect(() => {
    engine.current?.setLang(lang);
  }, [lang]);

  return (
    <BoardLang value={lang}>
      <Tldraw
        className={`board-tldraw${overlay ? ' screen-tldraw' : ''}`}
        licenseKey={LICENSE_KEY}
        hideUi
        autoFocus={false}
        colorScheme="light"
        themes={THEMES}
        initialTheme="tassel"
        assetUrls={BOARD_ASSET_URLS}
        options={OPTIONS}
        components={COMPONENTS}
        shapeUtils={SHAPE_UTILS}
        overlayUtils={OVERLAY_UTILS}
        getShapeVisibility={hideUnrevealed}
        onMount={(editor) => {
          editor.updateInstanceState({ isReadonly: true });
          editor.setCurrentTool('hand');
          // M, B and C are the session's (R18); tldraw's single letters would take B and C.
          editor.user.updateUserPreferences({ areKeyboardShortcutsEnabled: false });
          // A pasted link would fetch its preview, and a file has nowhere to go.
          editor.registerExternalContentHandler('files', ignore);
          editor.registerExternalContentHandler('url', ignore);
          const made = createTldrawEngine(editor, {
            lang: current.current,
            overlay,
            t: (key, opts) => i18n.t(key, opts),
            reducedMotion: prefersReducedMotion,
            stage: () => stageNow.current(),
          });
          engine.current = made;
          onEngine(made);
          return () => {
            onEngine(null);
            made.dispose();
            if (engine.current === made) engine.current = null;
          };
        }}
      />
    </BoardLang>
  );
}
