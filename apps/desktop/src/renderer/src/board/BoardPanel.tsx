// Ada's board, in the stage's board panel. It loads tldraw the first time the board shows and
// keeps it mounted from then on, hidden or not, so nothing Ada draws is lost (P5-R8). If tldraw
// fails to load or crashes, the panel keeps P1's dotted canvas, warns once, and the session
// carries on without the board.
import { Component, type JSX, lazy, type ReactNode, Suspense, useState } from 'react';
import { useStageStore } from '../features/session/stage-store';

const TldrawCanvas = lazy(() =>
  import('./tldraw/TldrawCanvas').then((module) => ({ default: module.TldrawCanvas })),
);

export function BoardPanel(): JSX.Element {
  const shown = useStageStore((state) => state.mode !== 'paper');
  // Latched: once the board has shown, the canvas stays.
  const [wanted, setWanted] = useState(shown);
  if (shown && !wanted) setWanted(true);
  return (
    // Isolated, so tldraw's own layers (its watermark sits at z-index 248) stay inside the panel.
    <div data-testid="board-canvas" className="absolute inset-0 isolate">
      {wanted && (
        <CanvasBoundary>
          <Suspense fallback={null}>
            <TldrawCanvas onEditor={attachNothingYet} />
          </Suspense>
        </CanvasBoundary>
      )}
    </div>
  );
}

/** The editor reaches the board here; Task 5 attaches Ada's engine to it. */
function attachNothingYet(): void {}

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
