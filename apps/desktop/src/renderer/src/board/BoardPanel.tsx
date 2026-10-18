// Ada's board, in the stage's board panel. It loads tldraw the first time the board shows, or the
// first time Ada draws even while it's hidden, and keeps it mounted from then on, so nothing she
// draws is lost (P5-R8). tldraw hands back a board engine, which draws the board store's scene.
// If tldraw fails to load or crashes, the panel keeps P1's dotted canvas, warns once, and the
// session carries on without the board. The description list always tells what's on it.
import {
  Component,
  type JSX,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useFloatingTiles } from '../components/FloatingTile';
import { useChatCover } from '../features/chat/chat-layout';
import { useStageStore } from '../features/session/stage-store';
import { useBoardCamera } from './BoardCameraControls';
import { BoardDescription } from './BoardDescription';
import { type BoardState, useBoardStore } from './board-store';
import type { BoardEngine, StageGeometry, StageRect } from './engine';
import { useSessionLang } from './use-session-lang';

const TldrawCanvas = lazy(() =>
  import('./tldraw/TldrawCanvas').then((module) => ({ default: module.TldrawCanvas })),
);

export function BoardPanel(): JSX.Element {
  const lang = useSessionLang();
  const shown = useStageStore((state) => state.mode !== 'paper');
  const drawn = useBoardStore((state) => state.scene.items.length > 0);
  const layout = useBoardStore((state) => layoutOf(state.layoutSources));
  // Latched: once the board has shown or held a drawing, the canvas stays.
  const [wanted, setWanted] = useState(shown || drawn);
  if ((shown || drawn) && !wanted) setWanted(true);

  // Every session's board starts blank, before its tutor can draw, and ends blank.
  useLayoutEffect(() => {
    const { reset } = useBoardStore.getState();
    reset();
    return reset;
  }, []);

  const engine = useRef<BoardEngine | null>(null);
  const detach = useRef<(() => void) | null>(null);
  const onEngine = useCallback((next: BoardEngine | null) => {
    detach.current?.();
    engine.current = next;
    // The student's camera controls live in the stage's top line (BoardCameraControls).
    useBoardCamera.setState({ camera: next?.camera });
    detach.current = next ? useBoardStore.getState().attach(next) : null;
  }, []);
  useEffect(() => () => useBoardCamera.setState({ camera: undefined }), []);

  // What the stage lays over the board, measured when the camera fits (P5-R9): this panel, the
  // session's main area, which places the captions, and whether captions are on.
  const panel = useRef<HTMLDivElement>(null);
  const stage = useCallback((): StageGeometry | null => {
    const element = panel.current;
    if (!element) return null;
    const main = boxOf(element.closest('main') ?? document.documentElement);
    // The chat sidebar, while it lies over the stage: the captions centre in what it leaves of
    // main, and her drawing keeps clear of it like a tile.
    const cover = useChatCover.getState().cover;
    const sidebar =
      cover > 0 ? [{ x: main.x + main.w - cover, y: main.y, w: cover, h: main.h }] : [];
    return {
      panel: boxOf(element),
      main: cover > 0 ? { ...main, w: main.w - cover } : main,
      captions: useStageStore.getState().captionsOn,
      tiles: [
        ...Object.values(useFloatingTiles.getState().tiles).map((tile) => tile.rect),
        ...sidebar,
      ],
    };
  }, []);

  // The overlaying sidebar opens or closes over the board, which keeps its size: fit again.
  useEffect(
    () =>
      useChatCover.subscribe((now, before) => {
        if (now.cover === before.cover) return;
        engine.current?.focus(useBoardStore.getState().scene.focus, { animate: true });
      }),
    [],
  );

  // Her tile and her desk camera move and resize: fit again when one does, or comes or goes.
  useEffect(
    () =>
      useFloatingTiles.subscribe((now, before) => {
        const rects = (state: typeof now) =>
          JSON.stringify(Object.entries(state.tiles).map(([id, tile]) => [id, tile.rect]));
        if (rects(now) === rects(before)) return;
        engine.current?.focus(useBoardStore.getState().scene.focus, { animate: true });
      }),
    [],
  );

  // The captions band is kept free whenever captions are on, so the camera fits again when
  // they're turned on or off, and never as their lines come and go.
  const captionsOn = useStageStore((state) => state.captionsOn);
  const captionsFitted = useRef(captionsOn);
  useEffect(() => {
    if (captionsFitted.current === captionsOn) return;
    captionsFitted.current = captionsOn;
    engine.current?.focus(useBoardStore.getState().scene.focus, { animate: true });
  }, [captionsOn]);

  return (
    // Isolated, so tldraw's own layers (its watermark sits at z-index 248) stay inside the panel.
    // `lang` is the session's: Ada's board speaks it, and Korean sets as Korean (keep-all).
    <div
      ref={panel}
      data-testid="board-canvas"
      data-layout={layout}
      lang={lang}
      className="absolute inset-0 isolate"
    >
      {wanted && (
        <CanvasBoundary>
          <Suspense fallback={null}>
            <TldrawCanvas lang={lang} onEngine={onEngine} stage={stage} />
          </Suspense>
        </CanvasBoundary>
      )}
      <BoardDescription />
    </div>
  );
}

function boxOf(element: Element): StageRect {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, w: width, h: height };
}

/**
 * How the board's automata were laid out: 'graphviz', or 'fallback' if any had to be, or nothing
 * before the first layout. Specs read it without tldraw (P5-R6, I10).
 */
function layoutOf(sources: BoardState['layoutSources']): 'graphviz' | 'fallback' | undefined {
  const made = Object.values(sources);
  if (made.length === 0) return undefined;
  return made.includes('fallback') ? 'fallback' : 'graphviz';
}

/** Catches tldraw failing to load or crashing: the board goes blank, the session goes on. */
class CanvasBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.warn(
      "[tassel] Tutor's board couldn't start, so this session goes on without it:",
      error,
    );
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
