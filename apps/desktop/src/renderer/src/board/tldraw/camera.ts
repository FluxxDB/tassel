// The board's camera: Ada's focus fitted to the board panel, clear of what the stage lays over it
// (fit.ts, ruling P5-R9), and fitted again whenever the panel changes size, so the stage's reflow
// and an unpin both end with her drawing in view.
import type { Editor } from 'tldraw';
import type { StageGeometry } from '../engine';
import { MOTION } from '../motion';
import { cubicBezier } from './effect-frames';
import { type BoardFit, cameraFor, FIT, fitBoard, plainFit, type Rect } from './fit';

const RESIZE_SETTLE_MS = 120;

const ease = cubicBezier(MOTION.ease);

/**
 * Moves the camera onto `bounds` (page px) in the stage's board panel, animated over
 * MOTION.cameraMs unless `animate` is false. Without the stage's geometry, it makes the plain fit
 * of the editor's viewport. Returns the fit, or null when the panel is too small to fit in yet.
 */
export function fitCamera(
  editor: Editor,
  bounds: Rect,
  opts: { animate: boolean; stage: StageGeometry | null },
): BoardFit | null {
  const fit = opts.stage ? fitBoard(bounds, opts.stage) : plainFitOf(editor, bounds);
  if (!fit) return null;
  editor.setCamera(
    cameraFor(bounds, fit),
    opts.animate ? { animation: { duration: MOTION.cameraMs, easing: ease } } : undefined,
  );
  return fit;
}

function plainFitOf(editor: Editor, bounds: Rect): BoardFit | null {
  const viewport = editor.getViewportScreenBounds();
  if (viewport.w < FIT.minViewport || viewport.h < FIT.minViewport) return null;
  if (!(bounds.w > 0 && bounds.h > 0)) return null;
  return { ...plainFit(bounds, viewport), stage: 'plain' };
}

/** Calls `refit` once `element` has kept its size for 120 ms. Returns the stop. */
export function onSettledResize(element: Element, refit: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(refit, RESIZE_SETTLE_MS);
  });
  observer.observe(element);
  return () => {
    clearTimeout(timer);
    observer.disconnect();
  };
}
