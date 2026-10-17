// The board's camera: Ada's focus fitted to the board panel, and fitted again whenever the panel
// changes size, so the stage's reflow and an unpin both end with her drawing in view.
import { Box, type BoxModel, type Editor } from 'tldraw';
import { MOTION } from '../motion';
import { cubicBezier } from './effect-frames';

/** Room left around what the camera fits, in screen px, and the closest it ever gets. */
const FIT = Object.freeze({ inset: 48, maxZoom: 1.25 });
/** Below this, the panel is hidden or still opening: fit when it has grown. */
const MIN_VIEWPORT = 80;
const RESIZE_SETTLE_MS = 120;

const ease = cubicBezier(MOTION.ease);

/**
 * Fits the camera to `bounds` (page space): inset 48, at most 1.25×, animated over
 * MOTION.cameraMs unless `animate` is false. False when the panel is too small to fit in yet.
 */
export function fitCamera(editor: Editor, bounds: BoxModel, opts: { animate: boolean }): boolean {
  const viewport = editor.getViewportScreenBounds();
  if (viewport.w < MIN_VIEWPORT || viewport.h < MIN_VIEWPORT) return false;
  editor.zoomToBounds(Box.From(bounds), {
    inset: FIT.inset,
    targetZoom: FIT.maxZoom,
    ...(opts.animate && { animation: { duration: MOTION.cameraMs, easing: ease } }),
  });
  return true;
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
