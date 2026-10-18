// The camera's fit (ruling P5-R9): Ada's drawing in the board panel, clear of her tile, the
// TopLine and the captions band, at a zoom that keeps her labels at 11 px or more; below that it
// gives up the captions band, then fits the whole panel. Pure, so it runs on P1's stage geometry
// at 1440×900 and 1024×680 without the app.
import { describe, expect, it } from 'vitest';
import type { StageGeometry } from '../../../../src/renderer/src/board/engine';
import {
  type BoardFit,
  boardObstructions,
  cameraFor,
  FIT,
  fitBoard,
  type Rect,
} from '../../../../src/renderer/src/board/tldraw/fit';

/** The demo's reference DFA as Graphviz lays it out (CORRECT: 494.72 × 333.8 board px). */
const CORRECT_BOX: Rect = { x: 0, y: 0, w: 494.72, h: 333.8 };

/**
 * P1's session screen, split: a 52 px title strip, then `main`; the stage 8 px down and 104 px
 * up from main's bottom, 16 px in; two panels 12 px apart, the board on the right.
 */
function split(width: number, height: number, captions = true): StageGeometry {
  const main = { x: 0, y: 52, w: width, h: height - 52 };
  const stage = { x: 16, y: main.y + 8, w: width - 32, h: main.h - 8 - 104 };
  const half = (stage.w - 12) / 2;
  return { panel: { x: stage.x + half + 12, y: stage.y, w: half, h: stage.h }, main, captions };
}

/** The board pinned: its panel is the whole stage. */
function boardOnly(width: number, height: number): StageGeometry {
  const main = { x: 0, y: 52, w: width, h: height - 52 };
  const panel = { x: 16, y: main.y + 8, w: width - 32, h: main.h - 8 - 104 };
  return { panel, main, captions: true };
}

const AT_1440 = split(1440, 900);
const AT_1024 = split(1024, 680);

