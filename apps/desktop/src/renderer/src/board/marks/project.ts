// From her page to the panel: page coordinates (0–1 of the page's width and height, origin top
// left; P3's, and the paper actions') project into the frame's pixels, and the frame fits the
// paper panel, contained and centered. Marks are drawn in panel px, so their strokes and dots
// keep one size at every zoom while they follow her ink.
import type { Pt } from '@tassel/shared/beats';

/** A page's corners in frame pixels: top left, top right, bottom right, bottom left (P3's). */
export type Quad = [Pt, Pt, Pt, Pt];

/** Page coordinates → frame pixels. */
export type Project = (p: Pt) => Pt;

/** The projection of a flat page that fills its `w`×`h` frame, as the fixture page does. */
export function rectProjector(w: number, h: number): Project {
  return (p) => ({ x: p.x * w, y: p.y * h });
}

/** Frame pixels → panel px: scale, then offset. */
export interface Fit {
  scale: number;
  x: number;
  y: number;
}

/** Contains `frame` in `box` and centers it. An empty frame or box scales by 0. */
export function containFit(frame: { w: number; h: number }, box: { w: number; h: number }): Fit {
  const scale =
    frame.w > 0 && frame.h > 0 ? Math.max(0, Math.min(box.w / frame.w, box.h / frame.h)) : 0;
  return { scale, x: (box.w - frame.w * scale) / 2, y: (box.h - frame.h * scale) / 2 };
}

/** A page point in panel px. */
export function toScreen(p: Pt, project: Project, fit: Fit): Pt {
  const frame = project(p);
  return { x: fit.x + frame.x * fit.scale, y: fit.y + frame.y * fit.scale };
}
