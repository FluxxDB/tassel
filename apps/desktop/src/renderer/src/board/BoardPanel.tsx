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
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useStageStore } from '../features/session/stage-store';
import { BoardDescription } from './BoardDescription';
import { type BoardState, useBoardStore } from './board-store';
import type { BoardEngine } from './engine';
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

  const detach = useRef<(() => void) | null>(null);
  const onEngine = useCallback((engine: BoardEngine | null) => {
    detach.current?.();
    detach.current = engine ? useBoardStore.getState().attach(engine) : null;
  }, []);

  return (
    // Isolated, so tldraw's own layers (its watermark sits at z-index 248) stay inside the panel.
    // `lang` is the session's: Ada's board speaks it, and Korean sets as Korean (keep-all).
    <div
      data-testid="board-canvas"
      data-layout={layout}
      lang={lang}
      className="absolute inset-0 isolate"
    >
      {wanted && (
        <CanvasBoundary>
          <Suspense fallback={null}>
            <TldrawCanvas lang={lang} onEngine={onEngine} />
          </Suspense>
        </CanvasBoundary>
      )}
      <BoardDescription />
    </div>
  );
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
    console.warn("[tassel] Ada's board couldn't start, so this session goes on without it:", error);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