/** Where the fitted content lands in the panel. */
function placed(content: Rect, fit: BoardFit): Rect {
  return { x: fit.x, y: fit.y, w: content.w * fit.zoom, h: content.h * fit.zoom };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function inside(a: Rect, b: Rect): boolean {
  return a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
}

function fitted(content: Rect, stage: StageGeometry): BoardFit {
  const fit = fitBoard(content, stage);
  if (!fit) throw new Error('no fit');
  return fit;
}

describe('boardObstructions', () => {
  it("is her tile's corner, the TopLine and the captions band, in the panel's px", () => {
    expect(AT_1440.panel).toEqual({ x: 726, y: 60, w: 698, h: 736 });
    expect(boardObstructions(AT_1440)).toEqual({
      // Without tiles reported, her default: 212×176, 14 px in from the panel's top right.
      tiles: [{ x: 472, y: 14, w: 212, h: 176 }],
      topLine: { x: 0, y: 0, w: 698, h: 54 },
      // The captions (880 px centered on main, 118 px up from its bottom) over the panel's left
      // 434 px, two lines tall: 84 px, ending 14 px above the panel's bottom.
      captions: { x: 0, y: 638, w: 434, h: 84 },
    });
  });

  it('has no captions band while captions are off', () => {
    expect(boardObstructions(split(1440, 900, false)).captions).toBeNull();
  });

  it('has no captions band where the captions miss the panel', () => {
    const wide: StageGeometry = {
      ...AT_1440,
      main: { x: 0, y: 52, w: 600, h: 848 },
    };
    expect(boardObstructions(wide).captions).toBeNull();
  });
});

describe('fitBoard', () => {
  it('fits the demo DFA clear of her tile, the TopLine and the captions at 1440 split', () => {
    const fit = fitted(CORRECT_BOX, AT_1440);
    expect(fit.stage).toBe('clear');
    // The region below her tile: 698 × 448, 24 px kept free inside it.
    expect(fit.zoom).toBeCloseTo(400 / 333.8, 6);
    const box = placed(CORRECT_BOX, fit);
    const { tiles, topLine, captions } = boardObstructions(AT_1440);
    expect(tiles.some((tile) => overlaps(box, tile))).toBe(false);
    expect(overlaps(box, topLine)).toBe(false);
    expect(captions && overlaps(box, captions)).toBe(false);
    expect(inside(box, { x: 0, y: 0, w: AT_1440.panel.w, h: AT_1440.panel.h })).toBe(true);
  });

  it('takes the larger fit of the region below her tile and the one left of it', () => {
    // Wide: below wins. Tall: left wins, where it shows larger.
    expect(fitted({ x: 0, y: 0, w: 600, h: 200 }, AT_1440).y).toBeGreaterThanOrEqual(190);
    const tall = { x: 0, y: 0, w: 200, h: 600 };
    const fit = fitted(tall, AT_1440);
    expect(fit.stage).toBe('clear');
    expect(fit.zoom).toBeCloseTo((584 - 2 * FIT.pad) / 600, 6);
    const box = placed(tall, fit);
    expect(box.x + box.w).toBeLessThanOrEqual(472);
    expect(box.y).toBeGreaterThanOrEqual(54);
  });

  it('keeps her labels at 11 px or more: at 1024 split it gives up the captions band first', () => {
    // Clear of everything, CORRECT would show at 0.54: Geist Mono 15 at 8 px.
    const fit = fitted(CORRECT_BOX, AT_1024);
    expect(fit.stage).toBe('no-captions');
    expect(fit.zoom).toBeGreaterThanOrEqual(FIT.minZoom);
    expect(fit.zoom).toBeCloseTo((516 - 190 - 2 * FIT.pad) / 333.8, 6);
    const box = placed(CORRECT_BOX, fit);
    const { tiles, topLine, captions } = boardObstructions(AT_1024);
    expect(tiles.some((tile) => overlaps(box, tile))).toBe(false);
    expect(overlaps(box, topLine)).toBe(false);
    // What it gives up: the captions, when they show, cover the drawing's bottom.
    expect(captions && overlaps(box, captions)).toBe(true);
  });

  it('then falls back to the plain fit: the whole panel, inset 48, as zoomToBounds does', () => {
    const wide = { x: 0, y: 0, w: 700, h: 300 };
    const fit = fitted(wide, AT_1024);
    expect(fit.stage).toBe('plain');
    expect(fit.zoom).toBeCloseTo((490 - FIT.inset) / 700, 6);
    // Centered in the panel.
    expect(fit.x).toBeCloseTo((490 - 700 * fit.zoom) / 2, 6);
    expect(fit.y).toBeCloseTo((516 - 300 * fit.zoom) / 2, 6);
  });

  it('with captions off there is no band to give up', () => {
    const fit = fitted(CORRECT_BOX, split(1024, 680, false));
    expect(fit.stage).toBe('clear');
    expect(fit.zoom).toBeCloseTo((516 - 190 - 2 * FIT.pad) / 333.8, 6);
  });

  it('never zooms in past 1.25', () => {
    expect(fitted({ x: 0, y: 0, w: 100, h: 60 }, AT_1440).zoom).toBe(FIT.maxZoom);
    expect(
      fitted(
        { x: 0, y: 0, w: 100, h: 60 },
        { ...AT_1440, panel: { ...AT_1440.panel, w: 4000, h: 4000 } },
      ).zoom,
    ).toBe(FIT.maxZoom);
  });

  it('fits nothing while the panel is hidden or still opening', () => {
    expect(fitBoard(CORRECT_BOX, { ...AT_1440, panel: { ...AT_1440.panel, w: 0 } })).toBeNull();
    expect(fitBoard(CORRECT_BOX, { ...AT_1440, panel: { ...AT_1440.panel, h: 60 } })).toBeNull();
  });
});

describe('the whole board while a trace runs', () => {
  /**
   * The demo DFA with a trace card under it: the card (480 × 300 for four steps) ITEM_GAP (64)
   * below the DFA, so the camera frames 494.72 × 697.8 board px.
   */
  const WITH_TRACE: Rect = { x: 0, y: 0, w: 494.72, h: 333.8 + 64 + 300 };
  /** The DFA's own box inside it: the top of the column. */
  const DFA_PART = (fit: BoardFit): Rect => ({
    x: fit.x,
    y: fit.y,
    w: CORRECT_BOX.w * fit.zoom,
    h: CORRECT_BOX.h * fit.zoom,
  });
  const panelOf = ({ panel }: StageGeometry): Rect => ({ x: 0, y: 0, w: panel.w, h: panel.h });

  it('at 1440 split, fits left of her tile, clear of everything, labels readable', () => {
    const fit = fitted(WITH_TRACE, AT_1440);
    expect(fit.stage).toBe('clear');
    expect(fit.zoom).toBeGreaterThanOrEqual(FIT.minZoom);
    const box = placed(WITH_TRACE, fit);
    const { tiles, topLine, captions } = boardObstructions(AT_1440);
    expect(tiles.some((tile) => overlaps(box, tile))).toBe(false);
    expect(overlaps(box, topLine)).toBe(false);
    expect(captions && overlaps(box, captions)).toBe(false);
    expect(inside(box, panelOf(AT_1440))).toBe(true);
  });

  it("at 1024 split, gives up the captions band, then the card's bottom, never the DFA", () => {
    const fit = fitted(WITH_TRACE, AT_1024);
    // Too tall to show readably beside the tile even over the captions: its top at the minimum
    // zoom, below her tile, the card's last rows running off the panel's bottom.
    expect(fit.stage).toBe('top');
    expect(fit.zoom).toBe(FIT.minZoom);
    const { tiles, topLine } = boardObstructions(AT_1024);
    const box = placed(WITH_TRACE, fit);
    expect(box.y).toBe(190 + FIT.pad);
    expect(box.y + box.h).toBeGreaterThan(AT_1024.panel.h);
    expect(tiles.some((tile) => overlaps(box, tile))).toBe(false);
    expect(overlaps(box, topLine)).toBe(false);
    const dfa = DFA_PART(fit);
    expect(inside(dfa, panelOf(AT_1024))).toBe(true);
    expect(tiles.some((tile) => overlaps(dfa, tile))).toBe(false);
  });

  it('at 1440 split with the chat beside the stage, the same: the DFA whole below her tile', () => {
    // The stage pushed 360 px left: the board panel is 518 wide.
    const pushed = split(1440 - 360, 900);
    const fit = fitted(WITH_TRACE, pushed);
    expect(fit.stage).toBe('top');
    const dfa = DFA_PART(fit);
    expect(inside(dfa, panelOf(pushed))).toBe(true);
    const { tiles } = boardObstructions(pushed);
    expect(tiles.some((tile) => overlaps(dfa, tile))).toBe(false);
  });

  it('at 1024 with the chat sidebar over the board, keeps the DFA clear of it and her tile', () => {
    // The board alone on the stage (992 × 516), the sidebar's 360 px over the window's right.
    const stage = boardOnly(1024, 680);
    const sidebar = { x: 1024 - 360, y: 52, w: 360, h: 628 };
    const ada = { x: 1024 - 360 - 14 - 212, y: 74, w: 212, h: 176 };
    const withSidebar: StageGeometry = {
      ...stage,
      main: { ...stage.main, w: stage.main.w - 360 },
      tiles: [ada, sidebar],
    };
    const fit = fitted(WITH_TRACE, withSidebar);
    expect(fit.stage).toBe('top');
    const dfa = DFA_PART(fit);
    expect(inside(dfa, panelOf(withSidebar))).toBe(true);
    const { tiles } = boardObstructions(withSidebar);
    expect(tiles.some((tile) => overlaps(dfa, tile))).toBe(false);
    expect(tiles.some((tile) => overlaps(placed(WITH_TRACE, fit), tile))).toBe(false);
  });

  it('is the plain fit when no tile-free region takes the board at the minimum zoom', () => {
    // 310 px panels: 1024 split with the sidebar beside the stage. 371 px of board won't go.
    const narrow = split(1024 - 360, 680);
    expect(fitted(WITH_TRACE, narrow).stage).toBe('plain');
    // Nor a wide board: the plain fit as before.
    expect(fitted({ x: 0, y: 0, w: 700, h: 300 }, AT_1024).stage).toBe('plain');
  });
});

describe('floating tiles', () => {
  // The session's tiles as they report themselves, in window px (FloatingTile).
  const BOARD = boardOnly(1440, 900);
  const ADA_TOP_RIGHT = { x: 1198, y: 74, w: 212, h: 176 };
  const ADA_BOTTOM_LEFT = { x: 30, y: 510, w: 212, h: 176 };
  const DESK_BOTTOM_RIGHT = { x: 1170, y: 536, w: 240, h: 150 };

  it("takes the reported tiles in the panel's px, and only the ones over it", () => {
    expect(
      boardObstructions({ ...BOARD, tiles: [ADA_TOP_RIGHT, DESK_BOTTOM_RIGHT] }).tiles,
    ).toEqual([
      { x: 1182, y: 14, w: 212, h: 176 },
      { x: 1154, y: 476, w: 240, h: 150 },
    ]);
    // Split: Ada over the board panel counts; a tile over her paper doesn't.
    expect(
      boardObstructions({ ...AT_1440, tiles: [ADA_TOP_RIGHT, { ...ADA_BOTTOM_LEFT }] }).tiles,
    ).toEqual([{ x: 472, y: 14, w: 212, h: 176 }]);
  });

  it('fits clear of Ada moved to the bottom left and her desk camera at the bottom right', () => {
    const stage = { ...BOARD, tiles: [ADA_BOTTOM_LEFT, DESK_BOTTOM_RIGHT] };
    for (const content of [
      CORRECT_BOX,
      { x: 0, y: 0, w: 900, h: 200 },
      { x: 0, y: 0, w: 200, h: 600 },
    ]) {
      const fit = fitted(content, stage);
      expect(fit.stage).toBe('clear');
      const box = placed(content, fit);
      const { tiles, topLine, captions } = boardObstructions(stage);
      expect(tiles).toHaveLength(2);
      for (const tile of tiles) expect(overlaps(box, tile)).toBe(false);
      expect(overlaps(box, topLine)).toBe(false);
      expect(captions && overlaps(box, captions)).toBe(false);
      expect(inside(box, { x: 0, y: 0, w: BOARD.panel.w, h: BOARD.panel.h })).toBe(true);
    }
  });

  it('with no tiles over the panel, fits the whole width under the TopLine', () => {
    const fit = fitted({ x: 0, y: 0, w: 1300, h: 200 }, { ...BOARD, tiles: [] });
    expect(fit.zoom).toBeCloseTo((1408 - 2 * FIT.pad) / 1300, 6);
  });
});

describe('cameraFor', () => {
  it("puts the content's box where the fit says, in tldraw's camera terms", () => {
    const content = { x: 120, y: -40, w: 494.72, h: 333.8 };
    const fit = fitted(content, AT_1440);
    const camera = cameraFor(content, fit);
    // tldraw draws a page point at (point + camera) × zoom in the viewport.
    const screen = (x: number, y: number) => ({
      x: (x + camera.x) * camera.z,
      y: (y + camera.y) * camera.z,
    });
    expect(camera.z).toBe(fit.zoom);
    expect(screen(content.x, content.y).x).toBeCloseTo(fit.x, 6);
    expect(screen(content.x, content.y).y).toBeCloseTo(fit.y, 6);
    expect(screen(content.x + content.w, content.y + content.h).x).toBeCloseTo(
      fit.x + content.w * fit.zoom,
      6,
    );
  });
});
