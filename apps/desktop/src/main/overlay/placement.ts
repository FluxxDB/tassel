/** Where the overlay bar sits on a display, and how a frame's mask and marks map to it. */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The HUD's default size for a display's work area: narrower screens get a taller bar. */
export function hudSize(area: Rect): { width: number; height: number } {
  return { width: Math.min(720, area.width - 32), height: area.width < 600 ? 220 : 166 };
}

/** The bar's home when nothing is remembered: bottom center, above the dock or taskbar. */
export function hudHome(area: Rect): Rect {
  const { width, height } = hudSize(area);
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: area.y + area.height - height - 24,
    width,
    height,
  };
}

/** Keeps a window inside the work area, whatever its origin (an offset second display too). */
export function clampToArea(bounds: Rect, area: Rect): Rect {
  return {
    ...bounds,
    x: Math.round(Math.max(area.x, Math.min(area.x + area.width - bounds.width, bounds.x))),
    y: Math.round(Math.max(area.y, Math.min(area.y + area.height - bounds.height, bounds.y))),
  };
}

/**
 * The bar's bounds on a display: a remembered position when there is one, clamped so a
 * resolution change never leaves it off screen; the home otherwise.
 */
export function hudPlacement(area: Rect, saved?: { x: number; y: number } | null): Rect {
  const home = hudHome(area);
  if (
    !saved ||
    ![saved.x, saved.y].every(Number.isFinite) ||
    saved.x < area.x - home.width ||
    saved.y < area.y - home.height ||
    saved.x > area.x + area.width ||
    saved.y > area.y + area.height
  )
    return home;
  return clampToArea({ ...home, x: saved.x, y: saved.y }, area);
}

/** Positions are per display and per work-area size, so a changed resolution starts afresh. */
export function positionKey(display: { id: number | string; workArea: Rect }): string {
  return `${display.id}:${display.workArea.width}x${display.workArea.height}`;
}

/**
 * The HUD's rectangle as fractions of the captured display, whatever the display's origin or
 * pixel scale: both rectangles are in the same device-independent units, so a Retina display
 * and a 1x one give the same fractions, and the frame (whole display) paints them over.
 */
export function maskFor(hud: Rect, display: Rect): Rect {
  return {
    x: (hud.x - display.x) / display.width,
    y: (hud.y - display.y) / display.height,
    width: hud.width / display.width,
    height: hud.height / display.height,
  };
}
