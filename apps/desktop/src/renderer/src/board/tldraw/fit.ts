// Where the camera puts what Ada focuses on (ruling P5-R9): in the board panel, clear of what the
// stage lays over it. Her tile sits in the panel's top right corner, the TopLine across its top,
// and the captions band near its bottom whenever captions are on (reserved, lines or none, so the
// camera never moves as they come and go). Her drawing goes in the region below her tile or the
// one left of it, whichever shows it larger. Under a 0.75 zoom her Geist Mono 15 labels would
// fall below 11 px, so it gives up the captions band first, then fits the whole panel as
// tldraw's zoomToBounds would (inset 48, at most 1.25). Pure: no tldraw, no DOM.
import type { StageGeometry, StageRect } from '../engine';

export type Rect = StageRect;

/** P1's stage over the board panel, in CSS px (Stage.tsx, TutorTile.tsx, Captions.tsx). */
export const STAGE = Object.freeze({
  /** Ada's tile, 14 px in from the stage's top right, which is the board panel's. */
  tile: Object.freeze({ w: 212, h: 176, inset: 14 }),
  /** A panel's TopLine: its 26 px tags 14 px down, and 14 px clear below them. */
  topLine: 54,
  /**
   * The captions: centered on main, min(880, its width − 144) wide, their bottom 118 px up from
   * main's bottom. Reserved two lines tall, the previous one and the current one: 14 + 19 + 6 +
   * 29 + 16 px.
   */
  captions: Object.freeze({ bottom: 118, maxWidth: 880, sideRoom: 144, height: 84 }),
});

export const FIT = Object.freeze({
  /** Room kept around her drawing inside a free region, on each side. */
  pad: 24,
  /** The plain fit's inset, zoomToBounds's way: 48 in all, 24 on each side. */
  inset: 48,
  maxZoom: 1.25,
  /** Her edge labels are Geist Mono 15: at 0.75 they're 11.25 px. */
  minZoom: 0.75,
  /** A panel smaller than this is hidden, or still opening. */
  minViewport: 80,
});

/** What the stage lays over the board panel, in the panel's px from its top left. */
export interface Obstructions {
  tile: Rect;
  topLine: Rect;
  /** Null while captions are off, or where they miss the panel. */
  captions: Rect | null;
}

/** How the fit went: clear of everything, over the captions band, or the plain fit. */
export type FitStage = 'clear' | 'no-captions' | 'plain';

export interface BoardFit {
  zoom: number;
  /** Where the content's top left goes, in the panel's px. */
  x: number;
  y: number;
  stage: FitStage;
}

/** Every obstruction, from the stage's geometry: the one place they're worked out. */
export function boardObstructions({ panel, main, captions }: StageGeometry): Obstructions {
  const { tile, topLine, captions: band } = STAGE;
  return {
    tile: { x: panel.w - tile.inset - tile.w, y: tile.inset, w: tile.w, h: tile.h },
    topLine: { x: 0, y: 0, w: panel.w, h: topLine },
    captions: captions ? captionsBand(panel, main) : null,
  };

  function captionsBand(panel: Rect, main: Rect): Rect | null {
    const width = Math.min(band.maxWidth, main.w - band.sideRoom);
    const left = main.x + (main.w - width) / 2 - panel.x;
    const x = Math.max(0, left);
    const right = Math.min(panel.w, left + width);
    if (width <= 0 || right <= x) return null;
    const bottom = main.y + main.h - band.bottom - panel.y;
    return { x, y: bottom - band.height, w: right - x, h: band.height };
  }
}

/**
 * Fits `content` (board px) into the stage's board panel: clear of her tile, the TopLine and the
 * captions band, then over the band, then plain. Null while the panel is too small to fit in.
 */
export function fitBoard(content: Rect, stage: StageGeometry): BoardFit | null {
  const { panel } = stage;
  if (panel.w < FIT.minViewport || panel.h < FIT.minViewport) return null;
  if (!(content.w > 0 && content.h > 0)) return null;
  const obstructions = boardObstructions(stage);
  const tries: Array<{ stage: FitStage; band: Rect | null }> = obstructions.captions
    ? [
        { stage: 'clear', band: obstructions.captions },
        { stage: 'no-captions', band: null },
      ]
    : [{ stage: 'clear', band: null }];
  for (const attempt of tries) {
    const best = besideTile(content, panel, obstructions, attempt.band);
    if (best && best.zoom >= FIT.minZoom) return { ...best, stage: attempt.stage };
  }
  return { ...plainFit(content, panel), stage: 'plain' };
}

/** The plain fit: the whole panel, as zoomToBounds(bounds, { inset: 48, targetZoom: 1.25 }). */
export function plainFit(content: Rect, panel: Pick<Rect, 'w' | 'h'>): Omit<BoardFit, 'stage'> {
  const zoom = Math.min(
    (panel.w - FIT.inset) / content.w,
    (panel.h - FIT.inset) / content.h,
    FIT.maxZoom,
  );
  return { zoom, x: (panel.w - content.w * zoom) / 2, y: (panel.h - content.h * zoom) / 2 };
}

/**
 * tldraw's camera for a fit: it draws a page point at (point + camera) × z in the viewport, so
 * the content's top left lands at the fit's x and y.
 */
export function cameraFor(content: Rect, fit: BoardFit): { x: number; y: number; z: number } {
  return { x: fit.x / fit.zoom - content.x, y: fit.y / fit.zoom - content.y, z: fit.zoom };
}

/** The larger fit of the region below her tile and the one left of it, above `band` if any. */
function besideTile(
  content: Rect,
  panel: Rect,
  { tile, topLine }: Obstructions,
  band: Rect | null,
): Omit<BoardFit, 'stage'> | null {
  const bottom = band ? band.y : panel.h;
  const below = { x: 0, y: tile.y + tile.h, w: panel.w, h: bottom - (tile.y + tile.h) };
  const left = { x: 0, y: topLine.h, w: tile.x, h: bottom - topLine.h };
  let best: Omit<BoardFit, 'stage'> | null = null;
  for (const region of [below, left]) {
    const fit = fitIn(content, region);
    if (fit && (!best || fit.zoom > best.zoom)) best = fit;
  }
  return best;
}

/** `content` centered in `region` with FIT.pad around it, or null when there's no room. */
function fitIn(content: Rect, region: Rect): Omit<BoardFit, 'stage'> | null {
  const w = region.w - 2 * FIT.pad;
  const h = region.h - 2 * FIT.pad;
  if (w <= 0 || h <= 0) return null;
  const zoom = Math.min(w / content.w, h / content.h, FIT.maxZoom);
  return {
    zoom,
    x: region.x + (region.w - content.w * zoom) / 2,
    y: region.y + (region.h - content.h * zoom) / 2,
  };
}
