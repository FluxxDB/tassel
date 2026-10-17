// The board's and the marks' motion: one set of durations and easings, so Ada's reveals, her
// marks and her trace move as one hand. Under prefers-reduced-motion everything is instant. Every
// animation runs toward a final state that's already set, so one that fails still shows it.

export const MOTION = Object.freeze({
  revealMs: 180,
  drawMs: 320,
  fadeMs: 150,
  /** Per edge. */
  glideMs: 450,
  pulseMs: 600,
  cameraMs: 240,
  ease: 'cubic-bezier(0.16, 1, 0.3, 1)',
  /** The token's glide along an edge only. */
  glideEase: 'cubic-bezier(0.65, 0, 0.35, 1)',
} as const);

/** True under prefers-reduced-motion: reduce; false where matchMedia is missing (jsdom, Node). */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
