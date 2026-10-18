// Where the camera puts what Ada focuses on (ruling P5-R9): in the board panel, clear of what the
// stage lays over it. The session's floating tiles (her tile, top right by default, and her desk
// camera on the board) sit wherever the student put them, the TopLine across the top, and the
// captions band near the bottom whenever captions are on (reserved, lines or none, so the camera
// never moves as they come and go). Her drawing goes in the largest region free of the tiles:
// with her tile alone in the top right, the region below it or the one left of it. Under a 0.75
// zoom her Geist Mono 15 labels would fall below 11 px, so it gives up the captions band first,
// then fits the whole panel as tldraw's zoomToBounds would (inset 48, at most 1.25). Pure: no
// tldraw, no DOM.
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
  /** Ada's tile and her desk camera, wherever she put them: the ones over this panel. */
  tiles: Rect[];
  topLine: Rect;
  /** Null while captions are off, or where they miss the panel. */
  captions: Rect | null;
}

/**
 * How the fit went: clear of everything; over the captions band; the top of the board at the
 * minimum zoom, clear of the tiles, its bottom running off the panel; or the plain fit.
 */
export type FitStage = 'clear' | 'no-captions' | 'top' | 'plain';

export interface BoardFit {
  zoom: number;
  /** Where the content's top left goes, in the panel's px. */
  x: number;
  y: number;
  stage: FitStage;
}

/** Every obstruction, from the stage's geometry: the one place they're worked out. */
export function boardObstructions({ panel, main, captions, tiles }: StageGeometry): Obstructions {
  const { tile, topLine, captions: band } = STAGE;
  return {
    tiles: tiles
      ? tiles.flatMap((rect) => clip({ ...rect, x: rect.x - panel.x, y: rect.y - panel.y }))
      : [{ x: panel.w - tile.inset - tile.w, y: tile.inset, w: tile.w, h: tile.h }],
    topLine: { x: 0, y: 0, w: panel.w, h: topLine },
    captions: captions ? captionsBand(panel, main) : null,
  };

  /** The part of `rect` over the panel, if any. */
  function clip(rect: Rect): Rect[] {
    const x = Math.max(0, rect.x);
    const y = Math.max(0, rect.y);
    const right = Math.min(panel.w, rect.x + rect.w);
    const bottom = Math.min(panel.h, rect.y + rect.h);
    return right > x && bottom > y ? [{ x, y, w: right - x, h: bottom - y }] : [];
  }

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
 * captions band, then over the band, then its top at the minimum zoom with the bottom running
 * off (a tall board: Ada's automaton with her trace card under it keeps the automaton whole and
 * clear of her tile, and gives up the card's last rows instead), then plain. Null while the panel
 * is too small to fit in.
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
    const best = besideTiles(content, panel, obstructions, attempt.band);
    if (best && best.zoom >= FIT.minZoom) return { ...best, stage: attempt.stage };
  }
  const top = topBesideTiles(content, panel, obstructions);
  if (top) return { ...top, stage: 'top' };
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

/**
 * The largest fit in a region free of the tiles, under the TopLine and above `band` if any. With
 * her tile alone in the top right, that's the region below it or the one left of it. Candidate
 * regions span the panel's and the tiles' edges; on equal zooms the larger region wins.
 */
function besideTiles(
  content: Rect,
  panel: Rect,
  { tiles, topLine }: Obstructions,
  band: Rect | null,
): Omit<BoardFit, 'stage'> | null {
  let best: { fit: Omit<BoardFit, 'stage'>; area: number } | null = null;
  for (const region of freeRegions(panel, tiles, topLine.h, band ? band.y : panel.h)) {
    const fit = fitIn(content, region);
    const area = region.w * region.h;
    if (
      fit &&
      (!best || fit.zoom > best.fit.zoom || (fit.zoom === best.fit.zoom && area > best.area))
    ) {
      best = { fit, area };
    }
  }
  return best?.fit ?? null;
}

/**
 * The content's top at the minimum zoom in the tallest region free of the tiles and under the
 * TopLine that takes its width (with FIT.pad around it), centered there and FIT.pad below the
 * region's top, its bottom running off; null when no region takes its width.
 */
function topBesideTiles(
  content: Rect,
  panel: Rect,
  { tiles, topLine }: Obstructions,
): Omit<BoardFit, 'stage'> | null {
  const zoom = FIT.minZoom;
  const width = content.w * zoom + 2 * FIT.pad;
  let best: Rect | null = null;
  for (const region of freeRegions(panel, tiles, topLine.h, panel.h)) {
    if (region.w < width) continue;
    if (!best || region.h > best.h || (region.h === best.h && region.w > best.w)) best = region;
  }
  if (!best) return null;
  return { zoom, x: best.x + (best.w - content.w * zoom) / 2, y: best.y + FIT.pad };
}

/**
 * Every rectangle spanning the panel's and the tiles' edges between `top` and `bottom` that no
 * tile overlaps.
 */
function freeRegions(panel: Rect, tiles: Rect[], top: number, bottom: number): Rect[] {
  const within = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
  const xs = [...new Set([0, panel.w, ...tiles.flatMap((t) => [t.x, t.x + t.w])])]
    .map((x) => within(x, 0, panel.w))
    .sort((a, b) => a - b);
  const ys = [...new Set([top, bottom, ...tiles.flatMap((t) => [t.y, t.y + t.h])])]
    .map((y) => within(y, top, bottom))
    .sort((a, b) => a - b);
  const regions: Rect[] = [];
  for (const [i, x1] of xs.entries()) {
    for (const x2 of xs.slice(i + 1)) {
      for (const [j, y1] of ys.entries()) {
        for (const y2 of ys.slice(j + 1)) {
          const region = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
          if (region.w > 0 && region.h > 0 && !tiles.some((t) => overlaps(region, t))) {
            regions.push(region);
          }
        }
      }
    }
  }
  return regions;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
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
